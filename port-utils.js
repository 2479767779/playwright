// 端口工具：挑一个真正能绑定的本机端口。
//
// 为什么单独抽出来：main.js 一旦被 require 就会走 Electron 的 app 生命周期，没法单测；
// 这里只依赖 net，可以单独跑 `node tests/port.check.js` 验证。
const net = require('net');

// 先真的绑一次再释放 —— 比「看有没有进程连得上」可靠：
// 有些程序绑的是 0.0.0.0 或 ::1，单纯 connect 127.0.0.1 测不出来（会误判为空闲）。
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

// 从 start 开始往后找，返回第一个空闲端口；全被占用返回 0
async function pickPort(start, count = 10) {
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(start + i)) return start + i;
  }
  return 0;
}

module.exports = { isPortFree, pickPort };
