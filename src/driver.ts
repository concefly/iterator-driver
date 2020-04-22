import {
  EventBus,
  BaseEvent,
  DoneEvent,
  YieldEvent,
  StartEvent,
  PauseEvent,
  ResumeEvent,
  CancelEvent,
  EmptyEvent,
} from './event';
import { BaseTask, SingleTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, ensureUnique } from './util';

export type ITaskRuntimeInfo = {
  /** 运行 ms 数 */
  ms: number;
  sendValue?: any;
  cancelSchedule?: () => void;
};

/** 创建切片任务驱动器 */
export class TaskDriver<T = any> {
  protected taskQueue: BaseTask<T>[] = [];
  protected taskRuntimeInfo = new WeakMap<BaseTask<T>, ITaskRuntimeInfo>();
  protected eventBus = new EventBus();
  protected isPaused = false;

  constructor(
    task: BaseTask<T>[] | BaseTask<T>,
    protected readonly scheduler: BaseScheduler,
    protected readonly callback?: (value: T) => void
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
          const aMs = this.getRuntimeInfo(a).ms;
          const bMs = this.getRuntimeInfo(b).ms;
          // 耗时越长，优先级约低
          return bMs - aMs;
        })()
      );
    });
  }

  protected resetTaskState(tasks: BaseTask<T>[]) {
    tasks.forEach(task => {
      task.iter.return();

      // 结束所有 task 调度器
      const { cancelSchedule } = this.getRuntimeInfo(task);
      cancelSchedule && cancelSchedule();

      this.taskRuntimeInfo.delete(task);
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

  protected runNextSlice = () => {
    if (this.isPaused) return;

    // 任务队列空 -> 结束当前 slice
    if (this.taskQueue.length === 0) {
      this.emitAll(new EmptyEvent(), []);
      return;
    }

    this.sortTaskQueue();
    const task = this.taskQueue.pop();

    const runTask = () => {
      const { sendValue } = this.getRuntimeInfo(task);

      try {
        const [{ value, done }, ms] = runtimeMs(() => task.iter.next(sendValue));

        // 累加运行时间
        this.mergeRuntimeInfo(task, { ms: this.getRuntimeInfo(task).ms + ms });

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
            this.runNextSlice();
          })
          .catch(e => {
            this.emitAll(new DoneEvent(e, undefined, task), [task]);

            // 调度下一个
            this.runNextSlice();
          });
      } catch (e) {
        // 发生了同步错误
        this.emitAll(new DoneEvent(e, undefined, task), [task]);

        // 调度下一个
        this.runNextSlice();
      }
    };

    this.mergeRuntimeInfo(task, {
      cancelSchedule: this.scheduler.schedule(runTask),
    });
  };

  start() {
    this.emitAll(new StartEvent(), this.taskQueue);
    this.runNextSlice();
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
    this.runNextSlice();
    return this;
  }

  cancel(task?: BaseTask<T>) {
    const tasksToCancel = task ? [task] : this.taskQueue;

    this.resetTaskState(tasksToCancel);
    this.emitAll(new CancelEvent(), tasksToCancel);

    // 从 taskQueue 中剔除
    this.taskQueue = this.taskQueue.filter(t => !tasksToCancel.includes(t));

    return this;
  }

  addTask(task: BaseTask<T> | IterableIterator<T>) {
    const _task = task instanceof BaseTask ? task : new SingleTask(task);
    this.taskQueue.unshift(_task);

    ensureUnique(this.taskQueue, 'name');

    return this;
  }

  /** 获取接下来的任务队列 */
  getTaskQueue() {
    return [...this.taskQueue];
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
