// 回归自检：CSDN 文章页存在**两套并存的结构**，点赞/收藏必须都兼容。
//
// 背景（2026-10-29 实测）：
//   新版：右侧固定 sidebar —— #sidebar-like / #sidebar-collect，
//         激活态是元素自身的 `active` 类（img.active 显示、img.def 隐藏）
//   旧版：正文顶部工具栏 a.tool-item-href + img#is-like-imgactive / #is-collection-imgactive
// 两套页面同时在线（同一作者的不同文章就是不同结构），只改一套会导致另一半文章点赞收藏失效。
//
// 运行方式：node tests/csdn-layout.check.js（已接进 npm test）
// 说明：这两处代码分别在「评论子进程」和 page.evaluate 注入的函数里，无法在 Node 里 import，
// 因此做源码守卫断言 —— 目的只是防止被改回单套结构。
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

// 只截取 detectCsdn 函数体，避免误匹配其它平台（百度/头条也有 img/点赞相关代码）
function detectCsdnBody() {
  const src = readSrc('detect.js');
  const start = src.indexOf('async function detectCsdn');
  assert.ok(start >= 0, 'detect.js 里没找到 detectCsdn');
  const rest = src.slice(start + 10);
  const nextFn = rest.indexOf('\nasync function ');
  return nextFn >= 0 ? rest.slice(0, nextFn) : rest;
}

// ---- 1. 评论脚本：点赞/收藏两套选择器都在 ----
ok('pinglun_csdn.js 同时包含新版 sidebar 点赞/收藏选择器', () => {
  const src = readSrc('pinglun_csdn.js');
  assert.ok(src.includes('#sidebar-like'), '缺少新版点赞选择器 #sidebar-like');
  assert.ok(src.includes('#sidebar-collect'), '缺少新版收藏选择器 #sidebar-collect');
});

ok('pinglun_csdn.js 同时保留旧版工具栏选择器', () => {
  const src = readSrc('pinglun_csdn.js');
  assert.ok(src.includes('a.tool-item-href'), '缺少旧版点赞/收藏选择器 a.tool-item-href');
  assert.ok(src.includes('is-like-imgactive'), '缺少旧版点赞激活态 img#is-like-imgactive');
  assert.ok(src.includes('is-collection-imgactive'), '缺少旧版收藏激活态 img#is-collection-imgactive');
});

ok('pinglun_csdn.js 有页面结构判定（不能只走一套）', () => {
  const src = readSrc('pinglun_csdn.js');
  assert.ok(/hasSidebar\s*=/.test(src), '没有 hasSidebar 结构判定');
});

ok('pinglun_csdn.js 收藏弹窗有兜底（新版可能不弹收藏夹）', () => {
  const src = readSrc('pinglun_csdn.js');
  assert.ok(src.includes('csdn-collection-items'), '缺少旧版收藏夹弹窗选择器');
  assert.ok(/未出现收藏夹弹窗/.test(src), '收藏弹窗缺少「没弹窗也继续」的兜底分支');
});

// ---- 2. 检测端：点赞/收藏状态两套判断都在 ----
ok('detect.js 的 detectCsdn 同时识别两套点赞/收藏状态', () => {
  const body = detectCsdnBody();
  assert.ok(body.includes('#sidebar-like'), 'detectCsdn 缺少新版点赞状态判断');
  assert.ok(body.includes('#sidebar-collect'), 'detectCsdn 缺少新版收藏状态判断');
  assert.ok(body.includes('is-like-imgactive'), 'detectCsdn 缺少旧版点赞状态判断');
  assert.ok(body.includes('is-collection-imgactive'), 'detectCsdn 缺少旧版收藏状态判断');
});

ok('detectCsdn 用 active 类判断新版状态', () => {
  const body = detectCsdnBody();
  assert.ok(/classList\.contains\('active'\)/.test(body), '新版状态判断应基于 active 类');
});

console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
