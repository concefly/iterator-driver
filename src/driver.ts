import {
  EventBus,
  BaseEvent,
  DoneEvent,
  YieldEvent,
  StartEvent,
  PauseEvent,
  ResumeEvent,
  DropEvent,
  EmptyEvent,
  DisposeEvent,
} from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, cond, noop } from './util';

export type ITaskStage = 'init' | 'prepare' | 'running' | 'error' | 'dropped' | 'done';

export type ITaskData<T> = {
  task: T;
  stage: ITaskStage;

  /** 运行 ms 数 */
  ms?: number;
  sendValue?: any;
  error?: Error;
};

/** 创建切片任务驱动器 */
export class TaskDriver<T extends BaseTask = BaseTask> {
  protected taskPool = new Map<string, ITaskData<T>>();
  protected eventBus = new EventBus();
  protected isPaused = false;
  protected cancelNextSliceScheduler?: () => void;

  constructor(
    tasks: T[],
    protected readonly scheduler: BaseScheduler,
    protected readonly callback?: (value: T) => void,
    protected readonly config?: {
      /** 添加任务时自动启动 */
      autoStart?: boolean;
    }
  ) {
    // 初始化任务池
    this.taskPool = new Map(
      tasks.map(task => [
        task.name,
        {
          task,
          stage: 'init',
        } as ITaskData<T>,
      ])
    );
  }

  protected emitAll<E extends BaseEvent>(
    event: E,
    tasks: T[] = [...this.taskPool.values()].map(d => d.task)
  ) {
    // 给自己 emit
    this.eventBus.emit(event);
    // 给 task emit
    for (const task of tasks) {
      task.eventBus.emit(event);
    }
  }

  /** @override 自定义选取 task */
  protected pickTask(tasks: ITaskData<T>[]): T | undefined {
    if (tasks.length === 0) return;

    // 优先级大的排后面
    tasks.sort((a, b) => {
      return (
        // 优先级排序
        a.task.priority - b.task.priority ||
        // 次优先级排序
        a.task.minorPriority - b.task.minorPriority ||
        // 运行时间排序
        (() => {
          const aMs = a.ms || 0;
          const bMs = b.ms || 0;
          // 耗时越长，优先级约低
          return bMs - aMs;
        })()
      );
    });

    return tasks.pop()?.task;
  }

  /** @override 自定义判断任务是否执行 */
  protected shouldTaskRun(_task: T): boolean {
    return true;
  }

  protected pickTaskData(taskDataList: ITaskData<T>[]): ITaskData<T> | undefined {
    taskDataList = taskDataList.filter(t => this.shouldTaskRun(t.task));

    const taskName = this.pickTask(taskDataList)?.name;
    return taskName ? this.taskPool.get(taskName) : undefined;
  }

  /**
   * @override 判断是否要进行此次调度
   */
  protected shouldRunCallLoop(): boolean {
    return true;
  }

  protected getUnFinishTaskData(): ITaskData<T>[] {
    return [...this.taskPool.values()].filter(
      d => d.stage === 'init' || d.stage === 'prepare' || d.stage === 'running'
    );
  }

