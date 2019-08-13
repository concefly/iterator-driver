import { SingleTask, TaskDriver, BaseScheduler, EVENT, SerialTask } from '../src';

describe('__tests__/driver.test.ts', () => {
  it('单任务', done => {
    const i1 = (function*() {
      yield 'x';
    })();
    const t1 = new SingleTask(i1);

    const d = new TaskDriver(t1, new BaseScheduler(), value => {
      expect(value).toBe('x');
    });

    let startFlag = 0;

    d.on(EVENT.Start, () => {
      startFlag++;
    }).on(EVENT.Done, () => {
      expect(startFlag).toBe(1);
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

    const t1 = new SerialTask([i1, i2]);

    let cnt = 0;
    const d = new TaskDriver(t1, new BaseScheduler(), value => {
      cnt++;
      expect(value).toBe(`i${cnt}`);
    });

    d.on(EVENT.Done, () => {
      done();
    });

    d.start();
  });
});
