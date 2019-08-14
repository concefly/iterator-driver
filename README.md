<h1 align="center">iterator-driver</h1>

![npm bundle size](https://img.shields.io/bundlephobia/min/iterator-driver)
![npm (tag)](https://img.shields.io/npm/v/iterator-driver/latest)
![npm](https://img.shields.io/npm/dw/iterator-driver)

### 🏠 [Homepage](https://github.com/concefly/iterator-driver#readme)

Tiny 迭代器驱动

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
npm install
```

## Run tests

```sh
npm run test
```

## Author

👤 **concefly**

* Github: [@concefly](https://github.com/concefly)

## 🤝 Contributing

Contributions, issues and feature requests are welcome !<br />Feel free to check [issues page](https://github.com/concefly/iterator-driver/issues).

## Show your support

Give a ⭐️ if this project helped you !

## 📝 License

Copyright © 2019 [concefly](https://github.com/concefly).<br />
This project is [ISC](https://github.com/concefly/iterator-driver/blob/master/LICENSE) licensed.

***
_This README was generated with ❤️ by [readme-md-generator](https://github.com/kefranabg/readme-md-generator)_