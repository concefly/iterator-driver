import { EventBus, BaseEvent, EVENT } from './event';
import { BaseTask, SingleTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise } from './util';

export type ITaskRuntimeInfo = {
  /** 运行 ms 数 */
  ms: number;
  sendValue?: any;
};

/** 创建切片任务驱动器 */
export class TaskDriver<T> {
  private taskQueue: BaseTask<T>[] = [];
  private taskRuntimeInfo = new WeakMap<BaseTask<T>, ITaskRuntimeInfo>();
  private eventBus = new EventBus();
  private cancelSchedule: Function;

  constructor(
    task: BaseTask<T>[] | BaseTask<T>,
    private readonly scheduler: BaseScheduler,
    private readonly callback?: (value: T) => void
  ) {
    // 初始化任务队列
    this.taskQueue = Array.isArray(task) ? [...task] : [task];
  }

  private emitAll<E extends BaseEvent>(event: E, tasks: BaseTask<T>[]) {
    // 给自己 emit
    this.eventBus.emit(event);
    // 给 task emit
    for (const task of tasks) {
      task.eventBus.emit(event);
    }
  }

  /** 优先级大的排后面 */
  private sortTaskQueue() {
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

  private resetState() {
    this.taskQueue.forEach(task => {
      task.iter.return();
      this.taskRuntimeInfo.delete(task);
    });
    this.taskQueue = [];
    this.cancelSchedule = null;
  }

  private mergeRuntimeInfo(task: BaseTask<T>, info: Partial<ITaskRuntimeInfo>) {
    this.taskRuntimeInfo.set(task, {
      ...this.taskRuntimeInfo.get(task),
      ...info,
    });
  }

  private getRuntimeInfo(task: BaseTask<T>): ITaskRuntimeInfo {
    return {
      ms: 0,
      sendValue: undefined,
      ...this.taskRuntimeInfo.get(task),
    };
  }

  private runNextSlice = () => {
    // 任务队列空 -> 结束当前 slice
    if (this.taskQueue.length === 0) {
      this.emitAll(new EVENT.Empty(), []);
      return;
    }

    this.sortTaskQueue();
    const task = this.taskQueue.pop();

    const { sendValue } = this.getRuntimeInfo(task);
    const [{ value, done }, ms] = runtimeMs(() => task.iter.next(sendValue));

    // 记录运行时间
    this.mergeRuntimeInfo(task, { ms });

    toPromise(value)
      .then(resolvedValue => {
        // 记录 sendValue
        this.mergeRuntimeInfo(task, { sendValue: resolvedValue });

        if (done) {
          this.emitAll(new EVENT.Done(null, resolvedValue), [task]);
        } else {
          // 未结束的任务要重新入队列
          this.taskQueue.unshift(task);

          this.callback && this.callback(resolvedValue);
          this.emitAll(new EVENT.Yield(resolvedValue), [task]);
        }

        // 调度下一个
        this.cancelSchedule = this.scheduler.schedule(this.runNextSlice);
      })
      .catch(e => {
        task.iter.throw(e);
        this.emitAll(new EVENT.Done(e, undefined), [task]);

        // 调度下一个
        this.cancelSchedule = this.scheduler.schedule(this.runNextSlice);
      });
  };

  start() {
    this.emitAll(new EVENT.Start(), this.taskQueue);
    this.runNextSlice();
    return this;
  }

  cancel() {
    this.cancelSchedule && this.cancelSchedule();
    this.resetState();
    this.emitAll(new EVENT.Cancel(), this.taskQueue);
    return this;
  }

  addTask(task: BaseTask<T> | IterableIterator<T>) {
    const _task = task instanceof BaseTask ? task : new SingleTask(task);
    this.taskQueue.push(_task);

    // 空队列重新开始
    if (this.taskQueue.length === 1) {
      this.start();
    }

    return this;
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
