import { SingleTask, TaskDriver, TimeoutScheduler, EVENT, SerialTask } from '../src';

describe('__tests__/driver.test.ts', () => {
  it('单任务', done => {
    const i1 = (function*() {
      yield 'x';
    })();
    const t1 = new SingleTask(i1);

    const d = new TaskDriver(t1, new TimeoutScheduler(), value => {
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
    const d = new TaskDriver(t1, new TimeoutScheduler(), value => {
      cnt++;
      expect(value).toBe(`i${cnt}`);
    });

    d.on(EVENT.Done, () => {
      done();
    });

    d.start();
  });

  describe('优先级任务', () => {
    it('priority 调度', done => {
      const i1 = (function*() {
        yield 'i1';
      })();
      const i2 = (function*() {
        yield 'i2';
      })();
      const i3 = (function*() {
        yield 'i3';
      })();

      const t1 = new SingleTask(i1, 1);
      const t2 = new SingleTask(i2, 2);
      const t3 = new SingleTask(i3, 3);

      let cnt = 3;
      const d = new TaskDriver([t1, t3, t2], new TimeoutScheduler(), value => {
        expect(value).toBe(`i${cnt}`);
        cnt--;
      });

      d.on(EVENT.Done, () => {
        done();
      });

      d.start();
    });

    it('runtime ms 调度', done => {
      const i1 = (function*() {
        yield 'i1.1';
        yield 'i1.2';
      })();
      const i2 = (function*() {
        for (let i = 0; i < 1e8; i++) {}
        yield 'i2.1';
        yield 'i2.2';
      })();

      const t1 = new SingleTask(i1);
      const t2 = new SingleTask(i2);

      let cnt = 0;
      const d = new TaskDriver([t1, t2], new TimeoutScheduler(), value => {
        cnt++;

        cnt === 1 && expect(value).toBe(`i2.1`);
        // i2.1 耗时较长，所以 i1 任务先执行了
        cnt === 2 && expect(value).toBe(`i1.1`);
        cnt === 3 && expect(value).toBe(`i1.2`);
        cnt === 4 && expect(value).toBe(`i2.2`);
      });

      d.on(EVENT.Done, () => {
        done();
      });

      d.start();
    });
  });
});
