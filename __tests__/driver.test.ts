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
    }).on(EVENT.Empty, () => {
      expect(startFlag).toBe(1);
      done();
    });

    d.start();
  });

  it('driver 事件流', done => {
    const i1 = (function*() {
      yield '1.1';
      yield '1.2';
      return '1.3';
    })();
    const i2 = (function*() {
      yield '2.1';
      yield '2.2';
      return '2.3';
    })();
    const t1 = new SingleTask(i1, 2);
    const t2 = new SingleTask(i2, 1);

    const d = new TaskDriver([t1, t2], new TimeoutScheduler());

    let cnt = 0;

    d.on(EVENT.Start, () => {
      cnt++;
      expect(cnt).toEqual(1);
    })
      .on(EVENT.Yield, e => {
        cnt++;
        cnt === 2 && expect(e.value).toEqual('1.1');
        cnt === 3 && expect(e.value).toEqual('1.2');
        cnt === 5 && expect(e.value).toEqual('2.1');
        cnt === 6 && expect(e.value).toEqual('2.2');
      })
      .on(EVENT.Done, e => {
        cnt++;
        cnt === 4 && expect(e.value).toEqual('1.3');
        cnt === 7 && expect(e.value).toEqual('2.3');
        expect(e.error).toBeNull();
      })
      .on(EVENT.Empty, () => {
        cnt++;
        expect(cnt).toEqual(8);
        done();
      })
      .start();
  });

  it('task 事件流', done => {
    const i1 = (function*() {
      yield '1.1';
      yield '1.2';
      return '1.3';
    })();

    const t1Flag = {
      Start: 0,
      Yield: 0,
      Done: 0,
    };

    const t1 = new SingleTask(i1)
      .on(EVENT.Start, () => t1Flag.Start++)
      .on(EVENT.Yield, () => t1Flag.Yield++)
      .on(EVENT.Done, () => t1Flag.Done++);

    const d = new TaskDriver([t1], new TimeoutScheduler());

    d.on(EVENT.Empty, () => {
      expect(t1Flag).toEqual({
        Start: 1,
        Yield: 2,
        Done: 1,
      });
      done();
    }).start();
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

    d.on(EVENT.Empty, () => {
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

    d.on(EVENT.Empty, () => done()).start();
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

    d.on(EVENT.Empty, () => done()).start();
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
    d.on(EVENT.Empty, () => done()).start();
  });

  it('Empty 后 addTask 可以继续调度', done => {
    const i1 = (function*() {
      yield '1.1';
    })();
    const t1 = new SingleTask(i1);

    const d = new TaskDriver(t1, new TimeoutScheduler());

    let flag = 1;
    let startCnt = 0;

    d.on(EVENT.Start, () => {
      startCnt++;
    })
      .on(EVENT.Empty, () => {
        flag === 2 &&
          (d.addTask(
            (function*() {
              yield '2.1';
            })()
          ),
          (flag = 3));

        if (flag === 4) {
          expect(startCnt).toEqual(2);
          done();
        }
      })
      .on(EVENT.Yield, e => {
        flag === 1 && (expect(e.value).toEqual('1.1'), (flag = 2));
        flag === 3 && (expect(e.value).toEqual('2.1'), (flag = 4));
      })
      .start();
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

      d.on(EVENT.Empty, () => {
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

      d.on(EVENT.Empty, () => {
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

      d.on(EVENT.Empty, () => {
        done();
      });

      d.start();
    });
  });
});
