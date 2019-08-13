import { createTaskDriver, createTask, syncScheduler, createSerialTask } from '../src';

describe('__tests__/driver.test.ts', () => {
  it('单任务', done => {
    const i1 = (function*() {
      yield 'x';
    })();
    const t1 = createTask(i1);

    const d = createTaskDriver(t1, syncScheduler, value => {
      expect(value).toBe('x');
    });

    d.on('done', () => {
      done();
    });

    d.start();
  });

  it('多串行任务', done => {
    const i1 = (function*() {
      yield 'i1';
    })();
    const i2 = (function*() {
      yield 'i2';
    })();

    const t1 = createSerialTask([i1, i2]);

    let cnt = 0;
    const d = createTaskDriver(t1, syncScheduler, value => {
      cnt++;
      expect(value).toBe(`i${cnt}`);
    });

    d.on('done', () => {
      done();
    });

    d.start();
  });
});
