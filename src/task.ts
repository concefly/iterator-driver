import { EventBus, BaseEvent } from './event';
import { getUUid } from './util';

type ITaskInitProps<T> = {
  readonly iter: IterableIterator<T>;
  priority?: number;
  minorPriority?: number;
};

export class BaseTask<T = any> {
  eventBus = new EventBus();
  constructor(
    private readonly data: ITaskInitProps<T>,
    readonly name: string = getUUid('BaseTask-')
  ) {}

  get iter() {
    return this.data.iter;
  }

  get priority() {
    return this.data.priority || 0;
  }

  set priority(p: number) {
    this.data.priority = p;
  }

  get minorPriority() {
    return this.data.minorPriority || 0;
  }

  set minorPriority(p: number) {
    this.data.minorPriority = p;
  }

  on<T extends typeof BaseEvent>(type: T, h: (event: InstanceType<T>) => void) {
    this.eventBus.on(type, h);
    return this;
  }

  off<T extends typeof BaseEvent>(type?: T, h?: Function) {
    this.eventBus.off(type, h);
    return this;
  }
}
