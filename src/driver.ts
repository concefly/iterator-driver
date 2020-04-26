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
import { BaseTask, SingleTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, ensureUnique } from './util';

export type ITaskRuntimeInfo = {
  /** 运行 ms 数 */
  ms?: number;
  sendValue?: any;
};

/** 创建切片任务驱动器 */
export class TaskDriver<T = any> {
  protected taskQueue: BaseTask<T>[] = [];
  protected taskRuntimeInfo = new WeakMap<BaseTask<T>, ITaskRuntimeInfo>();
  protected eventBus = new EventBus();
  protected isPaused = false;
  protected isRunning = false;
  protected cancelNextSliceScheduler?: () => void;

  constructor(
    task: BaseTask<T>[] | BaseTask<T>,
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

  protected emitAll<E extends BaseEvent>(event: E, tasks: BaseTask<T>[]) {
    // 给自己 emit
    this.eventBus.emit(event);
    // 给 task emit
    for (const task of tasks) {
      task.eventBus.emit(event);
    }
  }

  /** 优先级大的排后面 */
  protected sortTaskQueue() {
    this.taskQueue.sort((a, b) => {
      return (
        // 优先级排序
        a.priority - b.priority ||
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

  protected mergeRuntimeInfo(task: BaseTask<T>, info: Partial<ITaskRuntimeInfo>) {
    this.taskRuntimeInfo.set(task, {
      ...this.taskRuntimeInfo.get(task),
      ...info,
    });
  }

  protected getRuntimeInfo(task: BaseTask<T>): ITaskRuntimeInfo {
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
  protected shouldTaskRun(_task: BaseTask<T>): boolean {
    return true;
  }

  protected callLoop = (): void => {
    const setCleanerThenScheduleNext = (fn: () => void) => {
      this.cancelNextSliceScheduler = this.scheduler.schedule(fn);
    };

    // 判断是否暂停中
    if (this.isPaused) return setCleanerThenScheduleNext(this.callLoop);

    // 自定义检查
    if (!this.shouldRunCallLoop()) return setCleanerThenScheduleNext(this.callLoop);

    // 取出优先级最高的任务
    this.sortTaskQueue();
    const task = this.taskQueue.pop();

    // 任务队列空了，退出
    if (!task) {
      this.isRunning = false;
      this.emitAll(new EmptyEvent(), []);
      return;
    }

    // task 运行前检查不通过，则 skip
    if (!this.shouldTaskRun(task)) {
      this.taskQueue.unshift(task);
      return setCleanerThenScheduleNext(this.callLoop);
    }

    const runTask = () => {
      const { sendValue } = this.getRuntimeInfo(task);

      try {
        const [{ value, done }, ms] = runtimeMs(() => task.iter.next(sendValue));

        // 累加运行时间
        this.mergeRuntimeInfo(task, { ms: (this.getRuntimeInfo(task).ms || 0) + ms });

        toPromise(value)
          .then(resolvedValue => {
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

            // 调度下一个
            this.callLoop();
          })
          .catch(e => {
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

  drop(tasks: BaseTask<T>[]) {
    // 结束任务
    tasks.forEach(task => {
      task.iter.return && task.iter.return();
      this.taskRuntimeInfo.delete(task);
    });

    // 从 taskQueue 中剔除
    this.taskQueue = this.taskQueue.filter(t => !tasks.includes(t));

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
    this.drop(this.taskQueue);

    this.cancelNextSliceScheduler && this.cancelNextSliceScheduler();
    this.isRunning = false;
    this.isPaused = false;

    // 先发一个事件，然后把事件总线关掉
    this.emitAll(new DisposeEvent(), []);
    this.eventBus.off();
  }

  addTask(task: BaseTask<T> | IterableIterator<T>) {
    const _task = task instanceof BaseTask ? task : new SingleTask(task);
    this.taskQueue.unshift(_task);

    ensureUnique(this.taskQueue, 'name');

    if (this.config?.autoStart) this.start();

    return this;
  }

  /** 获取接下来的任务队列 */
  getTaskQueue() {
    return [...this.taskQueue];
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
