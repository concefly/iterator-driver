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
  CrashEvent,
} from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, cond, noop, setInjectValue, getInjectValue } from './util';

export type ITaskStage = 'init' | 'ready' | 'running' | 'error' | 'dropped' | 'done';

export type ITaskData<T> = {
  task: T;
  stage: ITaskStage;

  /** 运行 ms 数 */
  ms?: number;
  sendValue?: any;
  error?: Error;
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
  protected taskPool = new Map<string, ITaskData<T>>();
  protected eventBus = new EventBus();
  protected isPaused = false;
  protected injectCommands: IInjectCommandType[] = [];

  constructor(
    tasks: T[],
    protected readonly scheduler: BaseScheduler,
    protected readonly callback?: (value: T) => void,
    protected readonly config?: {
      /** 添加任务时自动启动 */
      autoStart?: boolean;
    }
  ) {
    // 初始化任务池
    this.taskPool = new Map(
      tasks.map(task => [
        task.name,
        {
          task,
          stage: 'init',
        } as ITaskData<T>,
      ])
    );
  }

  protected emitAll<E extends BaseEvent>(
    event: E,
    tasks: T[] = [...this.taskPool.values()].map(d => d.task)
  ) {
    // 给自己 emit
    this.eventBus.emit(event);
    // 给 task emit
    for (const task of tasks) {
      task.eventBus.emit(event);
    }
  }

  /** @override 自定义选取 task */
  protected pickTask(tasks: ITaskData<T>[]): T | undefined {
    if (tasks.length === 0) return;

    // 优先级大的排后面
    tasks.sort((a, b) => {
      return (
        // 优先级排序
        a.task.priority - b.task.priority ||
        // 次优先级排序
        a.task.minorPriority - b.task.minorPriority ||
        // 运行时间排序
        (() => {
          const aMs = a.ms || 0;
          const bMs = b.ms || 0;
          // 耗时越长，优先级约低
          return bMs - aMs;
        })()
      );
    });

    return tasks.pop()?.task;
  }

  /** @override 自定义判断任务是否执行 */
  protected shouldTaskRun(_task: T): boolean {
    return true;
  }

  protected pickTaskData(taskDataList: ITaskData<T>[]): ITaskData<T> | undefined {
    taskDataList = taskDataList.filter(t => this.shouldTaskRun(t.task));

    const taskName = this.pickTask(taskDataList)?.name;
    return taskName ? this.taskPool.get(taskName) : undefined;
  }

  /**
   * @override 判断是否要进行此次调度
   */
  protected shouldRunCallLoop(): boolean {
    return true;
  }

  protected getUnFinishTaskPoolItem(): ITaskData<T>[] {
    return [...this.taskPool.values()].filter(
      d => d.stage === 'init' || d.stage === 'ready' || d.stage === 'running'
    );
  }

  start() {
    // float promise
    this.doLoop();

    return this;
  }

  pause() {
    this.isPaused = true;
    this.emitAll(new PauseEvent());
    return this;
  }

  resume() {
    this.isPaused = false;
    this.emitAll(new ResumeEvent());
    return this;
  }

  drop(tasks: T[]) {
    const stageHandler = cond<{ taskData: ITaskData<T> }>({
      init: ctx => {
        this.injectCommands.unshift({ type: 'continue' });
        ctx.taskData.stage = 'dropped';
      },
      ready: ctx => {
        this.injectCommands.unshift({ type: 'continue' });
        ctx.taskData.stage = 'dropped';
      },
      running: ctx => {
        this.injectCommands.unshift({ type: 'continue' });
        ctx.taskData.stage = 'dropped';
      },
      error: noop,
      dropped: noop,
      done: ctx => {
        ctx.taskData.task.iter.return?.();
      },
    });

    // 结束任务
    tasks.forEach(({ name }) => {
      const taskData = this.taskPool.get(name);
      if (!taskData) return;

      stageHandler(taskData.stage, { taskData });
    });

    // 抛事件
    this.emitAll(new DropEvent(tasks), tasks);
    return this;
  }

  dropAll() {
    const tasks = this.getUnFinishTaskQueue();
    this.drop(tasks);

    return this;
  }

  /**
   * 销毁
   * - 清理各种定时器
   * - 重置状态
   */
  dispose() {
    // 卸掉所有任务
    this.dropAll();

    // 清除任务池
    this.taskPool.clear();
    this.isPaused = false;

    // 设置退出循环
    this.injectCommands = [{ type: 'exit' }];

    // 先发一个事件，然后把事件总线关掉
    this.emitAll(new DisposeEvent(), []);
    this.eventBus.off();
  }

  addTask(task: T, opt?: { overwrite: boolean }) {
    if (!opt?.overwrite) {
      if (this.taskPool.has(task.name)) throw new Error('当前任务已存在 ' + task.name);
    }

    this.taskPool.set(task.name, {
      task,
      stage: 'init',
    });

    if (this.config?.autoStart) this.start();

    return this;
  }

  /** 获取未完成的任务队列 */
  getUnFinishTaskQueue(): T[] {
    return this.getUnFinishTaskPoolItem().map(d => d.task);
  }

  get isRunning(): boolean {
    return [...this.taskPool.values()].some(d => d.stage === 'ready' || d.stage === 'running');
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

    this.emitAll(
      new StartEvent(),
      [...this.taskPool.values()].map(d => d.task)
    );

    while (1) {
      try {
        const taskInfos = this.getUnFinishTaskPoolItem();
        if (taskInfos.length === 0) {
          this.emitAll(new EmptyEvent(), []);
          break;
        }

        // 判断是否暂停中
        if (this.isPaused) continue;

        // 自定义检查
        if (!this.shouldRunCallLoop()) continue;

        const shouldRunTaskInfos = taskInfos.filter(d => this.shouldTaskRun(d.task));
        if (shouldRunTaskInfos.length === 0) continue;

        // 优先级排序
        const taskInfo = this.pickTaskData(shouldRunTaskInfos);
        if (!taskInfo) continue;

        taskInfo.stage = 'ready';

        // 等待调度
        await waitSchedule();

        taskInfo.stage = 'running';

        const { sendValue } = taskInfo;

        // 求值
        let resolvedValue: any;
        let isDone = false;
        let invokeMs = 0;

        try {
          const [{ value, done }, ms] = runtimeMs(() => taskInfo.task.iter.next(sendValue));
          invokeMs = ms;
          isDone = !!done;

          resolvedValue = await waitPromise(toPromise(value));
        } catch (taskError) {
          // 如果是注入的错误，直接往外抛，由外面处理
          if (getInjectValue(taskError)) throw taskError;

          // 否则抛事件，并继续调度
          this.emitAll(new DoneEvent(taskError, undefined, taskInfo.task), [taskInfo.task]);
          continue;
        }

        // 累加运行时间
        taskInfo.ms = (taskInfo.ms || 0) + invokeMs;

        // 记录 sendValue
        taskInfo.sendValue = resolvedValue;

        if (isDone) {
          taskInfo.stage = 'done';
          this.emitAll(new DoneEvent(null, resolvedValue, taskInfo.task), [taskInfo.task]);
        } else {
          this.callback && this.callback(resolvedValue);
          this.emitAll(new YieldEvent(resolvedValue, taskInfo.task), [taskInfo.task]);
        }
      } catch (commonError) {
        const command = getInjectValue(commonError) as IInjectCommandType;

        if (command) {
          // 退出
          if (command.type === 'exit') break;

          // 下一个循环
          if (command.type === 'continue') continue;
        } else {
          this.emitAll(
            new CrashEvent(commonError),
            [...this.taskPool.values()].map(d => d.task)
          );

          throw commonError;
        }
      }
    }
  }
}
