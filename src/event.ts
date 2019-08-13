export class BaseEvent {}

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

  off<T extends typeof BaseEvent>(type: T, handler: Function) {
    this.handleMap.set(type, [...(this.handleMap.get(type) || [])].filter(_h => _h !== handler));
    return this;
  }
}
