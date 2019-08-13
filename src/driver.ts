import { EventBus, BaseEvent } from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';

export const EVENT = {
  Start: class extends BaseEvent {},
  Done: class extends BaseEvent {},
  Cancel: class extends BaseEvent {},
};

/** 创建切片任务驱动器 */
export class TaskDriver<T> {
  private eventBus = new EventBus();
  private removeHandler: Function;

  constructor(
    private readonly task: BaseTask<T>,
    private readonly scheduler: BaseScheduler,
    private readonly callback: (value: T) => void
  ) {}

  private runNext = () => {
    const { value, done } = this.task.iter.next();

    if (done) {
      this.eventBus.emit(new EVENT.Done());
      return;
    }

    this.callback(value);
    this.removeHandler = this.scheduler.schedule(this.runNext);
  };

  start() {
    this.eventBus.emit(new EVENT.Start());
    this.runNext();
    return this;
  }

  cancel() {
    this.removeHandler && this.removeHandler();
    this.eventBus.emit(new EVENT.Cancel());
    return this;
  }

  on(type: typeof BaseEvent, h: (event: BaseEvent) => void) {
    this.eventBus.on(type, h);
    return this;
  }

  off(type: typeof BaseEvent, h: Function) {
    this.eventBus.off(type, h);
    return this;
  }
}
