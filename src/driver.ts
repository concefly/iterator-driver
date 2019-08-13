import { IScheduler, IDriver, ITask } from './interface';
import { createEventBus } from './event';

/** 创建切片任务驱动器 */
export const createTaskDriver = <T>(
  task: ITask<T>,
  scheduler: IScheduler,
  callback: (value: T) => void
): IDriver => {
  const eventBus = createEventBus();
  let removeHandler: ReturnType<IScheduler>;

  const { iter } = task;

  const _runNext = () => {
    const { value, done } = iter.next();
    if (done) {
      eventBus.emit('done');
      return;
    }

    callback(value);
    removeHandler = scheduler(_runNext);
  };

  return {
    start: () => _runNext(),
    cancel: () => removeHandler && removeHandler(),
    on: (e: string, handler: Function) => eventBus.on(e, handler),
    off: (e: string, handler: Function) => eventBus.off(e, handler),
  };
};
