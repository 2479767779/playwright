// 回归自检：头条文章 URL 的两种路径必须都被识别。
//
// 背景：`https://www.toutiao.com/item/<id>/`（App / 头条号后台分享出来的形式）
// 与 `https://www.toutiao.com/article/<id>/`（网页端）是同一种文章，
// 但代码里曾只认 `/article/`，导致 /item/ 链接：
//   ① 批量导入时被归为「未识别」
//   ② 检测时取不到 articleId → commentCount 恒为 null → 永远判「不达标」
//
// 运行方式：node tests/url-rules.check.js（已接进 npm test）
// 说明：classifyUrl 在浏览器端、detect.js 的文章 ID 提取在 page.evaluate 注入的函数里，
// 两者都无法在 Node 里直接 import，因此对它们做「源码守卫」断言 —— 目的只是防止
// 有人把规则改回只认 /article/。
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractArticleId } = require('../evidence');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  <- ' + e.message); fail++; }
}

const ITEM_URL = 'https://www.toutiao.com/item/7697083723707204111/?enter_from=mp_group_management';
const ARTICLE_URL = 'https://www.toutiao.com/article/7300000000000000000/';

// ---- 1. evidence.js 的文章 ID 提取（可 import，真跑一遍）----
ok('extractArticleId：/item/ 形式能取到 ID', () => {
  assert.strictEqual(extractArticleId('toutiao', ITEM_URL), '7697083723707204111');
});
ok('extractArticleId：/article/ 形式仍能取到 ID', () => {
  assert.strictEqual(extractArticleId('toutiao', ARTICLE_URL), '7300000000000000000');
});
ok('extractArticleId：移动端 /item/ 也能取到', () => {
  assert.strictEqual(extractArticleId('toutiao', 'https://m.toutiao.com/item/7697083723707204111/'), '7697083723707204111');
});
ok('extractArticleId：用户主页不应被当成文章', () => {
  assert.strictEqual(extractArticleId('toutiao', 'https://www.toutiao.com/c/user/1234567890/'), '');
});
ok('extractArticleId：其它平台不受影响', () => {
  assert.strictEqual(extractArticleId('zhihu', 'https://zhuanlan.zhihu.com/p/123456789'), '123456789');
  assert.strictEqual(extractArticleId('sohu', 'https://www.sohu.com/a/1065868842_122560330'), '1065868842');
});

// ---- 2. 源码守卫：前端分类规则与检测端的 ID 提取 ----
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

ok('public/app.js 的 classifyUrl 同时认 /article/ 与 /item/', () => {
  const src = readSrc('public/app.js');
  const line = src.split('\n').find((l) => l.indexOf("return 'toutiao'") >= 0);
  assert.ok(line, '没找到 classifyUrl 里返回 toutiao 的那一行');
  assert.ok(/\(\?:article\|item\)/.test(line), '分类规则里应同时包含 article 与 item，实际：' + line.trim());
});

ok('detect.js 的头条 articleId 提取同时认 /article/ 与 /item/', () => {
  const src = readSrc('detect.js');
  const line = src.split('\n').find((l) => l.indexOf('const articleId = location.pathname.match') >= 0 && l.indexOf('(?:article|item)') >= 0);
  assert.ok(line, 'detect.js 里没找到同时匹配 article|item 的 articleId 提取，可能被改回只认 /article/');
});

console.log('\n汇总: PASS ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
