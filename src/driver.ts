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
  StopEvent,
  CrashEvent,
  TaskStageChangeEvent,
} from './event';
import { BaseTask } from './task';
import { BaseScheduler } from './scheduler';
import { runtimeMs, toPromise, cond, noop, setInjectValue, getInjectValue } from './util';
import { DriverStateEnum, TaskStageEnum } from './enum';

/** @deprecated */
export type ITaskData<T> = {
  task: T;
  stage: TaskStageEnum;

  /** 运行 ms 数 */
  ms?: number;
  sendValue?: any;
  error?: Error;
};

enum CommandEnum {
  exit = 'exit',
  continue = 'continue',
}

type IInjectCommandItem = { command: CommandEnum; onEnd?(): void };

/** 创建切片任务驱动器 */
export class TaskDriver<T extends BaseTask = BaseTask> {
  protected eventBus = new EventBus();
  protected state: DriverStateEnum = DriverStateEnum.stop;
  protected injectCommands: IInjectCommandItem[] = [];

  constructor(
    protected readonly tasks: T[],
    protected readonly scheduler: BaseScheduler,
    protected readonly callback?: (value: T) => void,
    protected readonly config?: {
      /** 添加任务时自动启动 */
      autoStart?: boolean;
      autoOverwrite?: boolean;
    }
  ) {}

  protected emitAll<E extends BaseEvent>(event: E, tasks: T[] = this.tasks) {
    // 给自己 emit
    this.eventBus.emit(event);
    // 给 task emit
    for (const task of tasks) {
      task.eventBus.emit(event);
    }
  }

