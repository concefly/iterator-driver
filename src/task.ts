export class BaseTask<T> {
  iter: IterableIterator<T> = null;
}

export class SingleTask<T> extends BaseTask<T> {
  constructor(readonly iter: IterableIterator<T>) {
    super();
  }
}

export class SerialTask<T> extends BaseTask<T> {
  constructor(private readonly iters: IterableIterator<T>[]) {
    super();

    const self = this;

    this.iter = (function*() {
      for (const iter of self.iters) {
        for (const _ of iter) {
          yield _;
        }
      }
    })();
  }
}
