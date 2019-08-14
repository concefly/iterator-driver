import { EventBus, BaseEvent } from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs } from './util';

export const EVENT = {
  Start: class extends BaseEvent {},
  DoneOne: class extends BaseEvent {},
  Done: class extends BaseEvent {},
  Cancel: class extends BaseEvent {},
};

/** 创建切片任务驱动器 */
export class TaskDriver<T> {
  private taskQueue: BaseTask<T>[] = [];
  private taskRuntimeInfo = new WeakMap<
    BaseTask<T>,
    {
      /** 运行 ms 数 */
      ms: number;
    }
  >();

  private eventBus = new EventBus();
  private cancelSchedule: Function;

  constructor(
    task: BaseTask<T>[] | BaseTask<T>,
    private readonly scheduler: BaseScheduler,
    private readonly callback: (value: T) => void
  ) {
    // 初始化任务队列
    this.taskQueue = Array.isArray(task) ? [...task] : [task];
  }

  /** 优先级大的排后面 */
  private sortTaskQueue() {
    this.taskQueue.sort((a, b) => {
      return (
        // 优先级排序
        a.priority - b.priority ||
        // 运行时间排序
        (() => {
          const aInfo = this.taskRuntimeInfo.get(a);
          const bInfo = this.taskRuntimeInfo.get(b);
          // 耗时越长，优先级约低
          return ((bInfo && bInfo.ms) || 0) - ((aInfo && aInfo.ms) || 0);
        })()
      );
    });
  }

  private resetState() {
    this.taskQueue.forEach(task => {
      task.iter.return();
      this.taskRuntimeInfo.delete(task);
    });
    this.taskQueue = [];
    this.cancelSchedule = null;
  }

  private runNextSlice = () => {
    // 任务队列空 -> 结束当前 slice
    if (this.taskQueue.length === 0) {
      this.eventBus.emit(new EVENT.Done());
      return;
    }

    this.sortTaskQueue();
    const task = this.taskQueue.pop();

    const [{ value, done }, ms] = runtimeMs(() => task.iter.next());

    // 记录运行时间
    this.taskRuntimeInfo.set(task, {
      ...this.taskRuntimeInfo.get(task),
      ms,
    });

    if (done) {
      this.eventBus.emit(new EVENT.DoneOne());
    } else {
      // 未结束的任务要重新入队列
      this.taskQueue.unshift(task);
      this.callback(value);
    }

    // 调度下一个
    this.cancelSchedule = this.scheduler.schedule(this.runNextSlice);
  };

  start() {
    this.eventBus.emit(new EVENT.Start());
    this.runNextSlice();
    return this;
  }

  cancel() {
    this.cancelSchedule && this.cancelSchedule();
    this.resetState();
    this.eventBus.emit(new EVENT.Cancel());
    return this;
  }

  addTask(task: BaseTask<T>) {
    this.taskQueue.push(task);
    return this;
  }

  on(type: typeof BaseEvent, h: (event: BaseEvent) => void) {
    this.eventBus.on(type, h);
    return this;
  }

  off(type?: typeof BaseEvent, h?: Function) {
    this.eventBus.off(type, h);
    return this;
  }
}
