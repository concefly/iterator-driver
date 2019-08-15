export function runtimeMs<F extends (...args: any) => any>(fn: F): [ReturnType<F>, number] {
  const a = new Date();
  const res = fn();
  const b = new Date();

  const delta = b.valueOf() - a.valueOf();

  return [res, delta];
}
