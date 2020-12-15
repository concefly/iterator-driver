import { TaskStageEnum } from './enum';
import { getUUid } from './util';

type ITaskInitProps<T> = {
  readonly iter: IterableIterator<T>;
  priority?: number;
  minorPriority?: number;
};

export class BaseTask<T = any> {
  // 初始化 task 状态
  public stage = TaskStageEnum.init;

  /** 运行 ms 数 */
  public ms?: number;
  public sendValue?: any;
  public error?: Error;

  constructor(
    private readonly data: ITaskInitProps<T>,
    readonly name: string = getUUid('BaseTask-')
  ) {}

  public get iter() {
    return this.data.iter;
  }

  public get priority() {
    return this.data.priority || 0;
  }

  public set priority(p: number) {
    this.data.priority = p;
  }

  public get minorPriority() {
    return this.data.minorPriority || 0;
  }

  public set minorPriority(p: number) {
    this.data.minorPriority = p;
  }
}
