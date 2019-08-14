export const runtimeMs = (fn: Function): [any, number] => {
  const a = new Date();
  const res = fn();
  const b = new Date();

  const delta = b.valueOf() - a.valueOf();

  return [res, delta];
};
