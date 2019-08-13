import { ITask } from './interface';

export const createTask = <T>(iter: IterableIterator<T>): ITask<T> => {
  return { iter };
};

export const createSerialTask = <T>(iters: IterableIterator<T>[]): ITask<T> => {
  const serialIter = (function*() {
    for (const iter of iters) {
      for (const _ of iter) {
        yield _;
      }
    }
  })();

  return { iter: serialIter };
};
