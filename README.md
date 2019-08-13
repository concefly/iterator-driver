<h1 align="center">iterator-driver</h1>
<p>
  <a href="https://github.com/concefly/iterator-driver#readme">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" target="_blank" />
  </a>
  <a href="https://github.com/concefly/iterator-driver/graphs/commit-activity">
    <img alt="Maintenance" src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" target="_blank" />
  </a>
  <a href="https://github.com/concefly/iterator-driver/blob/master/LICENSE">
    <img alt="License: ISC" src="https://img.shields.io/badge/License-ISC-yellow.svg" target="_blank" />
  </a>
</p>

### 🏠 [Homepage](https://github.com/concefly/iterator-driver#readme)

Tiny 迭代器驱动

## Usage

TL; DR

```js
import { createTaskDriver, createTask, idleScheduler } from 'iterator-driver';

const i1 = (function*() {
  yield 'x';
})();
const t1 = createTask(i1);

const driver = createTaskDriver(t1, idleScheduler, value => {
  console.log(value); // print 'x'
});

driver.on('done', () => {
  console.log('It is done!')
});

driver.start();
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