import { BaseTask } from './task';

export class BaseEvent {
  static displayName = 'BaseEvent';

  constructor(...args: any[]) {
    void args;
  }
}

/** 全局要用的 event */
export const EVENT = {
  /** 开始 */
  Start: class extends BaseEvent {
    static displayName = 'Start';
  },

  /** 每个 yield 事件 */
  Yield: class<V, T> extends BaseEvent {
    static displayName = 'Yield';
    constructor(public readonly value: V, public readonly task: BaseTask<T>) {
      super();
    }
  },

  /** 某个 iterator 结束 */
  Done: class<V, T> extends BaseEvent {
    static displayName = 'Done';
    constructor(public error: Error, public value: V, public readonly task: BaseTask<T>) {
      super();
    }
  },

  /** 所有 iterator 结束 */
  Empty: class extends BaseEvent {
    static displayName = 'Empty';
  },

  /** 取消 */
  Cancel: class extends BaseEvent {
    static displayName = 'Cancel';
  },

  /** 暂停 */
  Pause: class extends BaseEvent {
    static displayName = 'Pause';
  },

  /** 恢复 */
  Resume: class extends BaseEvent {
    static displayName = 'Resume';
  },
};

export class EventBus {
  private handleMap = new Map<BaseEvent, Function[]>();

  emit<T extends BaseEvent>(event: T) {
    const handlers = this.handleMap.get(event.constructor) || [];
    handlers.forEach(h => h(event));

    return this;
  }

  on<T extends typeof BaseEvent>(type: T, handler: (event: InstanceType<T>) => void) {
    this.handleMap.set(type, [...(this.handleMap.get(type) || []), handler]);
    return this;
  }

  off<T extends typeof BaseEvent>(type?: T, handler?: Function) {
    // 卸载指定 handler
    if (type && handler) {
      this.handleMap.set(type, [...(this.handleMap.get(type) || [])].filter(_h => _h !== handler));
      return this;
    }

    // 卸载指定 type 的 handler
    if (type) {
      this.handleMap.delete(type);
      return this;
    }

    // 卸载所有
    this.handleMap.clear();
    return this;
  }
}
