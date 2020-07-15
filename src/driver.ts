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
import { runtimeMs, toPromise, ensureUnique } from './util';

export type ITaskRuntimeInfo = {
  /** 运行 ms 数 */
  ms?: number;
  sendValue?: any;
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
  protected sortTaskQueue(tasks: T[]): void {
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

  protected popTaskQueue(): T | undefined {
    const shouldRunTasks = this.taskQueue.filter(t => this.shouldTaskRun(t));

    // 先按优先级排序
    this.sortTaskQueue(shouldRunTasks);
    if (shouldRunTasks.length === 0) return;

    const toRunTask = shouldRunTasks.pop()!;

    const taskOriginIndex = this.taskQueue.findIndex(t => t.name === toRunTask.name);
    if (taskOriginIndex < 0) return;

    // 从原始队列中删掉
    this.taskQueue.splice(taskOriginIndex, 1);

    return toRunTask;
  }

  protected callLoop = (): void => {
    // 任务队列空
    if (this.getUnFinishTaskQueue().length === 0) {
      this.isRunning = false;
      this.emitAll(new EmptyEvent(), []);
      return;
    }

    const setCleanerThenScheduleNext = (fn: () => void) => {
      this.cancelNextSliceScheduler = this.scheduler.schedule(fn);
    };

    // 判断是否暂停中
    if (this.isPaused) return setCleanerThenScheduleNext(this.callLoop);

    // 自定义检查
    if (!this.shouldRunCallLoop()) return setCleanerThenScheduleNext(this.callLoop);

    // 取出优先级最高的任务
    const task = this.popTaskQueue();

    // 当前没有要执行的任务, 进入下一个循环
    if (!task) return setCleanerThenScheduleNext(this.callLoop);

    // 设置标记
    this.pendingTask = task;

    const runTask = () => {
      const { sendValue } = this.getRuntimeInfo(task);

      try {
        const [{ value, done }, ms] = runtimeMs(() => task.iter.next(sendValue));

        // 累加运行时间
        this.mergeRuntimeInfo(task, { ms: (this.getRuntimeInfo(task).ms || 0) + ms });

        toPromise(value)
          .then(resolvedValue => {
            // 清空标记
            this.pendingTask = undefined;

            // 记录 sendValue
            this.mergeRuntimeInfo(task, { sendValue: resolvedValue });

            if (done) {
              this.emitAll(new DoneEvent(null, resolvedValue, task), [task]);
            } else {
              // 未结束的任务要重新入队列
              // 调用 .drop() 的时候会清空 pendingTask，表示废弃任务，不要重新入队列
              this.taskQueue.unshift(task);

              this.callback && this.callback(resolvedValue);
              this.emitAll(new YieldEvent(resolvedValue, task), [task]);
            }

            // 调度下一个
            this.callLoop();
          })
          .catch(e => {
            // 清空标记
            this.pendingTask = undefined;

            this.emitAll(new DoneEvent(e, undefined, task), [task]);

            // 调度下一个
            this.callLoop();
          });
      } catch (e) {
        // 发生了同步错误
        this.emitAll(new DoneEvent(e, undefined, task), [task]);

        // 调度下一个
        this.callLoop();
      }
    };

    setCleanerThenScheduleNext(runTask);
  };

  start() {
    if (this.isRunning) return this;

    this.isRunning = true;
    this.emitAll(new StartEvent(), this.taskQueue);

    this.callLoop();

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
    // 结束任务
    tasks.forEach(task => {
      task !== this.pendingTask && task.iter.return && task.iter.return();
      this.taskRuntimeInfo.delete(task);
    });

    // 从 taskQueue 中剔除
    this.taskQueue = this.taskQueue.filter(t => !tasks.includes(t));

    if (this.pendingTask && tasks.includes(this.pendingTask)) {
      this.pendingTask = undefined;
    }

    // 抛事件
    this.emitAll(new DropEvent(tasks), tasks);
    return this;
  }

  dropAll() {
    const tasks = this.getUnFinishTaskQueue();

    // 结束任务
    this.taskQueue.forEach(task => {
      task !== this.pendingTask && task.iter.return && task.iter.return();
      this.taskRuntimeInfo.delete(task);
    });

    this.taskQueue = [];
    this.pendingTask = undefined;

    // 抛事件
    this.emitAll(new DropEvent(tasks), tasks);
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

    this.cancelNextSliceScheduler && this.cancelNextSliceScheduler();
    this.isRunning = false;
    this.isPaused = false;

    // 先发一个事件，然后把事件总线关掉
    this.emitAll(new DisposeEvent(), []);
    this.eventBus.off();
  }

  addTask(task: T) {
    this.unshiftTaskQueue(task);
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
}
