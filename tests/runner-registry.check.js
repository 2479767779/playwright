// 回归自检：resolveRunner 必须按通道精确命中，不能退化成「取 runningProcesses 的第一个」。
//
// 运行方式：  node tests/runner-registry.check.js
//（不是 @playwright/test 用例 —— 本仓库没装该依赖，所以文件名故意用 .check.js，
//  避免被 Playwright 的默认 testMatch 收集。）
//
// 这个检查不需要起服务、不需要跑浏览器任务，纯逻辑断言。
'use strict';
const assert = require('assert');
const { resolveRunner } = require('../runner-registry');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
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

console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
