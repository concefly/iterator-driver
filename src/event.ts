import { IEventBus } from './interface';

export const createEventBus = (): IEventBus => {
  const handleMap = new Map<string, Function[]>();

  const bus: IEventBus = { on, off, emit };

  function on(e: string, fn: Function) {
    handleMap.set(e, [...(handleMap.get(e) || []), fn]);
    return bus;
  }

  function off(e: string, fn: Function) {
    handleMap.set(e, [...(handleMap.get(e) || [])].filter(_fn => _fn !== fn));
    return bus;
  }

  function emit(e: string, ...data: any[]) {
    const handlers = handleMap.get(e) || [];
    handlers.forEach(fn => fn(...data));
    return bus;
  }

  return bus;
};
