// runner-registry.js
// 「按通道定位 runner」的纯逻辑 + 平台顺序常量。
//
// 为什么单独成文件：server.js 一旦被 require 就会立刻启动 HTTP 服务，
// 无法在单测里直接引入。把这段决策逻辑抽出来，就能用 node 直接断言，
// 而不用真的起服务、真的跑一次浏览器任务。
//
// 通道（channel）取值：
//   - 平台名（zhihu / toutiao / csdn / sohu / baidu / netease）
//   - 'all'    ：一键运行（评论全部 → 检测全部）
//   - 'detect' ：独立检测 / 补跑不达标项
//
// ⚠️ 关键约定：平台通道**只在 runningProcesses 里精确查**。
// 绝不能退化成「取 runningProcesses 的第一个」—— 不同平台是允许并行的，
// 那样在 CSDN 页点「暂停」会暂停到知乎（这正是改造前的老 bug）。

// 一键运行的串行顺序（也是「合法平台通道」的白名单）
const PLATFORM_ORDER = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];

/**
 * 定位某个通道当前对应的 runner。
 * @param {string} channel 平台名 / 'all' / 'detect'
 * @param {{runningProcesses?: Map, allRunner?: any, detectRunner?: any, fixRunner?: any}} state
 * @returns {object|null} runner（拿不到返回 null，调用方据此如实报错）
 */
function resolveRunner(channel, state) {
  const { runningProcesses, allRunner, detectRunner, fixRunner } = state || {};

  if (channel === 'all') return allRunner || null;
  if (channel === 'detect') return detectRunner || fixRunner || null;

  if (PLATFORM_ORDER.includes(channel)) {
    // 1) 先精确命中本平台
    const own = runningProcesses && runningProcesses.get(channel);
    if (own) return own;
    // 2) 本平台没在跑时，才回退到全局序列。
    //    这一步无歧义：全局序列运行期间 /api/start 已被 globalSequenceRunning() 拦下，
    //    不可能同时存在并行的单平台任务。保留它是为了不破坏
    //    「一键运行期间在平台页点暂停」的既有行为。
    return allRunner || detectRunner || fixRunner || null;
  }

  return null;
}

module.exports = { PLATFORM_ORDER, resolveRunner };
