// runner-registry.js
// runner 的核心原语 + 「按通道定位 runner」的纯逻辑 + 平台顺序常量。
//
// 为什么单独成文件：server.js 一旦被 require 就会立刻启动 HTTP 服务，
// 无法在单测里直接引入。把这些逻辑抽出来，就能用 node 直接断言，
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

// 一键运行的执行顺序（也是「合法平台通道」的白名单）
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

/**
 * 创建一个 runner：管理一条流程的子进程，并支持暂停/继续/取消。
 *
 * 子进程用 **Map（platform → child）** 而不是单个引用：
 * 「多平台并行」时同一时刻会有多个子进程，若只存一个引用，
 * pause/resume/cancel 就只能作用到最后启动的那一个，其余平台会失控。
 *
 * 两种操作粒度：
 *   pause() / resume() / cancel()            → 作用于全部子进程
 *   pause(p) / resume(p) / cancel(p)         → 只作用于平台 p
 * 另外整条序列有一个 cancelled 总开关（一键运行页的「停止」）。
 *
 * @param {{send?: Function, connected?: boolean, kill?: Function}} [childFactory] 仅测试用
 */
function createRunner() {
  const runner = {
    children: new Map(),          // platform -> child
    cancelled: false,             // 整条序列取消
    cancelledPlatforms: new Set(),
    paused: false,                // 全部暂停
    pausedPlatforms: new Set(),
  };

  // 取「活着」的子进程；给了 platform 就只取那一个
  const live = (platform) => {
    const list = platform === undefined
      ? [...runner.children.values()]
      : [runner.children.get(platform)];
    return list.filter((c) => c && typeof c.send === 'function' && c.connected);
  };

  runner.setChild = (platform, child) => {
    if (child) {
      runner.children.set(platform, child);
    } else {
      // 该平台的子进程结束 → 清掉它的暂停标记（否则会残留成「永远已暂停」）
      runner.children.delete(platform);
      runner.pausedPlatforms.delete(platform);
    }
  };
  runner.hasChild = (platform) => live(platform).length > 0;
  runner.isCancelled = (platform) => runner.cancelled || runner.cancelledPlatforms.has(platform);
  runner.isPaused = (platform) => runner.paused || runner.pausedPlatforms.has(platform);

  runner.cancel = (platform) => {
    if (platform === undefined) runner.cancelled = true;
    else runner.cancelledPlatforms.add(platform);
    const targets = live(platform);
    for (const c of targets) {
      try { c.send({ cmd: 'cancel' }); } catch (e) { /* ignore */ }
      // 等 3 秒让子进程发送已完成的结果，再强杀
      setTimeout(() => { try { c.kill(); } catch (e) { /* ignore */ } }, 3000);
    }
    return targets.length > 0;
  };

  // 暂停/继续：通过 ipc 给评论脚本发消息，脚本在下一个检查点阻塞/放行（不重启、不丢进度）
  // 返回布尔值表示「是否真的下发了」：阶段切换的瞬间可能没有子进程，
  // 此时返回 false，让调用方如实报错，而不是让界面假装已暂停（但实际还在跑）。
  runner.pause = (platform) => {
    const targets = live(platform);
    if (!targets.length) return false;
    if (platform === undefined) runner.paused = true;
    else runner.pausedPlatforms.add(platform);
    let sent = false;
    for (const c of targets) { try { c.send({ cmd: 'pause' }); sent = true; } catch (e) { /* ignore */ } }
    return sent;
  };
  runner.resume = (platform) => {
    const targets = live(platform);
    if (!targets.length) return false;
    if (platform === undefined) runner.paused = false;
    else runner.pausedPlatforms.delete(platform);
    let sent = false;
    for (const c of targets) { try { c.send({ cmd: 'resume' }); sent = true; } catch (e) { /* ignore */ } }
    return sent;
  };

  return runner;
}

/**
 * 并发池：最多同时跑 concurrency 个任务，每个 lane 依次领下一个。
 * 串行就是 concurrency=1。用于「多平台并行」。
 *
 * 单个任务抛错**只记录、不中断其他 lane** —— 这点在并行时很重要：
 * 若让异常冒泡到调用方，调用方会收尾退出，而其他 lane 的子进程还在跑，
 * 就变成没人看管的孤儿进程了。返回收集到的错误列表供调用方统一上报。
 */
async function runPool(items, concurrency, worker, shouldStop) {
  const list = items.slice();
  const size = Math.max(1, Math.min(Math.floor(concurrency) || 1, Math.max(list.length, 1)));
  let cursor = 0;
  const errors = [];
  const lanes = Array.from({ length: size }, async () => {
    while (true) {
      if (shouldStop && shouldStop()) return;
      const idx = cursor++;
      if (idx >= list.length) return;
      try {
        await worker(list[idx], idx);
      } catch (e) {
        errors.push({ item: list[idx], index: idx, error: e });
      }
    }
  });
  await Promise.all(lanes);
  return errors;
}

module.exports = { PLATFORM_ORDER, resolveRunner, createRunner, runPool };
