// 回归自检：runner 原语 + 「按通道定位 runner」的纯逻辑。
//
// 运行方式：  node tests/runner-registry.check.js
//（不是 @playwright/test 用例 —— 本仓库没装该依赖，所以文件名故意用 .check.js，
//  避免被 Playwright 的默认 testMatch 收集。）
//
// 覆盖两块：
//   1) resolveRunner —— 必须按通道精确命中，不能退化成「取 runningProcesses 的第一个」
//   2) createRunner / runPool —— 多平台并行的核心：多子进程、两种暂停粒度、
//      单个平台失败不拖垮其他 lane
// 都不需要起服务、不需要跑浏览器任务，纯逻辑断言。
'use strict';
const assert = require('assert');
const { resolveRunner, createRunner, runPool } = require('../runner-registry');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
}
// 异步用例：把 promise 收集起来，最后统一等待（否则汇总会在用例跑完前就打印了）
const pending = [];
function oka(name, fn) {
  pending.push((async () => {
    try { await fn(); console.log('PASS ' + name); pass++; }
    catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
  })());
}

// 造一个假子进程：记录收到的 IPC 指令
function fakeChild(label) {
  return {
    label,
    connected: true,
    inbox: [],
    send(msg) { this.inbox.push(msg.cmd); },
    kill() { this.killed = true; },
  };
}

// 用带名字的对象当 runner 替身，方便断言「拿到的是哪一个」
const A = { name: 'zhihu-runner' };
const B = { name: 'csdn-runner' };
const ALL = { name: 'allRunner' };
const DET = { name: 'detectRunner' };
const FIX = { name: 'fixRunner' };

// ---- 对照：改造前的实现（用于证明本测试确实能抓到这个 bug）----
function oldResolveRunner(channel, st) {
  const { runningProcesses, allRunner, detectRunner, fixRunner } = st;
  if (channel === 'all') return allRunner || null;
  if (channel === 'detect') return detectRunner || fixRunner || null;
  return allRunner || detectRunner || fixRunner
    || (runningProcesses.size ? [...runningProcesses.values()][0] : null);
}

// ========== 1. 两个平台并行：必须精确命中各自的那个 ==========
ok('两个平台并行 → csdn 请求拿到 csdn 的 runner', () => {
  const m = new Map([['zhihu', A], ['csdn', B]]);
  assert.strictEqual(resolveRunner('csdn', { runningProcesses: m }), B);
});
ok('两个平台并行 → zhihu 请求拿到 zhihu 的 runner', () => {
  const m = new Map([['zhihu', A], ['csdn', B]]);
  assert.strictEqual(resolveRunner('zhihu', { runningProcesses: m }), A);
});
ok('对照：旧实现会把 csdn 请求错误地解析成 zhihu（证明本测试有区分力）', () => {
  const m = new Map([['zhihu', A], ['csdn', B]]);
  const got = oldResolveRunner('csdn', { runningProcesses: m, allRunner: null, detectRunner: null, fixRunner: null });
  assert.strictEqual(got, A);           // 旧逻辑确实拿错
  assert.notStrictEqual(got, B);
});

// ========== 2. 本平台没在跑：返回 null，让接口如实报错 ==========
ok('只跑 zhihu 时请求暂停 csdn → 返回 null（不误伤 zhihu）', () => {
  const m = new Map([['zhihu', A]]);
  assert.strictEqual(resolveRunner('csdn', { runningProcesses: m }), null);
});
ok('对照：旧实现在这种情况下会误命中 zhihu', () => {
  const m = new Map([['zhihu', A]]);
  assert.strictEqual(oldResolveRunner('csdn', { runningProcesses: m, allRunner: null, detectRunner: null, fixRunner: null }), A);
});

// ========== 3. all / detect 通道 ==========
ok("'all' 通道命中 allRunner", () => {
  assert.strictEqual(resolveRunner('all', { runningProcesses: new Map(), allRunner: ALL }), ALL);
});
ok("'detect' 通道优先 detectRunner", () => {
  assert.strictEqual(resolveRunner('detect', { runningProcesses: new Map(), detectRunner: DET, fixRunner: FIX }), DET);
});
ok("'detect' 通道在无 detectRunner 时回退 fixRunner（补跑）", () => {
  assert.strictEqual(resolveRunner('detect', { runningProcesses: new Map(), fixRunner: FIX }), FIX);
});