  protected callLoop = (): void => {
    const unFinishTaskData = this.getUnFinishTaskData();

    // 任务队列空了，退出
    if (unFinishTaskData.length === 0) {
      this.emitAll(new EmptyEvent(), []);
      return;
    }

    const setCleanerThenScheduleNext = (fn: () => void) => {
      this.cancelNextSliceScheduler = this.scheduler.schedule(fn);
    };

    // 判断是否暂停中
    if (this.isPaused) return setCleanerThenScheduleNext(this.callLoop);

    // 自定义检查
    if (!this.shouldRunCallLoop()) return setCleanerThenScheduleNext(this.callLoop);

    // 取出优先级最高的任务
    const taskData = this.pickTaskData(unFinishTaskData);
    if (!taskData) return setCleanerThenScheduleNext(this.callLoop);

    const runTask = () => {
      // 设置运行标记
      taskData.stage = 'running';

      const { task, sendValue: lastSendValue, ms: lastMs } = taskData;

      try {
        const [{ value, done }, ms] = runtimeMs(() => task.iter.next(lastSendValue));

        // 累加运行时间
        taskData.ms = (lastMs || 0) + ms;

        toPromise(value)
          .then(resolvedValue => {
            if (taskData.stage === 'running') {
              // 记录 sendValue
              taskData.sendValue = resolvedValue;

              if (done) {
                taskData.stage = 'done';
                this.emitAll(new DoneEvent(null, resolvedValue, task), [task]);
              } else {
                taskData.stage = 'prepare';
                this.callback && this.callback(resolvedValue);
                this.emitAll(new YieldEvent(resolvedValue, task), [task]);
              }
            } else {
              // 被修改了状态，则什么都不干（比如调了 drop）
            }

            // 调度下一个
            this.callLoop();
          })
          .catch(e => {
            taskData.stage = 'error';
            taskData.error = e;

            this.emitAll(new DoneEvent(e, undefined, task), [task]);

            // 调度下一个
            this.callLoop();
          });
      } catch (e) {
        taskData.stage = 'error';
        taskData.error = e;

        // 发生了同步错误
        this.emitAll(new DoneEvent(e, undefined, task), [task]);

        // 调度下一个
        this.callLoop();
      }
    };

    taskData.stage = 'prepare';
    setCleanerThenScheduleNext(runTask);
  };

  start() {
    if (this.isRunning) return this;

    this.emitAll(new StartEvent());
    this.callLoop();

    return this;
  }

  pause() {
    this.isPaused = true;
    this.emitAll(new PauseEvent());
    return this;
  }

  resume() {
    this.isPaused = false;
    this.emitAll(new ResumeEvent());
    return this;
  }

  drop(tasks: T[]) {
    const stageHandler = cond<{ taskData: ITaskData<T> }>({
      init: ctx => {
        ctx.taskData.stage = 'dropped';
      },
      prepare: ctx => {
        ctx.taskData.stage = 'dropped';
      },
      running: ctx => {
        ctx.taskData.stage = 'dropped';
      },
      error: noop,
      dropped: noop,
      done: ctx => {
        ctx.taskData.task.iter.return?.();
      },
    });

    // 结束任务
    tasks.forEach(({ name }) => {
      const taskData = this.taskPool.get(name);
      if (!taskData) return;

      stageHandler(taskData.stage, { taskData });
    });

    // 抛事件
    this.emitAll(new DropEvent(tasks), tasks);
    return this;
  }

  dropAll() {
    const tasks = this.getUnFinishTaskQueue();
    this.drop(tasks);

    return this;
  }

  /**
   * 销毁
   * - 清理各种定时器
   * - 重置状态
   */
  dispose() {
    // 卸掉所有任务
    this.dropAll();

    // 清除任务池
    this.taskPool.clear();

    this.cancelNextSliceScheduler && this.cancelNextSliceScheduler();
    this.isPaused = false;

    // 先发一个事件，然后把事件总线关掉
    this.emitAll(new DisposeEvent(), []);
    this.eventBus.off();
  }

  addTask(task: T, opt?: { overwrite: boolean }) {
    if (!opt?.overwrite) {
      if (this.taskPool.has(task.name)) throw new Error('当前任务已存在 ' + task.name);
    }

    this.taskPool.set(task.name, {
      task,
      stage: 'init',
    });

    if (this.config?.autoStart) this.start();

    return this;
  }

  /** 获取未完成的任务队列 */
  getUnFinishTaskQueue(): T[] {
    return this.getUnFinishTaskData().map(d => d.task);
  }

  get isRunning(): boolean {
    return [...this.taskPool.values()].some(d => d.stage === 'prepare' || d.stage === 'running');
  }

  on<E extends typeof BaseEvent>(type: E, h: (event: InstanceType<E>) => void) {
    this.eventBus.on(type, h);
    return this;
  }

  off<E extends typeof BaseEvent>(type?: E, h?: Function) {
    this.eventBus.off(type, h);
    return this;
  }
}
