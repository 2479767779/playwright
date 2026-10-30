// 回归自检：内置服务端口选择。
//
// 背景（2026-10-30）：原来固定 3000 端口，这个号太常见，用户机器上被别的程序占着时，
// 应用只会「启动超时」打不开。现在默认 27188，且被占用时自动往后顺延。
// 同时 server.js 补了 listen 的 error 监听（之前 EADDRINUSE 是 Unhandled error 直接崩）。
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { isPortFree, pickPort } = require('../port-utils');

let pass = 0, fail = 0;
const pending = [];
function ok(name, fn) {
  pending.push({ name, fn });
}

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// 占住一个端口，模拟「被别的程序占用」
function occupy(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

ok('isPortFree：空闲端口返回 true', async () => {
  const free = await isPortFree(53211);
  assert.strictEqual(free, true, '53211 应该是空闲的');
});

ok('isPortFree：被占用端口返回 false', async () => {
  const srv = await occupy(53212);
  try {
    assert.strictEqual(await isPortFree(53212), false, '端口已被占住，应判定不空闲');
  } finally { srv.close(); }
});

ok('pickPort：首选端口被占用时顺延到下一个', async () => {
  const srv = await occupy(53220);
  try {
    const port = await pickPort(53220, 5);
    assert.strictEqual(port, 53221, '应顺延到 53221');
  } finally { srv.close(); }
});

ok('pickPort：全部被占用时返回 0（调用方据此报错）', async () => {
  const servers = [];
  for (let p = 53230; p <= 53232; p++) servers.push(await occupy(p));
  try {
    assert.strictEqual(await pickPort(53230, 3), 0, '全占用应返回 0');
  } finally { servers.forEach((s) => s.close()); }
});

ok('默认端口不再是 3000（main.js / server.js / 启动助手.bat 三处一致）', () => {
  const mainSrc = readSrc('main.js');
  const serverSrc = readSrc('server.js');
  const batSrc = readSrc('启动助手.bat');
  const port = (mainSrc.match(/AI_COMMENT_PORT\)?\s*\|\|\s*(\d+)/) || [])[1];
  assert.ok(port, 'main.js 里没找到默认端口常量');
  assert.notStrictEqual(port, '3000', '默认端口不应再是 3000');
  assert.ok(serverSrc.includes(`|| ${port}`), `server.js 的默认端口与 main.js（${port}）不一致`);
  assert.ok(batSrc.includes(`set AI_COMMENT_PORT=${port}`), `启动助手.bat 的默认端口与 main.js（${port}）不一致`);
  assert.ok(!/localhost:3000|127\.0\.0\.1:3000/.test(batSrc), '启动助手.bat 里还有写死的 3000');
  assert.ok(batSrc.includes('127.0.0.1:%AI_COMMENT_PORT%'), '启动助手.bat 打开的地址应使用端口变量');
});

ok('main.js 不再把端口写死（改成探测 + 注入）', () => {
  const src = readSrc('main.js');
  assert.ok(src.includes('pickPort'), 'main.js 缺少 pickPort 调用');
  assert.ok(/PORT:\s*String\(port\)/.test(src), 'main.js 应把选中的端口注入子进程');
  assert.ok(!/localhost:3000/.test(src), 'main.js 里还有写死的 localhost:3000');
  assert.ok(/loadURL\(`http:\/\/127\.0\.0\.1:\$\{activePort\}`\)/.test(src), 'loadURL 应使用动态端口');
});

ok('server.js 监听失败有 error 处理（不再 Unhandled error 崩掉）', () => {
  const src = readSrc('server.js');
  assert.ok(/server\.on\('error'/.test(src), '缺少 server.on(error)');
  assert.ok(src.includes('EADDRINUSE'), '缺少端口占用（EADDRINUSE）分支');
});

ok('打包清单包含 port-utils.js（否则打包版启动就崩）', () => {
  const pkg = JSON.parse(readSrc('package.json'));
  assert.ok(pkg.build.files.includes('port-utils.js'), 'build.files 缺少 port-utils.js');
});

(async () => {
  for (const { name, fn } of pending) {
    try { await fn(); console.log('PASS ' + name); pass++; }
    catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
  }
  console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
