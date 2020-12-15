import { YieldEvent, TaskStageChangeEvent, DriverStageChangeEvent } from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, enumCond } from './util';
import { DriverStageEnum, TaskStageEnum } from './enum';
import { EventBus, EventClass } from 'ah-event-bus';

/** 创建切片任务驱动器 */
export class TaskDriver<T extends BaseTask = BaseTask> {
  public eventBus = new EventBus();
  private readonly stage: DriverStageEnum = DriverStageEnum.init;
  private error?: Error;

  constructor(
    private readonly tasks: T[],
    private readonly scheduler: BaseScheduler,
    private readonly callback?: (value: T) => void,
    private readonly config?: {
      /** 添加任务时自动启动 */
      autoStart?: boolean;
      autoOverwrite?: boolean;
    }
  ) {}

  private async waitEvOnce<ET extends EventClass>(
    evType: ET,
    tester: (ev: InstanceType<ET>) => boolean = () => true
  ) {
    const clear = () => this.eventBus.off(evType, tester);

    const evPromise = new Promise<InstanceType<ET>>(resolve => {
      this.eventBus.on(evType, ev => {
        if (!tester(ev)) return;
        clear();
        resolve(ev);
      });
    });

    const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 10e3));

    await Promise.race([evPromise, timeoutPromise]).catch(err => {
      console.error(err);
      clear();
    });
  }

  private changeTaskStage(task: T, newStage: TaskStageEnum) {
    if (task.stage === newStage) return;

    const lastStage = task.stage;
    task.stage = newStage;

    this.eventBus.emit(new TaskStageChangeEvent(task.stage, { task, lastStage }));
  }

  private changeStage(ns: DriverStageEnum) {
    if (this.stage === ns) return;

    const lastStage = this.stage;
    (this.stage as any) = ns;

    this.eventBus.emit(new DriverStageChangeEvent(this.stage, { lastStage }));
  }

  /** @override 自定义选取 task */
  protected pickTask(tasks: T[]): T | undefined {
    if (tasks.length === 0) return;

    // 优先级大的排后面
    tasks.sort((a, b) => {
      return (
        // 优先级排序
        a.priority - b.priority ||
        // 次优先级排序
        a.minorPriority - b.minorPriority ||
        // 运行时间排序
        (() => {
          const aMs = a.ms || 0;
          const bMs = b.ms || 0;
          // 耗时越长，优先级约低
          return bMs - aMs;
        })()
      );
    });

    return tasks.pop();
  }

  /** @override 自定义判断任务是否执行 */
  protected shouldTaskRun(_task: T): boolean {
    return true;
  }

  /** @override 判断是否要进行此次调度 */
  protected shouldRunCallLoop(): boolean {
    return true;
  }

  /** 开始 */
  public async start() {
    // float promise
    this.doLoop();
  }

  /** 暂停 */
  public async pause() {
    enumCond<DriverStageEnum, void, void>({
      init: 'skip',
      running: () => this.changeStage(DriverStageEnum.paused),
      paused: 'skip',
      stopping: 'skip',
      done: 'skip',
      error: 'skip',
    })(this.stage);
  }

  /** 恢复 */
  public async resume() {
    enumCond<DriverStageEnum, void, void>({
      init: 'skip',
      paused: () => this.changeStage(DriverStageEnum.running),
      running: 'skip',
      stopping: 'skip',
      done: 'skip',
      error: 'skip',
    })(this.stage);
  }

  /** 卸载任务 */
  public async drop(tasks: T[]) {
    const stageHandler = enumCond<TaskStageEnum, { task: T }, Promise<void>>({
      init: async ctx => this.changeTaskStage(ctx.task, TaskStageEnum.dropped),
      running: async ctx => {
        this.changeTaskStage(ctx.task, TaskStageEnum.dropped);
      },
      error: 'skip',
      dropped: 'skip',
      done: 'skip',
    });

    await Promise.all(tasks.map(async task => stageHandler(task.stage, { task })));
  }

  public async dropAll() {
    const tasks = this.getUnFinishTaskQueue();
    await this.drop(tasks);
  }

  /**
   * 停止
   * - 清理各种定时器
   * - 重置状态
   */
  public async stop() {
    // 卸掉所有任务
    await this.dropAll();

    // 清除任务池
    this.tasks.length = 0;

    const doStop = async () => {
      this.changeStage(DriverStageEnum.stopping);
      await this.waitEvOnce(DriverStageChangeEvent, () => this.stage === DriverStageEnum.done);
    };

    await enumCond<DriverStageEnum, void, Promise<void>>({
      init: async () => this.changeStage(DriverStageEnum.done),
      running: doStop,
      paused: doStop,
      stopping: 'skip',
      done: 'skip',
      error: 'skip',
    })(this.stage);
  }

  public async waitStop() {
    await this.waitEvOnce(DriverStageChangeEvent, () => this.stage === DriverStageEnum.done);
  }

  /**
   * 销毁
   * - stop & 清空事件监听
   */
  public async dispose() {
    await this.stop();
    this.eventBus.off();
  }

  public addTask(task: T) {
    if (!this.config?.autoOverwrite) {
      if (this.tasks.some(t => t.name === task.name)) {
        throw new Error('当前任务已存在 ' + task.name);
      }
    }

    this.tasks.push(task);

    if (this.config?.autoStart) {
      const shouldStart = enumCond<DriverStageEnum, void, boolean>({
        init: () => true,
        done: () => true,
        error: () => true,
        running: 'skip',
        stopping: 'error',
        paused: 'skip',
      })(this.stage);

      if (shouldStart) this.start();
    }

    return this;
  }

  /** 获取未完成的任务队列 */
  public getUnFinishTaskQueue(): T[] {
    return this.tasks.filter(
      d => d.stage === TaskStageEnum.init || d.stage === TaskStageEnum.running
    );
  }

  public get isRunning(): boolean {
    return this.stage === DriverStageEnum.running;
  }

  public getStage(): DriverStageEnum {
    return this.stage;
  }

  public getError() {
    return this.error;
  }

  private async doLoop() {
    // 启动前检查状态
    enumCond<DriverStageEnum, void, void>({
      // 部分状态允许重启
      init: 'skip',
      done: 'skip',
      error: 'skip',
      running: 'error',
      stopping: 'error',
      paused: 'error',
    })(this.stage);

    // 开始
    this.error = undefined;
    this.changeStage(DriverStageEnum.running);

    try {
      while (1) {
        // 每个循环开始都要等待调度
        await new Promise<void>(r => this.scheduler.schedule(r));

        // 执行前检查
        const loopStartAction = enumCond<DriverStageEnum, void, 'continue' | 'break'>({
          init: 'error',
          running: 'skip',
          // 停止中
          stopping: () => {
            this.changeStage(DriverStageEnum.done);
            return 'break';
          },
          done: 'error',
          paused: () => 'continue',
          error: 'skip',
        })(this.stage);

        if (loopStartAction === 'continue') continue;

        // 自定义检查
        if (!this.shouldRunCallLoop()) continue;

        const unfinishedTasks = this.getUnFinishTaskQueue();
        if (unfinishedTasks.length === 0) {
          this.changeStage(DriverStageEnum.done);
          break;
        }

        const shouldRunTasks = unfinishedTasks.filter(d => this.shouldTaskRun(d));
        if (shouldRunTasks.length === 0) continue;

        // 优先级排序
        const toRunTask = this.pickTask(shouldRunTasks);
        if (!toRunTask) continue;

        // 变更 task stage
        this.changeTaskStage(toRunTask, TaskStageEnum.running);
        const { sendValue } = toRunTask;

        // 求值
        let resolvedValue: any;
        let isDone = false;
        let invokeMs = 0;

        try {
          const [{ value, done }, ms] = runtimeMs(() => toRunTask.iter.next(sendValue));
          invokeMs = ms;
          isDone = !!done;

          resolvedValue = await toPromise(value);

          // 走到这里的时候，toRunTask 的状态可能会发生变化(await)
          if (toRunTask.stage !== TaskStageEnum.running) continue;
        } catch (taskError) {
          toRunTask.error = taskError;
          this.changeTaskStage(toRunTask, TaskStageEnum.error);
          continue;
        }

        // 累加运行时间
        toRunTask.ms = (toRunTask.ms || 0) + invokeMs;

        // 记录 sendValue
        toRunTask.sendValue = resolvedValue;

        if (isDone) {
          this.changeTaskStage(toRunTask, TaskStageEnum.done);
        } else {
          this.callback?.(resolvedValue);
          this.eventBus.emit(new YieldEvent(resolvedValue, toRunTask));
        }
      }
    } catch (driverError) {
      this.error = driverError;
      this.changeStage(DriverStageEnum.error);

      throw driverError;
    }
  }
}