// ========== 4. 全局序列运行期间的兼容行为 ==========
ok('一键运行中、从平台页请求暂停 → 回退到 allRunner（保留既有行为）', () => {
  assert.strictEqual(resolveRunner('zhihu', { runningProcesses: new Map(), allRunner: ALL }), ALL);
});
ok('补跑中、从平台页请求暂停 → 回退到 fixRunner', () => {
  assert.strictEqual(resolveRunner('zhihu', { runningProcesses: new Map(), fixRunner: FIX }), FIX);
});

// ========== 5. 边界 ==========
ok('未知通道 → null', () => {
  assert.strictEqual(resolveRunner('weibo', { runningProcesses: new Map([['zhihu', A]]) }), null);
});
ok('缺省/空 channel → null', () => {
  assert.strictEqual(resolveRunner(null, { runningProcesses: new Map([['zhihu', A]]) }), null);
  assert.strictEqual(resolveRunner(undefined, {}), null);
});
ok('全都空 → null（不抛异常）', () => {
  assert.strictEqual(resolveRunner('zhihu', { runningProcesses: new Map() }), null);
  assert.strictEqual(resolveRunner('all', {}), null);
  assert.strictEqual(resolveRunner('detect', {}), null);
});

// ============================================================
// 第二部分：createRunner / runPool（多平台并行的核心）
// ============================================================

ok('单平台：setChild 后 hasChild 为真，清空后为假', () => {
  const r = createRunner();
  assert.strictEqual(r.hasChild('zhihu'), false);
  r.setChild('zhihu', fakeChild('z'));
  assert.strictEqual(r.hasChild('zhihu'), true);
  assert.strictEqual(r.hasChild('csdn'), false);
  r.setChild('zhihu', null);
  assert.strictEqual(r.hasChild('zhihu'), false);
});

ok('多平台并行：两个平台的子进程可以同时存在', () => {
  const r = createRunner();
  const z = fakeChild('z'), c = fakeChild('c');
  r.setChild('zhihu', z);
  r.setChild('csdn', c);
  assert.strictEqual(r.children.size, 2);
  assert.strictEqual(r.hasChild('zhihu'), true);
  assert.strictEqual(r.hasChild('csdn'), true);
});

ok('暂停粒度：pause(platform) 只发给该平台', () => {
  const r = createRunner();
  const z = fakeChild('z'), c = fakeChild('c');
  r.setChild('zhihu', z);
  r.setChild('csdn', c);
  assert.strictEqual(r.pause('zhihu'), true);
  assert.deepStrictEqual(z.inbox, ['pause']);
  assert.deepStrictEqual(c.inbox, []);
  assert.strictEqual(r.isPaused('zhihu'), true);
  assert.strictEqual(r.isPaused('csdn'), false);
});

ok('暂停粒度：pause() 不带参数发给全部', () => {
  const r = createRunner();
  const z = fakeChild('z'), c = fakeChild('c');
  r.setChild('zhihu', z);
  r.setChild('csdn', c);
  assert.strictEqual(r.pause(), true);
  assert.deepStrictEqual(z.inbox, ['pause']);
  assert.deepStrictEqual(c.inbox, ['pause']);
  assert.strictEqual(r.paused, true);
  assert.strictEqual(r.isPaused('zhihu'), true);
  assert.strictEqual(r.isPaused('csdn'), true);
});

ok('继续：resume(platform) 只解开该平台，全局 paused 不受影响', () => {
  const r = createRunner();
  const z = fakeChild('z'), c = fakeChild('c');
  r.setChild('zhihu', z);
  r.setChild('csdn', c);
  r.pause('zhihu');
  r.resume('zhihu');
  assert.deepStrictEqual(z.inbox, ['pause', 'resume']);
  assert.deepStrictEqual(c.inbox, []);
  assert.strictEqual(r.isPaused('zhihu'), false);
});

ok('取消粒度：cancel(platform) 只取消该平台，不影响整条序列', () => {
  const r = createRunner();
  const z = fakeChild('z'), c = fakeChild('c');
  r.setChild('zhihu', z);
  r.setChild('csdn', c);
  assert.strictEqual(r.cancel('zhihu'), true);
  assert.deepStrictEqual(z.inbox, ['cancel']);
  assert.deepStrictEqual(c.inbox, []);
  assert.strictEqual(r.isCancelled('zhihu'), true);
  assert.strictEqual(r.isCancelled('csdn'), false);
  assert.strictEqual(r.cancelled, false);
});

