// eslint-disable-next-line
export enum DriverStageEnum {
  init = 'init',
  stopping = 'stopping',
  done = 'done',
  running = 'running',
  paused = 'paused',
  error = 'error',
}

// eslint-disable-next-line
export enum TaskStageEnum {
  init = 'init',
  running = 'running',
  error = 'error',
  dropped = 'dropped',
  done = 'done',
}
