import {
  TaskDriver,
  TimeoutScheduler,
  DoneEvent,
  EmptyEvent,
  BaseTask,
  StartEvent,
  YieldEvent,
  DropEvent,
  DisposeEvent,
} from '../src';

describe('__tests__/driver.test.ts', () => {
  it('单任务', done => {
    const i1 = (function* () {
      yield 'x';
    })();
    const t1 = new BaseTask({ iter: i1 });

    const d = new TaskDriver(t1, new TimeoutScheduler(), value => {
      expect(value).toBe('x');
    });

    let startFlag = 0;

    d.on(StartEvent, () => {
      startFlag++;
    }).on(EmptyEvent, () => {
      expect(startFlag).toBe(1);
      done();
    });

    d.start();
  });

  it('driver 事件流', done => {
    const i1 = (function* () {
      yield '1.1';
      yield '1.2';
      return '1.3';
    })();
    const i2 = (function* () {
      yield '2.1';
      yield '2.2';
      return '2.3';
    })();
    const t1 = new BaseTask({ iter: i1, priority: 2 }, 'BaseTask-1');
    const t2 = new BaseTask({ iter: i2, priority: 1 }, 'BaseTask-2');

    const driver = new TaskDriver([t1, t2], new TimeoutScheduler());

    let flag: string[] = [];

    driver
      .on(StartEvent, () => {
        flag.push('StartEvent');
      })
      .on(YieldEvent, e => {
        flag.push(`YieldEvent-${e.value}`);
        if (e.value === '2.2') driver.drop([t2]);
      })
      .on(DoneEvent, e => {
        flag.push(`DoneEvent-${e.value}-${e.error}`);
      })
      .on(DropEvent, e => {
        flag.push(`DropEvent-${e.tasks.map(t => t.name).join(',')}`);
      })
      .on(EmptyEvent, () => {
        flag.push('EmptyEvent');
        driver.dispose();
      })
      .on(DisposeEvent, () => {
        flag.push(`DisposeEvent`);
        expect(flag).toMatchSnapshot();
        done();
      })
      .start();
  });

  it('task 事件流', done => {
    const i1 = (function* () {
      yield '1.1';
      yield '1.2';
      return '1.3';
    })();

    const t1Flag = {
      Start: 0,
      Yield: 0,
      Done: 0,
    };

    const t1 = new BaseTask({ iter: i1 })
      .on(StartEvent, () => t1Flag.Start++)
      .on(YieldEvent, () => t1Flag.Yield++)
      .on(DoneEvent, () => t1Flag.Done++);

    const d = new TaskDriver([t1], new TimeoutScheduler());

    d.on(EmptyEvent, () => {
      expect(t1Flag).toEqual({
        Start: 1,
        Yield: 2,
        Done: 1,
      });
      done();
    }).start();
  });

  it('可以 yield 各种值', done => {
    const i1 = (function* () {
      yield null;
      yield undefined;
      yield 'a';
      yield new Promise(resolve => setTimeout(() => resolve('b'), 100));
      yield [1, new Promise(resolve => setTimeout(() => resolve('1.1'), 100))];
      yield { c: 'c' };
    })();
    const t1 = new BaseTask({ iter: i1 });

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

    d.on(EmptyEvent, () => done()).start();
  });

  it('yield 可以拿到 send 的值', done => {
    const i1 = (function* () {
      let res: any;

      res = yield new Promise(resolve => setTimeout(() => resolve('1.1'), 100));
      expect(res).toEqual('1.1');

      res = yield '1.2';
      expect(res).toEqual('1.2');
    })();

    const i2 = (function* () {
      let res: any;

      res = yield new Promise(resolve => setTimeout(() => resolve('2.1'), 100));
      expect(res).toEqual('2.1');

      res = yield '2.2';
      expect(res).toEqual('2.2');
    })();

    const t1 = new BaseTask({ iter: i1 });
    const t2 = new BaseTask({ iter: i2 });

    const d = new TaskDriver([t1, t2], new TimeoutScheduler());

    d.on(EmptyEvent, () => done()).start();
  });

  it('yield 可以 catch', done => {
    const i1 = (function* () {
      try {
        yield Promise.reject('err');
      } catch (e) {
        expect(e).toEqual('err');
      }
    })();
    const t1 = new BaseTask({ iter: i1 });

    const d = new TaskDriver(t1, new TimeoutScheduler(), () => {});
    d.on(EmptyEvent, () => done()).start();
  });

  it('.start() 之后等待调度再开始任务', done => {
    let flag = 'init';

    const i1 = (function* () {
      flag = 'run i1';
      yield 'x';
    })();
    const t1 = new BaseTask({ iter: i1 });
    const d = new TaskDriver(t1, new TimeoutScheduler());

    d.on(DoneEvent, () => done()).start();

    // .start() 之后，flag 依然是 `init`，表示没有执行过 i1
    expect(flag).toBe('init');
  });

  it('shouldTaskRun test', done => {
    let cnt = 0;

    class TestTaskDriver extends TaskDriver {
      shouldTaskRun(task: BaseTask) {
        if (cnt++ < 5) {
          return task.name !== 'skip';
        }
        this.dispose();
        return false;
      }
    }

    const flag: string[] = [];

    const t1 = new BaseTask(
      {
        iter: (function* () {
          flag.push('i1');
        })(),
        priority: 1,
      },
      'run'
    );

    const t2 = new BaseTask(
      {
        iter: (function* () {
          flag.push('i2');
        })(),
        priority: 1,
      },
      'skip'
    );

    const d = new TestTaskDriver([t1, t2], new TimeoutScheduler(), value => {
      expect(value).toBe('x');
    });

    d.on(DropEvent, () => {
      expect(flag).toEqual(['i1']);
      done();
    }).start();
  });

  describe('优先级任务', () => {
    it('priority 调度', done => {
      const i1 = (function* () {
        yield 'i1';
      })();
      const i2 = (function* () {
        yield 'i2';
      })();
      const i3 = (function* () {
        yield 'i3';
      })();

      const t1 = new BaseTask({ iter: i1, priority: 1 });
      const t2 = new BaseTask({ iter: i2, priority: 2 });
      const t3 = new BaseTask({ iter: i3, priority: 3 });

      let cnt = 3;
      const d = new TaskDriver([t1, t3, t2], new TimeoutScheduler(), value => {
        expect(value).toBe(`i${cnt}`);
        cnt--;
      });

      d.on(EmptyEvent, () => {
        done();
      });

      d.start();
    });

    it('runtime ms 调度', done => {
      const i1 = (function* () {
        yield 'i1.1';
        yield 'i1.2';
      })();
      const i2 = (function* () {
        for (let i = 0; i < 1e8; i++) {}
        yield 'i2.1';
        yield 'i2.2';
      })();

      const t1 = new BaseTask({ iter: i1 });
      const t2 = new BaseTask({ iter: i2 });

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

      d.on(EmptyEvent, () => {
        done();
      });

      d.start();
    });

    it('动态 priority', done => {
      const i1 = (function* () {
        yield 'i1.1';
        yield 'i1.2';
      })();
      const i2 = (function* () {
        yield 'i2.1';
        yield 'i2.2';
      })();

      const t1 = new BaseTask({ iter: i1 });
      const t2 = new BaseTask({ iter: i2, priority: 1 });

      let cnt = 0;
      const d = new TaskDriver([t1, t2], new TimeoutScheduler(), value => {
        cnt++;

        if (cnt === 1) t1.priority = 2;

        cnt === 1 && expect(value).toBe('i2.1');
        cnt === 2 && expect(value).toBe('i1.1');
        cnt === 3 && expect(value).toBe('i1.2');
        cnt === 4 && expect(value).toBe('i2.2');
      });

      d.on(EmptyEvent, () => {
        done();
      });

      d.start();
    });
  });

  describe('错误堆栈还原', () => {
    it.only('同步栈 & 异步栈', done => {
      const invokeCnt = { i1: 0, i2: 0, i3: 0 };
      const invokeErrorEvents: DoneEvent[] = [];

      // 同步栈
      const i1 = (function* () {
        invokeCnt.i1++;
        yield 1;
        throw new Error('fake error1');
      })();

      // 异步栈
      const i2 = (function* () {
        invokeCnt.i2++;
        yield new Promise((_, reject) => {
          setTimeout(() => reject(new Error('fake error2')), 0);
        });
      })();

      // 正常任务
      const i3 = (function* () {
        yield invokeCnt.i3++;
        yield invokeCnt.i3++;
      })();

      const t1 = new BaseTask<any>({ iter: i1, priority: 10 });
      const t2 = new BaseTask<any>({ iter: i2 });
      const t3 = new BaseTask<any>({ iter: i3 });

      new TaskDriver([t1, t2, t3], new TimeoutScheduler())
        .on(DoneEvent, e => {
          console.log('@@@', 'DoneEvent ->', 1);
          if (e.error) {
            invokeErrorEvents.push(e);
          }
        })
        .on(EmptyEvent, () => {
          console.log('@@@', 'EmptyEvent ->', 1);
          expect(invokeCnt).toStrictEqual({ i1: 1, i2: 1, i3: 2 });

          expect(invokeErrorEvents[0].error?.message).toContain('fake error1');
          expect(invokeErrorEvents[0].task.name).toBe(t1.name);

          expect(invokeErrorEvents[1].error?.message).toContain('fake error2');
          expect(invokeErrorEvents[1].task.name).toBe(t2.name);

          done();
        })
        .start();
    });
  });

  describe('配置项', () => {
    it('autoStart', done => {
      let startCnt = 0;
      let flag = 'init';

      const i1 = (function* () {
        yield 'x';
        flag = 'i1';
      })();
      const t1 = new BaseTask({ iter: i1, priority: 999 });

      const i2 = (function* () {
        yield 'x';
        flag = 'i2';
      })();
      const t2 = new BaseTask({ iter: i2, priority: 0 });

      const d = new TaskDriver<BaseTask>([], new TimeoutScheduler(), undefined, { autoStart: true })
        .on(StartEvent, () => startCnt++)
        .on(DoneEvent, () => {
          expect(flag).toBe('i1');
          expect(startCnt).toBe(1);
          done();
        });

      d.addTask(t1);
      d.addTask(t2);
    });
  });
});
