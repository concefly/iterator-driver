import {
  EventBus,
  BaseEvent,
  DoneEvent,
  YieldEvent,
  StartEvent,
  PauseEvent,
  ResumeEvent,
  DropEvent,
  EmptyEvent,
  DisposeEvent,
} from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, ensureUnique, setInjectValue, getInjectValue } from './util';

export type ITaskRuntimeInfo = {
  /** 运行 ms 数 */
  ms?: number;
  sendValue?: any;
};

type IInjectCommandType =
  | {
      type: 'exit';
    }
  | {
      type: 'continue';
    };

/** 创建切片任务驱动器 */
export class TaskDriver<T extends BaseTask = BaseTask> {
  protected taskQueue: T[] = [];
  protected pendingTask?: T;
  protected taskRuntimeInfo = new WeakMap<T, ITaskRuntimeInfo>();
  protected eventBus = new EventBus();
  protected isPaused = false;
  protected isRunning = false;
  protected cancelNextSliceScheduler?: () => void;

  protected injectCommands: IInjectCommandType[] = [];

  constructor(
    task: T[] | T,
    protected readonly scheduler: BaseScheduler,
    protected readonly callback?: (value: T) => void,
    protected readonly config?: {
      /** 添加任务时自动启动 */
      autoStart?: boolean;
    }
  ) {
    // 初始化任务队列
    this.taskQueue = Array.isArray(task) ? [...task] : [task];
    ensureUnique(this.taskQueue, 'name');
  }

  protected emitAll<E extends BaseEvent>(event: E, tasks: T[]) {
    // 给自己 emit
    this.eventBus.emit(event);
    // 给 task emit
    for (const task of tasks) {
      task.eventBus.emit(event);
    }
  }

  /** 优先级大的排后面 */
  protected sortTaskQueue(tasks: T[]) {
    tasks.sort((a, b) => {
      return (
        // 优先级排序
        a.priority - b.priority ||
        // 次优先级排序
        a.minorPriority - b.minorPriority ||
        // 运行时间排序
        (() => {
          const aMs = this.getRuntimeInfo(a).ms || 0;
          const bMs = this.getRuntimeInfo(b).ms || 0;
          // 耗时越长，优先级约低
          return bMs - aMs;
        })()
      );
    });
  }

  protected mergeRuntimeInfo(task: T, info: Partial<ITaskRuntimeInfo>) {
    this.taskRuntimeInfo.set(task, {
      ...this.taskRuntimeInfo.get(task),
      ...info,
    });
  }

  protected getRuntimeInfo(task: T): ITaskRuntimeInfo {
    return {
      ms: 0,
      sendValue: undefined,
      ...this.taskRuntimeInfo.get(task),
    };
  }

  /**
   * @override 判断是否要进行此次调度
   */
  protected shouldRunCallLoop(): boolean {
    return true;
  }

  /**
   * @override 判断当前任务应该 run or skip
   */
  protected shouldTaskRun(_task: T): boolean {
    return true;
  }

  start() {
    // float promise
    this.doLoop();

    return this;
  }

  pause() {
    this.isPaused = true;
    this.emitAll(new PauseEvent(), this.taskQueue);
    return this;
  }

  resume() {
    this.isPaused = false;
    this.emitAll(new ResumeEvent(), this.taskQueue);
    return this;
  }

  drop(tasks: T[]) {
    const newTaskQueue: T[] = [];
    const toDropTasks: T[] = [];

    const dropNameSet = new Set(tasks.map(t => t.name));

    this.taskQueue.forEach(t => {
      if (dropNameSet.has(t.name)) toDropTasks.push(t);
      else newTaskQueue.push(t);
    });

    this.taskQueue = newTaskQueue;

    // 跳过当前的任务
    if (this.pendingTask) this.injectCommands.unshift({ type: 'continue' });

    this.emitAll(new DropEvent(toDropTasks), toDropTasks);

    return this;
  }

  dropAll() {
    const tasks = this.getUnFinishTaskQueue();
    this.emitAll(new DropEvent(tasks), tasks);
    this.taskQueue = [];

    return this;
  }

