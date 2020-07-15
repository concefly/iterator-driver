export function runtimeMs<F extends (...args: any) => any>(fn: F): [ReturnType<F>, number] {
  const a = new Date();
  const res = fn();
  const b = new Date();

  const delta = b.valueOf() - a.valueOf();

  return [res, delta];
}

/** 把任意值变成 promise */
export function toPromise(data: any): Promise<any> {
  // null, undefined ....
  if (!data) return Promise.resolve(data);

  // promise
  if (typeof data.then === 'function') {
    return data;
  }

  // array
  if (Array.isArray(data)) {
    return Promise.all(data.map(d => toPromise(d)));
  }

  // 其他都直接返回
  return Promise.resolve(data);
}

let uuid = 0;
export function getUUid(prefix = '') {
  return `${prefix}${uuid++}`;
}

export function ensureUnique<T>(list: T[], by: keyof T) {
  const t = new Set<any>();

  for (const item of list) {
    const key = item[by];

    if (t.has(key)) throw new Error(`${key} 重复`);
    t.add(key);
  }
}

const injectFlagSym = Symbol('injectFlag');

export function setInjectValue<T>(target: T, value: any): T {
  Object.defineProperty(target, injectFlagSym, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  return target;
}

export function getInjectValue(target: any) {
  return target[injectFlagSym];
}
