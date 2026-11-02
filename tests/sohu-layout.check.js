// 回归自检：搜狐评论区的「查看更多精彩评论」加载逻辑。
//
// 背景（2026-11-02 实测）：搜狐文章页评论区只渲染前 15 条，剩下的靠
// 「已有N人参与，点击查看更多精彩评论」（div.more.has-more）**点一次 +10 条**，
// 走 uis.mp.sohu.com/wap/api/comments/pages?page_no=N。
//
// 旧实现两个坑：
//   1) clickLoadMore 的文字正则要求「查看更多…评论」，文案是「查看更多精彩评论」，
//      中间多了「精彩」→ 永远匹配不上；
//   2) 这个 Vue 组件对 DOM 的 el.click() 无反应，必须用真实鼠标点击，数量才会涨。
// 表现：评论停在 15 条、页面却一直往下滚，最终报「已加载 15 条评论，但未匹配到账号」。
//
// 相关代码在 page.evaluate / Playwright 调用里，无法 import 单测，因此做源码守卫。
// 运行方式：node tests/sohu-layout.check.js（已接进 npm test）
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'evidence.js'), 'utf8');

// 截出 clickLoadMore 函数体
function clickLoadMoreBody() {
  const start = src.indexOf('async function clickLoadMore');
  assert.ok(start >= 0, 'evidence.js 里没找到 clickLoadMore');
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end > 0 ? rest.slice(0, end) : rest;
}

ok('clickLoadMore 有搜狐专属分支', () => {
  const body = clickLoadMoreBody();
  assert.ok(/platform === 'sohu'/.test(body), '缺少搜狐分支，会走通用逻辑（点了没反应') ;
});

ok('搜狐分支定位 .more.has-more 并按评论条数确认加载成功', () => {
  const body = clickLoadMoreBody();
  assert.ok(body.includes('.more.has-more'), '缺少 .more.has-more 定位');
  assert.ok(/#commentList \[class\*="comment-item"\], #commentList li/.test(body), '缺少评论条数统计选择器');
  assert.ok(/after > before/.test(body), '缺少「条数是否增长」的确认（点了没涨不能当成功）');
});

ok('搜狐用 Playwright 真实点击（locator.click），不是 DOM el.click', () => {
  const body = clickLoadMoreBody();
  const sohuPart = body.slice(body.indexOf("platform === 'sohu'"), body.indexOf('platform === \'toutiao\''));
  assert.ok(/await button\.click\(/.test(sohuPart), '搜狐分支必须用 locator 真实点击（el.click() 对这个 Vue 组件无效）');
  assert.ok(!/\.evaluate\([^)]*\.click\(\)/s.test(sohuPart), '搜狐分支里不应再用 evaluate 内的 el.click()');
});

ok('「查看更多精彩评论」文案已进通用文字正则（其它平台兜底也认）', () => {
  assert.ok(src.includes('查看更多精彩评论'), '文字正则缺少「查看更多精彩评论」');
});

ok('搜狐不再盲目滚轮下滑（改为把按钮滚进视野）', () => {
  assert.ok(/platform === 'sohu'[\s\S]{0,600}scrollIntoView/.test(src), '缺少搜狐的「滚到按钮」逻辑');
  // 通用滚轮分支必须把 sohu 排除掉
  const wheelBlock = src.slice(src.indexOf("} else if (platform === 'sohu')"));
  assert.ok(wheelBlock.includes("} else {\n      await commentPage.mouse.wheel(0, 900)"), '滚轮分支应只剩非搜狐平台');
});

console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