  protected changeTaskStage(task: T, newStage: TaskStageEnum) {
    if (task.stage === newStage) return;

    const lastStage = task.stage;
    task.stage = newStage;

    this.emitAll(new TaskStageChangeEvent(task, { lastStage }));
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

  /**
   * @override 判断是否要进行此次调度
   */
  protected shouldRunCallLoop(): boolean {
    return true;
  }

  async start() {
    // float promise
    this.doLoop();

    return this;
  }

  pause() {
    this.state = DriverStateEnum.paused;
    this.emitAll(new PauseEvent());
    return this;
  }

  resume() {
    this.state = DriverStateEnum.running;
    this.emitAll(new ResumeEvent());
    return this;
  }

  async drop(tasks: T[]) {
    const stageHandler = cond<{ task: T }>({
      init: ctx => this.changeTaskStage(ctx.task, TaskStageEnum.dropped),
      running: ctx => {
        // 卸载正在执行中的任务，要废弃掉当前这个循环
        return new Promise(resolve => {
          this.injectCommands.unshift({
            command: CommandEnum.continue,
            onEnd: () => {
              this.changeTaskStage(ctx.task, TaskStageEnum.dropped);
              this.emitAll(new DropEvent([ctx.task]), [ctx.task]);
              resolve();
            },
          });
        });
      },
      error: noop,
      dropped: noop,
      done: ctx => {
        ctx.task.iter.return?.();
      },
    });

    // 结束任务
    for (const task of tasks) {
      await stageHandler(task.stage, { task });
    }

    return this;
  }

  async dropAll() {
    const tasks = this.getUnFinishTaskQueue();
    await this.drop(tasks);

    return this;
  }

  /**
   * 停止
   * - 清理各种定时器
   * - 重置状态
   */
  async stop() {
    // 卸掉所有任务
    await this.dropAll();

    // 清除任务池
    this.tasks.length = 0;

    if (this.state === DriverStateEnum.running) {
      // 设置退出循环
      await new Promise(resolve => {
        this.injectCommands.unshift({
          command: CommandEnum.exit,
          onEnd: () => {
            this.state = DriverStateEnum.stop;
            this.emitAll(new StopEvent());
            resolve();
          },
        });
      });
    } else if (this.state === DriverStateEnum.stop) {
      // 已经 stop 则什么都不干
    } else {
      this.state = DriverStateEnum.stop;
      this.emitAll(new StopEvent());
    }

    return this;
  }

  /**
   * 销毁
   * - stop & 清空事件监听
   */
  async dispose() {
    await this.stop();
    this.eventBus.off();
    return this;
  }

  addTask(task: T) {
    if (!this.config?.autoOverwrite) {
      if (this.tasks.some(t => t.name === task.name)) {
        throw new Error('当前任务已存在 ' + task.name);
      }
    }

    this.tasks.push(task);

    if (this.config?.autoStart && this.state !== DriverStateEnum.running) this.start();
    return this;
  }

  /** 获取未完成的任务队列 */
  getUnFinishTaskQueue(): T[] {
    return this.tasks.filter(d => d.stage === 'init' || d.stage === 'running');
  }

  get isRunning(): boolean {
    return this.state === 'running';
  }

  on<E extends typeof BaseEvent>(type: E, h: (event: InstanceType<E>) => void) {
    this.eventBus.on(type, h);
    return this;
  }

  off<E extends typeof BaseEvent>(type?: E, h?: Function) {
    this.eventBus.off(type, h);
    return this;
  }

  once<E extends typeof BaseEvent>(type: E, h: (event: InstanceType<E>) => void) {
    this.eventBus.once(type, h);
    return this;
  }

  getState(): DriverStateEnum {
    return this.state;
  }

  protected async doLoop() {
    if (this.state === 'running') return;
    this.state = DriverStateEnum.running;

    const waitPromise = async <T>(value: Promise<T>): Promise<T> => {
      const result = await value;

      // 系统注入的异常
      if (this.injectCommands.length) {
        const commandItem = this.injectCommands.pop()!;
        throw setInjectValue(new Error(commandItem.command), commandItem);
      }

      return result;
    };

    const waitSchedule = () =>
      waitPromise(
        new Promise<void>(r => this.scheduler.schedule(r))
      );

    // 开始事件
    this.emitAll(new StartEvent(), this.tasks);

    const exit = (err?: Error) => {
      if (err) {
        this.state = DriverStateEnum.error;
        this.emitAll(new CrashEvent(err));
      } else {
        if (this.state !== DriverStateEnum.stop) {
          this.state = DriverStateEnum.stop;
          this.emitAll(new StopEvent());
        }
      }
    };

    try {
      while (1) {
        try {
          // 每个循环开始都要等待调度
          await waitSchedule();

          const unfinishedTasks = this.getUnFinishTaskQueue();
          if (unfinishedTasks.length === 0) {
            this.emitAll(new EmptyEvent(), []);
            break;
          }

          // 判断是否暂停中
          // FIXME: ts 类型系统会误判 state 始终为 running
          if ((this.state as any) === 'paused') continue;

          // 自定义检查
          if (!this.shouldRunCallLoop()) continue;

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

            resolvedValue = await waitPromise(toPromise(value));
          } catch (taskError) {
            // 如果是注入的错误，直接往外抛，由外面处理
            if (getInjectValue(taskError)) throw taskError;

            // 否则抛事件，并继续调度
            toRunTask.error = taskError;
            this.changeTaskStage(toRunTask, TaskStageEnum.error);

            this.emitAll(new DoneEvent(taskError, undefined, toRunTask), [toRunTask]);
            continue;
          }

          // 累加运行时间
          toRunTask.ms = (toRunTask.ms || 0) + invokeMs;

          // 记录 sendValue
          toRunTask.sendValue = resolvedValue;

          if (isDone) {
            this.changeTaskStage(toRunTask, TaskStageEnum.done);
            this.emitAll(new DoneEvent(null, resolvedValue, toRunTask), [toRunTask]);
          } else {
            this.callback && this.callback(resolvedValue);
            this.emitAll(new YieldEvent(resolvedValue, toRunTask), [toRunTask]);
          }
        } catch (commonError) {
          const commandItem = getInjectValue(commonError) as IInjectCommandItem;

          if (commandItem) {
            const { command, onEnd } = commandItem;

            // 退出
            if (command === 'exit') {
              onEnd?.();
              break;
            }

            // 下一个循环
            if (command === 'continue') {
              onEnd?.();
              continue;
            }
          } else {
            throw commonError;
          }
        }
      }

      // 执行退出逻辑
      exit();
    } catch (finalError) {
      exit(finalError);
      throw finalError;
    }
  }
}
