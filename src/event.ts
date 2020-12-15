import { DriverStageEnum, TaskStageEnum } from './enum';
import { BaseTask } from './task';
import { BaseEvent } from 'ah-event-bus';

/** 每个 yield 事件 */
export class YieldEvent extends BaseEvent {
  static displayName = 'Yield';
  constructor(public readonly value: any, public readonly task: BaseTask<any>) {
    super();
  }
}

/** driver stage 变化 */
export class DriverStageChangeEvent extends BaseEvent {
  static displayName = 'DriverStageChangeEvent';
  constructor(
    public readonly stage: DriverStageEnum,
    public readonly extra: { lastStage: DriverStageEnum }
  ) {
    super();
  }

  public isRunning() {
    return this.stage === DriverStageEnum.running;
  }

  public isDone() {
    return this.stage === DriverStageEnum.done;
  }

  public isError() {
    return this.stage === DriverStageEnum.error;
  }
}

/** 任务 stage 变化 */
export class TaskStageChangeEvent extends BaseEvent {
  static displayName = 'TaskStageChangeEvent';
  constructor(
    public readonly stage: TaskStageEnum,
    public readonly extra: { task: BaseTask; lastStage: TaskStageEnum }
  ) {
    super();
  }

  public isRunning() {
    return this.stage === TaskStageEnum.running;
  }

  public isDone() {
    return this.stage === TaskStageEnum.done;
  }

  public isError() {
    return this.stage === TaskStageEnum.error;
  }
}
