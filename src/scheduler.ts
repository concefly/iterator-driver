export class BaseScheduler {
  schedule(callback: () => void): () => void {
    void callback;
    return () => {};
  }
}

export class TimeoutScheduler extends BaseScheduler {
  schedule(callback: () => void): () => void {
    const tid = setTimeout(() => callback(), 0);

    return () => {
      clearTimeout(tid);
    };
  }
}

/** idle 调度器 */
export class IdleScheduler extends BaseScheduler {
  private _global = (window || global) as any;

  constructor() {
    super();
    if (!this._global.requestIdleCallback) throw new Error('requestIdleCallback 不存在');
  }

  schedule(callback: () => void) {
    const cancelId = this._global.requestIdleCallback(callback);

    return () => {
      this._global.cancelIdleCallback(cancelId);
    };
  }
}