  /**
   * 销毁
   * - 清理各种定时器
   * - 重置状态
   */
  dispose() {
    this.dropAll();

    this.pendingTask = undefined;
    this.isRunning = false;
    this.isPaused = false;

    // 设置退出循环
    this.injectCommands = [{ type: 'exit' }];

    // 先发一个事件，然后把事件总线关掉
    this.emitAll(new DisposeEvent(), []);
    this.eventBus.off();

    return this;
  }

  addTask(task: T) {
    this.taskQueue.unshift(task);
    ensureUnique(this.taskQueue, 'name');

    if (this.config?.autoStart) this.start();

    return this;
  }

  /** 获取接下来的任务队列(不包含 pending 状态的队列) */
  getTaskQueue() {
    return [...this.taskQueue];
  }

  /** 获取未完成的任务队列 */
  getUnFinishTaskQueue() {
    return this.pendingTask ? [...this.getTaskQueue(), this.pendingTask] : this.getTaskQueue();
  }

  /** 获取接下来的任务队列长度 */
  getTaskQueueSize() {
    return this.taskQueue.length;
  }

  on<E extends typeof BaseEvent>(type: E, h: (event: InstanceType<E>) => void) {
    this.eventBus.on(type, h);
    return this;
  }

  off<E extends typeof BaseEvent>(type?: E, h?: Function) {
    this.eventBus.off(type, h);
    return this;
  }

  protected async doLoop() {
    if (this.isRunning) return;
    this.isRunning = true;

    const waitPromise = async <T>(value: Promise<T>): Promise<T> => {
      const result = await value;

      // 系统注入的异常
      if (this.injectCommands.length) {
        const command = this.injectCommands.pop()!;
        throw setInjectValue(new Error(command.type), command);
      }

      return result;
    };

    const waitSchedule = () =>
      waitPromise(
        new Promise<void>(r => this.scheduler.schedule(r))
      );

    this.emitAll(new StartEvent(), this.taskQueue);

    while (1) {
      try {
        const taskQueue = this.taskQueue;
        if (taskQueue.length === 0) {
          this.emitAll(new EmptyEvent(), []);
          break;
        }

        // 等待调度
        await waitSchedule();

        // 判断是否暂停中
        if (this.isPaused) continue;

        // 自定义检查
        if (!this.shouldRunCallLoop()) continue;

        const shouldRunTasks = taskQueue.filter(t => this.shouldTaskRun(t));
        if (shouldRunTasks.length === 0) continue;

        // 优先级排序
        this.sortTaskQueue(shouldRunTasks);

        const task = shouldRunTasks.pop();
        if (!task) continue;

        // 从原始 taskQueue 中剔除
        const taskOriginIndex = this.taskQueue.findIndex(t => t.name === task.name);
        if (taskOriginIndex < 0) throw new Error('shouldRunTask 任务不存在 ' + task.name);

        this.taskQueue.splice(taskOriginIndex, 1);

        // 标记
        this.pendingTask = task;

        const { sendValue } = this.getRuntimeInfo(task);
        const [{ value, done }, ms] = runtimeMs(() => task.iter.next(sendValue));

        // 累加运行时间
        this.mergeRuntimeInfo(task, { ms: (this.getRuntimeInfo(task).ms || 0) + ms });

        // 求值
        let resolvedValue: any;
        try {
          resolvedValue = await waitPromise(toPromise(value));
          // 清除标记
          this.pendingTask = undefined;
        } catch (taskError) {
          // 清除标记
          this.pendingTask = undefined;

          // 如果是注入的错误，直接往外抛，由外面处理
          if (getInjectValue(taskError)) throw taskError;

          // 否则抛事件，并继续调度
          this.emitAll(new DoneEvent(taskError, undefined, task), [task]);
          continue;
        }

        // 记录 sendValue
        this.mergeRuntimeInfo(task, { sendValue: resolvedValue });

        if (done) {
          this.emitAll(new DoneEvent(null, resolvedValue, task), [task]);
        } else {
          // 未结束的任务要重新入队列
          this.taskQueue.unshift(task);

          this.callback && this.callback(resolvedValue);
          this.emitAll(new YieldEvent(resolvedValue, task), [task]);
        }
      } catch (commonError) {
        const command = getInjectValue(commonError) as IInjectCommandType;
        console.log('@@@', 'command ->', commonError, command);

        if (command) {
          // 退出
          if (command.type === 'exit') break;

          // 下一个循环
          if (command.type === 'continue') continue;
        }
      }
    }

    this.isRunning = false;
  }
}
