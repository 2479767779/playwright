// 回归自检：网易「跟帖登录态失效」与新版评论区容器。
//
// 背景（2026-10-29 实测）：
//   1) 文章页评论区容器已从 #tieArea 变成 #post_comment_area（class "tie-areas post_comment"）。
//   2) 门户登录态（页头「安全退出」，靠「10天免登录」长期保持）与跟帖登录态是两套：
//      跟帖系统要 NTES_SESS，浏览器会话一结束就没了 →
//      comment.api.163.com/.../users/myInfo 返回 401「未认证用户」→
//      跟帖区整块不渲染、计数显示 0（文章其实有 15 条跟帖）、输入框不存在。
//   3) 旧实现靠「观察页面自己发出的评论接口请求」定位接口，评论区不渲染就永远拿不到，
//      于是评论数变成「未知」；登录判定只看 #tieArea 里的昵称，于是误报「未检测到登录态」并死等 5 分钟。
//
// 这些代码在 page.evaluate 注入函数里，Node 无法 import，因此做源码守卫断言。
// 运行方式：node tests/netease-layout.check.js（已接进 npm test）
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
}

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

ok('detect_netease.js 主动探测跟帖登录态（myInfo 401 判定）', () => {
  const src = readSrc('detect_netease.js');
  assert.ok(src.includes('users/myInfo'), '缺少 myInfo 探测：拿不到「跟帖会话是否有效」');
  assert.ok(/status === 401/.test(src), '缺少 401 判定');
  assert.ok(src.includes('portalLoggedIn'), '缺少门户登录态区分（否则会把「门户登录着」当成可以检测）');
});

ok('detect_netease.js 不依赖页面渲染就能拼出跟帖接口', () => {
  const src = readSrc('detect_netease.js');
  assert.ok(/PRODUCT_KEY\s*=\s*'[0-9a-f]{32}'/.test(src), '缺少网易号 productKey 常量');
  assert.ok(src.includes('buildTemplateFromThread'), '缺少「按文章 ID 自建接口」的兜底');
  assert.ok(/threads\/\$\{threadId\}\/comments\/newList/.test(src), '自建接口路径不对');
});

ok('detect_netease.js 评论区容器兼容新旧两套', () => {
  const src = readSrc('detect_netease.js');
  assert.ok(src.includes('#post_comment_area'), '缺少新版容器 #post_comment_area');
  assert.ok(src.includes('#tieArea'), '缺少旧版容器 #tieArea');
});

ok('detect_runner.js 用 myInfo 判定登录，不再只看 #tieArea 昵称', () => {
  const src = readSrc('detect_runner.js');
  assert.ok(src.includes('readNeteaseAuth'), '缺少 readNeteaseAuth');
  assert.ok(src.includes('users/myInfo'), '缺少 myInfo 探测');
  assert.ok(src.includes('安全退出'), '缺少门户登录态识别（页头「安全退出」）');
  assert.ok(src.includes('10天免登录'), '缺少「不要勾选 10 天免登录」的提示');
  assert.ok(!/最多等 5 分钟/.test(src), '不应再出现「最多等 5 分钟」的静默等待');
});

ok('pinglun_netease.js 输入框/发布按钮兼容新版容器', () => {
  const src = readSrc('pinglun_netease.js');
  assert.ok(src.includes('#post_comment_area textarea'), '输入框缺少新版容器');
  assert.ok(src.includes('#tieArea textarea'), '输入框缺少旧版容器');
  assert.ok(src.includes('#post_comment_area .submit-btn'), '发布按钮缺少新版容器');
  assert.ok(src.includes('users/myInfo'), '发布前缺少跟帖登录态检查（会白等 30 秒再含糊失败）');
});

ok('evidence.js 网易截图的定位选择器兼容新版容器', () => {
  const src = readSrc('evidence.js');
  assert.ok(src.includes('#post_comment_area'), '留痕选择器缺少 #post_comment_area');
  assert.ok(src.includes('.tie-areas'), '留痕选择器缺少 .tie-areas');
});

console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