ok('取消粒度：cancel() 不带参数取消整条序列并广播', () => {
  const r = createRunner();
  const z = fakeChild('z'), c = fakeChild('c');
  r.setChild('zhihu', z);
  r.setChild('csdn', c);
  r.cancel();
  assert.deepStrictEqual(z.inbox, ['cancel']);
  assert.deepStrictEqual(c.inbox, ['cancel']);
  assert.strictEqual(r.cancelled, true);
  assert.strictEqual(r.isCancelled('zhihu'), true);
  assert.strictEqual(r.isCancelled('csdn'), true);
});

ok('没有子进程时 pause/resume 返回 false（调用方据此如实报错，而不是假装已暂停）', () => {
  const r = createRunner();
  assert.strictEqual(r.pause(), false);
  assert.strictEqual(r.pause('zhihu'), false);
  assert.strictEqual(r.resume('zhihu'), false);
  assert.strictEqual(r.cancel('zhihu'), false);
});

ok('断开的子进程不算数（不会往死进程发 IPC）', () => {
  const r = createRunner();
  const z = fakeChild('z');
  z.connected = false;
  r.setChild('zhihu', z);
  assert.strictEqual(r.hasChild('zhihu'), false);
  assert.strictEqual(r.pause('zhihu'), false);
  assert.deepStrictEqual(z.inbox, []);
});

ok('平台跑完清掉暂停标记（否则会残留成「永远已暂停」）', () => {
  const r = createRunner();
  r.setChild('zhihu', fakeChild('z'));
  r.pause('zhihu');
  assert.strictEqual(r.isPaused('zhihu'), true);
  r.setChild('zhihu', null);
  assert.strictEqual(r.isPaused('zhihu'), false);
});

ok('一个平台被单独暂停后，全局 paused 仍为 false（两者互不污染）', () => {
  const r = createRunner();
  r.setChild('zhihu', fakeChild('z'));
  r.setChild('csdn', fakeChild('c'));
  r.pause('zhihu');
  assert.strictEqual(r.paused, false);
  assert.strictEqual(r.children.size, 2);
});

// ---- runPool ----

oka('runPool 串行（并发 1）：按顺序执行', async () => {
  const order = [];
  await runPool([1, 2, 3], 1, async (n) => { order.push(n); });
  assert.deepStrictEqual(order, [1, 2, 3]);
});

oka('runPool 并发 3：同时在跑的任务数不超过 3', async () => {
  let inFlight = 0, peak = 0;
  const items = [1, 2, 3, 4, 5, 6];
  await runPool(items, 3, async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((res) => setTimeout(res, 15));
    inFlight--;
  });
  assert.strictEqual(peak, 3, '峰值并发应为 3，实际 ' + peak);
});

oka('runPool 并发数超过任务数时按任务数收敛', async () => {
  let inFlight = 0, peak = 0;
  await runPool([1, 2], 6, async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((res) => setTimeout(res, 10));
    inFlight--;
  });
  assert.strictEqual(peak, 2);
});

oka('runPool 非法并发数退化为 1（不会意外并发）', async () => {
  let inFlight = 0, peak = 0;
  await runPool([1, 2, 3], 0, async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((res) => setTimeout(res, 5));
    inFlight--;
  });
  assert.strictEqual(peak, 1);
  inFlight = 0; peak = 0;
  await runPool([1, 2, 3], NaN, async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((res) => setTimeout(res, 5));
    inFlight--;
  });
  assert.strictEqual(peak, 1);
});

oka('runPool 单个任务抛错：其他任务照样跑完，错误被收集而不是冒泡', async () => {
  const done = [];
  const errors = await runPool([1, 2, 3, 4], 2, async (n) => {
    if (n === 2) throw new Error('平台崩了');
    await new Promise((res) => setTimeout(res, 8));
    done.push(n);
  });
  assert.deepStrictEqual(done.sort(), [1, 3, 4], '其余任务应全部执行');
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].item, 2);
  assert.strictEqual(errors[0].error.message, '平台崩了');
});

oka('runPool shouldStop 为真后不再领新任务', async () => {
  const started = [];
  let stop = false;
  await runPool([1, 2, 3, 4, 5, 6], 1, async (n) => {
    started.push(n);
    if (n === 2) stop = true;
  }, () => stop);
  assert.deepStrictEqual(started, [1, 2]);
});

oka('runPool 空列表不抛异常', async () => {
  const errors = await runPool([], 3, async () => { throw new Error('不该被调用'); });
  assert.deepStrictEqual(errors, []);
});

Promise.all(pending).then(() => {
  console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
});
