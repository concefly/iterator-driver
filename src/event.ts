import { TaskStageEnum } from './enum';
import { BaseTask } from './task';

export class BaseEvent {
  static displayName = 'BaseEvent';

  constructor(...args: any[]) {
    void args;
  }
}

/** 开始 */
export class StartEvent extends BaseEvent {
  static displayName = 'Start';
}

/** 每个 yield 事件 */
export class YieldEvent extends BaseEvent {
  static displayName = 'Yield';
  constructor(public readonly value: any, public readonly task: BaseTask<any>) {
    super();
  }
}

/** @deprecated 用 TaskStageChangeEvent 替代 */
export class DoneEvent extends BaseEvent {
  static displayName = 'Done';
  constructor(public error: Error | null, public value: any, public readonly task: BaseTask<any>) {
    super();
  }
}

/** 所有 iterator 结束 */
export class EmptyEvent extends BaseEvent {
  static displayName = 'Empty';
}

/** @deprecated 用 TaskStageChangeEvent 替代 */
export class DropEvent extends BaseEvent {
  static displayName = 'drop';

  constructor(public readonly tasks: BaseTask<any>[]) {
    super();
  }
}

/** 暂停 */
export class PauseEvent extends BaseEvent {
  static displayName = 'Pause';
}

/** 恢复 */
export class ResumeEvent extends BaseEvent {
  static displayName = 'Resume';
}

/** 停止 */
export class StopEvent extends BaseEvent {
  static displayName = 'stop';
}

/** 崩溃 */
export class CrashEvent extends BaseEvent {
  static displayName = 'CrashEvent';

  constructor(public readonly error: Error) {
    super();
  }
}

/** 任务 stage 变化 */
export class TaskStageChangeEvent extends BaseEvent {
  static displayName = 'TaskStageChangeEvent';
  constructor(public readonly task: BaseTask, public readonly extra: { lastStage: TaskStageEnum }) {
    super();
  }
}

export class EventBus {
  private handleMap = new Map<
    BaseEvent,
    Array<{
      handler: Function;
      once?: boolean;
    }>
  >();

  emit<T extends BaseEvent>(event: T) {
    const handlers = this.handleMap.get(event.constructor) || [];
    const newHandlers = handlers.filter(h => {
      h.handler(event);
      return h.once ? false : true;
    });

    this.handleMap.set(event.constructor, newHandlers);

    return this;
  }

  once<T extends typeof BaseEvent>(type: T, handler: (event: InstanceType<T>) => void) {
    this.handleMap.set(type, [...(this.handleMap.get(type) || []), { handler, once: true }]);
    return this;
  }

  on<T extends typeof BaseEvent>(type: T, handler: (event: InstanceType<T>) => void) {
    this.handleMap.set(type, [...(this.handleMap.get(type) || []), { handler }]);
    return this;
  }

  off<T extends typeof BaseEvent>(type?: T, handler?: Function) {
    // 卸载指定 handler
    if (type && handler) {
      this.handleMap.set(
        type,
        [...(this.handleMap.get(type) || [])].filter(_h => _h.handler !== handler)
      );
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
