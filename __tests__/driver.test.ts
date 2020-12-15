import {
  TaskDriver,
  TimeoutScheduler,
  BaseTask,
  YieldEvent,
  TaskStageChangeEvent,
  DriverStageChangeEvent,
  DriverStageEnum,
} from '../src';

describe('__tests__/driver.test.ts', () => {
  it('单任务', done => {
    const i1 = (function* () {
      yield 'x';
    })();
    const t1 = new BaseTask({ iter: i1 });

    const d = new TaskDriver([t1], new TimeoutScheduler(), value => {
      expect(value).toBe('x');
    });

    let startFlag = 0;

    d.eventBus.on(DriverStageChangeEvent, ev => {
      if (ev.stage === DriverStageEnum.running) {
        startFlag++;
      } else if (ev.stage === DriverStageEnum.done) {
        expect(startFlag).toBe(1);
        done();
      }
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

    driver.eventBus
      .on(DriverStageChangeEvent, ev => {
        flag.push(`DriverStageChangeEvent-${ev.extra.lastStage}->${ev.stage}`);

        if (ev.isDone()) {
          expect(flag).toMatchSnapshot();
          done();
        }
      })
      .on(TaskStageChangeEvent, ev => {
        flag.push(
          `TaskStageChangeEvent-${ev.extra.task.name}-${ev.extra.lastStage}->${ev.extra.task.stage}`
        );
      })
      .on(YieldEvent, e => {
        flag.push(`YieldEvent-${e.value}`);
        if (e.value === '2.2') driver.drop([t2]);
      });

    driver.start();
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
    const d = new TaskDriver([t1], new TimeoutScheduler(), value => {
      cnt++;
      cnt === 1 && expect(value).toBeNull();
      cnt === 2 && expect(value).toBeUndefined();
      cnt === 3 && expect(value).toEqual('a');
      cnt === 4 && expect(value).toEqual('b');
      cnt === 5 && expect(value).toEqual([1, '1.1']);
      cnt === 6 && expect(value).toEqual({ c: 'c' });
    });

    d.eventBus.on(DriverStageChangeEvent, ev => {
      if (ev.isDone()) done();
    });

    d.start();
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

    d.eventBus.on(DriverStageChangeEvent, ev => {
      if (ev.isDone()) done();
    });

    d.start();
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

    const d = new TaskDriver([t1], new TimeoutScheduler(), () => {});

    d.eventBus.on(DriverStageChangeEvent, ev => {
      if (ev.isDone()) done();
    });

    d.start();
  });

  it('.start() 之后等待调度再开始任务', done => {
    let flag = 'init';

    const i1 = (function* () {
      flag = 'run i1';
      yield 'x';
    })();
    const t1 = new BaseTask({ iter: i1 });
    const d = new TaskDriver([t1], new TimeoutScheduler());

    d.eventBus.on(TaskStageChangeEvent, ev => {
      if (ev.isDone()) done();
    });

    d.start();

    // .start() 之后，flag 依然是 `init`，表示没有执行过 i1
    expect(flag).toBe('init');
  });

  it('shouldTaskRun test', done => {
    class TestTaskDriver extends TaskDriver {
      private cnt = 10;

      shouldTaskRun(task: BaseTask) {
        if (this.cnt-- === 0) d.stop();

        if (task.name === 'skip') return false;
        else return true;
      }
    }

    const flag: string[] = [];

    const t1 = new BaseTask(
      {
        iter: (function* () {
          let cnt = 3;
          while (cnt--) {
            flag.push('i1');
            yield;
          }
        })(),
        priority: 1,
      },
      'run'
    );

    const t2 = new BaseTask(
      {
        iter: (function* () {
          let cnt = 3;
          while (cnt--) {
            flag.push('i2');
            yield;
          }
        })(),
        priority: 1,
      },
      'skip'
    );

    const d = new TestTaskDriver([t1, t2], new TimeoutScheduler());

    d.eventBus.on(DriverStageChangeEvent, ev => {
      if (ev.isDone()) {
        expect(flag).toEqual(['i1', 'i1', 'i1']);
        done();
      }
    });

    d.start();
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

      d.eventBus.on(TaskStageChangeEvent, ev => {
        if (ev.isDone()) done();
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

      d.eventBus.on(TaskStageChangeEvent, ev => {
        if (ev.isDone()) done();
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

      d.eventBus.on(TaskStageChangeEvent, ev => {
        if (ev.isDone()) done();
      });

      d.start();
    });
  });

  describe('错误堆栈还原', () => {
    it('同步栈 & 异步栈', done => {
      const invokeCnt = { i1: 0, i2: 0, i3: 0 };
      const invokeErrorEvents: { name: string; message: string }[] = [];

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

      const d = new TaskDriver([t1, t2, t3], new TimeoutScheduler());

      d.eventBus
        .on(DriverStageChangeEvent, ev => {
          if (ev.isDone()) {
            expect(invokeCnt).toStrictEqual({ i1: 1, i2: 1, i3: 2 });

            expect(invokeErrorEvents[0].message).toContain('fake error1');
            expect(invokeErrorEvents[0].name).toBe(t1.name);

            expect(invokeErrorEvents[1].message).toContain('fake error2');
            expect(invokeErrorEvents[1].name).toBe(t2.name);

            done();
          }
        })
        .on(TaskStageChangeEvent, ev => {
          if (ev.isError()) {
            invokeErrorEvents.push({
              name: ev.extra.task.name,
              message: ev.extra.task.error!.message,
            });
          }
        });

      d.start();
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

      const d = new TaskDriver<BaseTask>([], new TimeoutScheduler(), undefined, {
        autoStart: true,
      });

      d.eventBus
        .on(DriverStageChangeEvent, ev => {
          if (ev.isRunning()) {
            startCnt++;
          }
        })
        .on(TaskStageChangeEvent, ev => {
          if (ev.isDone()) {
            expect(flag).toBe('i1');
            expect(startCnt).toBe(1);
            done();
          }
        });

      d.addTask(t1);
      d.addTask(t2);
    });
  });
});
