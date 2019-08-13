export type INoopFn = () => any;

export type IScheduler = (callback: INoopFn) => INoopFn;

export type IEventBus = {
  on: (e: string, fn: Function) => IEventBus;
  off: (e: string, fn: Function) => IEventBus;
  emit: (e: string, ...data: any[]) => IEventBus;
};

export interface IDriver {
  start(): void;
  cancel(): void;
  on(e: 'done', handler: INoopFn): void;
  off(e: 'done', handler: Function): void;
}

export interface ITask<T> {
  iter: IterableIterator<T>;
}
