import { IScheduler, INoopFn } from './interface';
import { envGlobal } from './util';

/** idle 调度器 */
export const idleScheduler: IScheduler = (callback: INoopFn) => {
  if (!(envGlobal as any).requestIdleCallback) {
    throw new Error('requestIdleCallback 不存在');
  }

  const cancelId = (envGlobal as any).requestIdleCallback(callback);

  return () => {
    (envGlobal as any).cancelIdleCallback(cancelId);
  };
};

/** timeout 调度器 */
export const timeoutScheduler: IScheduler = (callback: INoopFn) => {
  const cancelId = envGlobal.setTimeout(callback, 0);

  return () => {
    envGlobal.clearTimeout(cancelId as any);
  };
};

/** sync 调度器 */
export const syncScheduler: IScheduler = (callback: INoopFn) => {
  callback();

  return () => {};
};
