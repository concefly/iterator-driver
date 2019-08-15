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

  it('可以 yield 各种值', done => {
    const i1 = (function*() {
      yield null;
      yield undefined;
      yield 'a';
      yield new Promise(resolve => setTimeout(() => resolve('b'), 100));
      yield [1, new Promise(resolve => setTimeout(() => resolve('1.1'), 100))];
      yield { c: 'c' };
    })();
    const t1 = new SingleTask(i1);

    let cnt = 0;
    const d = new TaskDriver(t1, new TimeoutScheduler(), value => {
      cnt++;
      cnt === 1 && expect(value).toBeNull();
      cnt === 2 && expect(value).toBeUndefined();
      cnt === 3 && expect(value).toEqual('a');
      cnt === 4 && expect(value).toEqual('b');
      cnt === 5 && expect(value).toEqual([1, '1.1']);
      cnt === 6 && expect(value).toEqual({ c: 'c' });
    });

    d.on(EVENT.Done, () => done()).start();
  });

  it('yield 可以拿到 send 的值', done => {
    const i1 = (function*() {
      let res: any;

      res = yield new Promise(resolve => setTimeout(() => resolve('1.1'), 100));
      expect(res).toEqual('1.1');

      res = yield '1.2';
      expect(res).toEqual('1.2');
    })();

    const i2 = (function*() {
      let res: any;

      res = yield new Promise(resolve => setTimeout(() => resolve('2.1'), 100));
      expect(res).toEqual('2.1');

      res = yield '2.2';
      expect(res).toEqual('2.2');
    })();

    const t1 = new SingleTask(i1);
    const t2 = new SingleTask(i2);

    const d = new TaskDriver([t1, t2], new TimeoutScheduler());

    d.on(EVENT.Done, () => done()).start();
  });

  it('yield 可以 catch', done => {
    const i1 = (function*() {
      try {
        yield Promise.reject('err');
      } catch (e) {
        expect(e).toEqual('err');
      }
    })();
    const t1 = new SingleTask(i1);

    const d = new TaskDriver(t1, new TimeoutScheduler(), () => {});
    d.on(EVENT.Done, () => done()).start();
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
        if (cnt === 5) throw new Error();
      });

      d.on(EVENT.Done, () => {
        done();
      });

      d.start();
    });

    it('动态 priority', done => {
      const i1 = (function*() {
        yield 'i1.1';
        yield 'i1.2';
      })();
      const i2 = (function*() {
        yield 'i2.1';
        yield 'i2.2';
      })();

      const t1 = new SingleTask(i1);
      const t2 = new SingleTask(i2, 1);

      let cnt = 0;
      const d = new TaskDriver([t1, t2], new TimeoutScheduler(), value => {
        cnt++;

        if (cnt === 1) t1.priority = 2;

        cnt === 1 && expect(value).toBe('i2.1');
        cnt === 2 && expect(value).toBe('i1.1');
        cnt === 3 && expect(value).toBe('i1.2');
        cnt === 4 && expect(value).toBe('i2.2');
      });

      d.on(EVENT.Done, () => {
        done();
      });

      d.start();
    });
  });
});
