<h1 align="center">iterator-driver</h1>

![npm bundle size](https://img.shields.io/bundlephobia/min/iterator-driver)
![npm (tag)](https://img.shields.io/npm/v/iterator-driver/latest)
![npm](https://img.shields.io/npm/dw/iterator-driver)
![Travis (.org)](https://img.shields.io/travis/concefly/iterator-driver)

Tiny 迭代器驱动
- 支持静态 & 动态优先级
- 支持动态插入任务
- 内置 cpu idle、setTimeout 调度器

## Usage

TL; DR

```js
import { SingleTask, TaskDriver, IdleScheduler, EVENT, SerialTask } from 'iterator-driver';

const i1 = (function*() {
  yield 'x';
})();

const t1 = new SingleTask(i1);

const driver = new TaskDriver(t1, new IdleScheduler(), value => {
  console.log(value); // print 'x'
});

driver.on(EVENT.Start, () => {
  console.log('It is start!')
});

driver.on(EVENT.Done, () => {
  console.log('It is done!')
});

driver.on(EVENT.Cancel, () => {
  console.log('It is cancel!')
});

driver.start();
```

### 设置任务优先级

```js
const t1 = new SingleTask(i1, 10);
// or
t1.priority = 20
```

## Install

```sh
npm install iterator-driver
```

## 📝 License

Copyright © 2019 [concefly](https://github.com/concefly).<br />
This project is [ISC](https://github.com/concefly/iterator-driver/blob/master/LICENSE) licensed.
