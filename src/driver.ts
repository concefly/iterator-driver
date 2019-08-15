import { EventBus, BaseEvent } from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise } from './util';

export const EVENT = {
  /** 开始 */
  Start: class extends BaseEvent {},

  /** 每个 yield 事件 */
  Call: class<T> extends BaseEvent {
    constructor(public value: T) {
      super();
    }
  },

  /** 某个 iterator 结束 */
  DoneOne: class<T> extends BaseEvent {
    constructor(public error: Error, public value: T) {
      super();
    }
  },

  /** 所有 iterator 结束 */
  Done: class extends BaseEvent {},

  /** 取消 */
  Cancel: class extends BaseEvent {},
};

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
      this.eventBus.emit(new EVENT.Done());
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
          this.eventBus.emit(new EVENT.DoneOne(null, resolvedValue));
        } else {
          // 未结束的任务要重新入队列
          this.taskQueue.unshift(task);

          this.callback && this.callback(resolvedValue);
          this.eventBus.emit(new EVENT.Call(resolvedValue));
        }

        // 调度下一个
        this.cancelSchedule = this.scheduler.schedule(this.runNextSlice);
      })
      .catch(e => {
        task.iter.throw(e);
        this.eventBus.emit(new EVENT.DoneOne(e, undefined));

        // 调度下一个
        this.cancelSchedule = this.scheduler.schedule(this.runNextSlice);
      });
  };

  start() {
    this.runNextSlice();
    this.eventBus.emit(new EVENT.Start());
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
