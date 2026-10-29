// 达标文章留痕：在检测页面的同一浏览器上下文中保存点赞/收藏和评论截图。
// 该模块只依赖 Node 的文件 API 和传入的 Playwright page，便于检测 runner 调用和单元测试。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLATFORM_LABELS = {
  zhihu: '知乎',
  toutiao: '今日头条',
  csdn: 'CSDN',
  sohu: '搜狐',
  baidu: '百度百家号',
  netease: '网易',
};

const SCREENSHOT_FILES = {
  likeCollect: '点赞收藏.png',
  comments: ['评论1.png', '评论2.png', '评论3.png'],
};

const COMMENT_SELECTORS = {
  zhihu: [
    '.CommentItem',
    '[class*="CommentItem"]',
    '[data-comment-id]',
  ],
  toutiao: [
    'div[role="dialog"].ttp-drawer .ttp-comment-item',
    '.ttp-drawer .ttp-comment-item',
  ],
  csdn: [
    '.comment-item',
    '.comment-item-box',
    '.comment-list-item',
    '[class*="comment-item"]',
    '[data-comment-id]',
    '[data-commentid]',
    'li.comment-line-box',
  ],
  sohu: [
    '#commentList [class*="comment-item"]',
    '#commentList [class*="commentItem"]',
    '#commentList [data-comment-id]',
    '#commentList [data-commentid]',
    '#commentList li',
  ],
  baidu: [
    '.xcp-item[data-reply-id]',
    '[data-reply-id]',
  ],
  netease: [
    '.tie-new .list-bdy > .trunk',
    '.tie-hot .list-bdy > .trunk',
    '.tie-new .list-bdy > .trunk .floor .self',
    '.tie-hot .list-bdy > .trunk .floor .self',
    '#tieArea .single-tie',
  ],
};

const ACTION_SELECTORS = {
  zhihu: [
    'button[aria-label^="已赞同"]',
    'button[aria-label^="赞同"]',
  ],
  toutiao: [
    'div.detail-like[role="button"]',
    '[aria-label*="点赞"]',
  ],
  // CSDN 文章页两套结构并存（2026-10-29 实测）：
  //   新版：右侧固定 sidebar，点赞 #sidebar-like / 收藏 #sidebar-collect（旧选择器全部为 0）
  //   旧版：正文顶部工具栏 img#is-like-img(active)（新版页面 .sidebar 为 0）
  // 截图是整屏截图、target 只用于滚动定位，因此定位到点赞按钮即可让点赞与收藏同时入画。
  csdn: [
    '#sidebar-like',
    '#sidebar-collect',
    '.sidebar',
    '#is-like-imgactive',
    '#is-like-img',
    'img[src*="is-like"]',
  ],
  sohu: [
    '#shareInteraction .share-interaction-c',
    '#shareInteraction .like-c-1',
    '#shareInteraction .collection-c-1',
    '.share-interaction-c',
  ],
  baidu: [
    'div.interact-btn img[src*="icon_great"]',
    '[class*="like"]',
  ],
  // 网易没有文章级点赞/收藏，用完整跟贴区作为文章级状态截图入口。
  // 文章页评论区容器两套：#tieArea（旧）与 #post_comment_area / .tie-areas（2026-10 新版）。
  netease: ['#post_comment_area', '.tie-areas', '.tie-new', '.tie-hot', '#tieArea', 'article', 'main', 'body'],
};

const PUBLISH_DATE_SELECTORS = [
  'meta[property="article:published_time"]',
  'meta[property="article:modified_time"]',
  'meta[name="publishdate"]',
  'meta[name="publish_date"]',
  'meta[name="date"]',
  'meta[itemprop="datePublished"]',
  '[itemprop="datePublished"]',
  'time[datetime]',
  '.publish-time',
  '.publishTime',
  '.article-time',
  '.article-time-box',
  '[class*="publish-time"]',
  '[class*="publishTime"]',
  '[class*="datePublished"]',
  // 平台实测位置：CSDN .time.blog-postTime[data-time]、头条 .article-meta、百度 [data-testid="updatetime"]
  '.blog-postTime',
  '.blog-post-time',
  '[data-time]',
  '.article-meta',
  '[data-testid="updatetime"]',
  '[data-testid="publishtime"]',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAccount(value) {
  return cleanText(value).replace(/[，、]/g, ',');
}

function accountList(value) {
  return normalizeAccount(value)
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function sanitizeSegment(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || fallback || '未命名').slice(0, 100);
}

function hashUrl(value) {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex').slice(0, 10);
}

function extractArticleId(platform, url) {
  let parsed;
  try { parsed = new URL(url); } catch (e) { parsed = null; }
  const pathname = parsed ? parsed.pathname : String(url || '');
  const query = parsed ? parsed.searchParams : null;
  const patterns = {
    zhihu: /\/p\/(\d+)/,
    toutiao: /\/(?:article|item)\/(\d+)/,
    csdn: /\/article\/details\/(\d+)/,
    sohu: /\/a\/(\d+)_/,
    netease: /\/article\/([A-Za-z0-9_-]+)\.html/i,
  };
  const match = patterns[platform] && pathname.match(patterns[platform]);
  if (match && match[1]) return match[1];
  if (platform === 'baidu' && query) {
    const id = query.get('id');
    if (id) return id;
  }
  return '';
}

function parsePublicationDate(candidates, now) {
  const list = Array.isArray(candidates) ? candidates : [];
  const dateRe = /((?:19|20)\d{2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})?/;
  const isoRe = /((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})/;
  const monthOnlyRe = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月/;
  for (const raw of list) {
    const text = cleanText(raw);
    if (!text) continue;
    const m = text.match(dateRe) || text.match(isoRe);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      if (year >= 1900 && month >= 1 && month <= 12) {
        return { year, month, raw: text };
      }
    }
    const mm = text.match(monthOnlyRe);
    if (mm) {
      const year = Number(mm[1]);
      const month = Number(mm[2]);
      if (year >= 1900 && month >= 1 && month <= 12) {
        return { year, month, raw: text };
      }
    }
  }
  return { year: null, month: null, raw: '' };
}

function buildLocation({ screenshotRoot, platform, originalUrl, finalUrl, title }) {
  const platformLabel = PLATFORM_LABELS[platform] || platform;
  const url = finalUrl || originalUrl || '';
  const articleId = extractArticleId(platform, url) || extractArticleId(platform, originalUrl);
  const idPart = articleId
    ? articleId
    : `${sanitizeSegment(title, '文章').slice(0, 55)}_${hashUrl(url || originalUrl)}`;
  const articleFolder = sanitizeSegment(`${platformLabel}_${idPart}`, `${platformLabel}_${hashUrl(url)}`);
  const platformDir = path.join(screenshotRoot, sanitizeSegment(platformLabel, platform));
  return {
    screenshotRoot,
    platformLabel,
    platformDir,
    articleDir: path.join(platformDir, articleFolder),
    articleFolder,
    articleId: articleId || null,
  };
}

async function collectPageMetadata(page) {
  return page.evaluate((dateSelectors) => {
    const text = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const candidates = [];
    for (const selector of dateSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        const value = el.getAttribute('content') || el.getAttribute('datetime') || el.getAttribute('data-time') || el.textContent;
        if (value && text(value)) candidates.push(text(value));
      }
    }
    const title = text(
      document.querySelector('meta[property="og:title"]')?.content
      || document.querySelector('h1')?.textContent
      || document.title,
    );
    return {
      title,
      finalUrl: location.href,
      publishCandidates: candidates,
    };
  }, PUBLISH_DATE_SELECTORS);
}

async function isVisible(locator) {
  try { return await locator.isVisible(); } catch (e) { return false; }
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      if (await isVisible(item)) return item;
    }
  }
  return null;
}

async function centerLocator(locator) {
  if (!locator) return;
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
}

// 页面内按文字扫描按钮并点击：全程一次 evaluate，避免对每个按钮逐次 CDP 往返。
// 之前用 locator + innerText 逐个判断，评论页按钮/链接很多时会拖到几十秒，是评论截图超时的主因。
async function clickButtonByText(page, opts) {
  const exact = opts.exact || [];
  const regex = opts.regex || null;
  try {
    return await page.evaluate(({ exactList, reSource }) => {
      const clean = (v) => String(v == null ? '' : v)
        .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
        .replace(/\s+/g, ' ').trim();
      const re = reSource ? new RegExp(reSource) : null;
      const nodes = document.querySelectorAll(
        'button, [role="button"], a, [class*="more"], [class*="More"], [class*="load"], [class*="Load"], [class*="expand"], [class*="Expand"], [class*="sort"], [class*="Sort"]'
      );
      for (const node of nodes) {
        // 真实外链不点（避免跳走页面）
        if (node.tagName === 'A') {
          const href = node.getAttribute('href') || '';
          if (/^https?:/i.test(href)) continue;
        }
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
        const text = clean(node.textContent || node.innerText || '');
        if (exactList.indexOf(text) >= 0 || (re && re.test(text))) {
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
          node.click();
          return true;
        }
      }
      return false;
    }, { exactList: exact, reSource: regex ? regex.source : null });
  } catch (e) {
    return false;
  }
}

// 按文字点击任意元素（不限于 button/a）：评论区入口常是 div/span 带说明文字。
// 一次 evaluate 内扫描，点「文字最短」的匹配项（最内层），避免点到外层容器。
async function clickAnyByText(page, regex) {
  try {
    return await page.evaluate((reSource) => {
      const re = new RegExp(reSource);
      const clean = (v) => String(v == null ? '' : v).replace(/\p{Cf}+/gu, '').replace(/\s+/g, ' ').trim();
      const nodes = document.querySelectorAll(
        'div, span, button, a, [role="button"], [class*="comment"], [class*="Comment"], [class*="more"], [class*="More"]'
      );
      let best = null;
      for (const node of nodes) {
        const t = clean(node.textContent || node.innerText || '');
        if (!re.test(t)) continue;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
        if (!best || t.length < best.t.length) best = { node, t };
      }
      if (best) {
        best.node.scrollIntoView({ block: 'center', inline: 'nearest' });
        best.node.click();
        return true;
      }
      return false;
    }, regex.source);
  } catch (e) {
    return false;
  }
}

// 按 CSS 选择器点第一个可见元素
async function clickFirstVisible(page, selectors) {
  const loc = await firstVisibleLocator(page, selectors);
  if (!loc) return false;
  try { await loc.click({ timeout: 5000 }); return true; } catch (e) { return false; }
}

// 知乎评论区「最新」排序：默认按热门，点最新后自己的新评论排最前。
// 先用 evaluate 定位「最新」文本且旁边有「默认」的排序切换，返回 CSS 路径，
// 知乎评论区「最新」排序：默认按热门，点最新后自己的新评论排最前，无需深滚动。
// 用 Playwright getByText 精确定位「最新」（旁边有「默认」），真实鼠标点击（el.click() 知乎不响应）。
async function clickLatestSortZhihu(page) {
  try {
    const candidates = page.getByText('最新', { exact: true });
    const n = await candidates.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const c = candidates.nth(i);
      // 检查附近有「默认」（排序切换的特征），避免点到文章内容里的「最新」
      const hasDefault = await c.evaluate((el) => {
        let p = el.parentElement;
        for (let j = 0; p && j < 3; j++) {
          if (Array.from(p.children || []).some((s) => (s.textContent || '').replace(/\s+/g, ' ').trim() === '默认')) return true;
          p = p.parentElement;
        }
        return false;
      }).catch(() => false);
      if (hasDefault) {
        await c.click({ timeout: 4000 }).catch(() => {});
        await sleep(900);
        console.log('📋 [留痕] 知乎：已真实点击「最新」排序');
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

// 知乎评论区：拖右侧滚动条往下（等价鼠标点住拖动），触发评论懒加载
async function dragZhihuScrollbar(page) {
  try {
    const box = await page.evaluate(() => {
      // 锚点用评论独有的 CommentContent（不能用 data-id，文章页后台可能有别的 data-id 元素导致滚错容器）
      const first = document.querySelector('.CommentContent, [class*="CommentContent"]');
      let el = first ? first.parentElement : null;
      let container = null;
      let maxOverflow = 0;
      while (el && el !== document.body && el !== document.documentElement) {
        const over = el.scrollHeight - el.clientHeight;
        if (over > maxOverflow) { maxOverflow = over; container = el; }
        el = el.parentElement;
      }
      el = container;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const thumbTop = r.top + (el.scrollTop / el.scrollHeight) * r.height;
      return {
        x: Math.max(r.right - 8, r.left + r.width - 12),
        top: r.top,
        bottom: r.bottom,
        thumbTop,
      };
    });
    if (!box) return false;
    const startY = Math.max(box.top + 12, Math.min(box.bottom - 12, box.thumbTop));
    const trackH = box.bottom - box.top;
    const dragBy = Math.max(60, Math.round(trackH * 0.15)); // 每次拖过轨道 15%，慢速但持续推进
    await page.mouse.move(box.x, startY);
    await page.mouse.down();
    await page.mouse.move(box.x, Math.min(box.bottom - 12, startY + dragBy), { steps: 10 });
    await page.mouse.up();
    return true;
  } catch (e) { /* ignore */ }
  return false;
}

async function clickLatestSort(page) {
  const exact = ['最新', '按时间', '最新评论', '时间排序', '按时间排序'];
  let clicked = await clickButtonByText(page, { exact });
  if (!clicked) clicked = await clickAnyByText(page, /^(最新|按时间|最新评论|时间排序|按时间排序)$/);
  if (clicked) await sleep(500);
  return clicked;
}

async function clickLoadMore(page, platform) {
  if (platform === 'netease') {
    return page.evaluate(async () => {
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
      };
      const signature = () => {
        const nodes = Array.from(document.querySelectorAll(
          '.tie-new .list-bdy > .trunk, .tie-hot .list-bdy > .trunk, .tie-new .floor .self, .tie-hot .floor .self',
        )).filter(visible);
        const samples = nodes.length <= 12 ? nodes : [...nodes.slice(0, 4), ...nodes.slice(-8)];
        return `${nodes.length}:${samples.map((node) => {
          const id = node.getAttribute('data-id') || node.getAttribute('data-comment-id') || '';
          return id || String(node.textContent || '').replace(/\s+/g, '').slice(0, 120);
        }).join('|')}`;
      };
      const newView = document.querySelector('.tie-new');
      const hotView = document.querySelector('.tie-hot');
      const active = visible(newView) ? { name: 'new', element: newView }
        : visible(hotView) ? { name: 'hot', element: hotView } : null;
      const scope = active?.element || document.body;
      const next = Array.from(scope.querySelectorAll('.m-page .next.z-enable, .m-page li .next.z-enable')).find(visible);
      if (next) {
        const before = signature();
        next.click();
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (signature() !== before) return true;
        }
        return false;
      }
      if (!active) return false;
      const visited = new Set(String(document.body.dataset.aiNeteaseVisited || '').split(',').filter(Boolean));
      visited.add(active.name);
      document.body.dataset.aiNeteaseVisited = [...visited].join(',');
      const alternate = active.name === 'new'
        ? { name: 'hot', element: hotView }
        : { name: 'new', element: newView };
      if (alternate.element && !visited.has(alternate.name)) {
        active.element.style.display = 'none';
        alternate.element.style.display = 'block';
        alternate.element.scrollIntoView({ behavior: 'auto', block: 'start' });
        await new Promise((resolve) => setTimeout(resolve, 600));
        return true;
      }
      return false;
    }).catch(() => false);
  }

  // 头条文章底部只展示预览评论；完整列表位于 side-drawer-btn 打开的抽屉中。
  // 加载更多必须严格限制在可见抽屉内，不能操作预览区。
  if (platform === 'toutiao') {
    const itemSelector = 'div[role="dialog"].ttp-drawer .ttp-comment-item, .ttp-drawer .ttp-comment-item';
    const before = await page.locator(itemSelector).count().catch(() => 0);
    const button = await firstVisibleLocator(page, [
      'div[role="dialog"].ttp-drawer button.load-more-btn',
      '.ttp-drawer button.load-more-btn',
    ]);
    if (!button) return false;
    try {
      await button.click({ timeout: 5000 });
    } catch (e) {
      return false;
    }
    const waitUntil = Date.now() + 5000;
    while (Date.now() < waitUntil) {
      await sleep(250);
      const after = await page.locator(itemSelector).count().catch(() => before);
      if (after > before) break;
      if (!await isVisible(button)) break;
    }
    return true;
  }

  // 1) 展开被折叠的评论（CSDN 的 look-more-flodcomment「查看」；可能有多层折叠，循环点）
  for (let i = 0; i < 3; i++) {
    const unfolded = await clickFirstVisible(page, ['a.look-more-flodcomment', '[class*="flodcomment"]']);
    if (unfolded) { await sleep(400); } else break;
  }
  // 2) 点「查看更多评论」——主面板和折叠面板（pcFlodCommentSideBox）里都有，逐个点
  let anyClicked = false;
  for (let i = 0; i < 3; i++) {
    // 优先点 .look-more-comment（主面板和折叠面板共用这个类）
    const cm = await clickFirstVisible(page, ['a.look-more-comment', '.look-more-comment']);
    if (cm) { anyClicked = true; await sleep(400); continue; }
    const clicked = await clickButtonByText(page, {
      regex: /查看全部\s*\d*\s*条?\s*评论|查看更多\s*\d*\s*条?\s*评论|加载更多|更多评论|展开回复|展开全部回复|查看全部回复|展开更多|查看更多回复|展开\s*\d*\s*条回复|查看\s*\d*\s*条回复/,
    });
    if (clicked) { anyClicked = true; await sleep(400); } else break;
  }
  return anyClicked;
}

// 各平台评论区容器（用于滚动到评论区触发懒加载）
const COMMENT_SECTION_SELECTORS = {
  zhihu: ['#Comments', '.Comments-container', '[class*="Comments-container"]', '[class*="comments-area"]'],
  toutiao: [
    'div.ttp-comment-block[role="region"][aria-label="评论区"]',
    '#comment-area.ttp-comment-wrapper',
    '#comment-area',
    '.ttp-comment-block',
  ],
  csdn: ['#comment', '.comment-list-box', '.comment-list', '[class*="comment-list"]', '.new-comment'],
  baidu: ['.xcp-list', '[class*="comment"]'],
  sohu: ['#commentList', '#meComment', '#comment_area', 'body'],
  netease: ['#post_comment_area', '.tie-areas', '.tie-new', '.tie-hot', '#tieArea', 'body'],
};

// 各平台「评论项」首选选择器（用于等待评论区真正渲染出评论）
const PRIMARY_COMMENT_SELECTOR = {
  zhihu: '.CommentItem, [data-comment-id], [class*="CommentItem"], .Comments-container [class*="Avatar"], #Comments [class*="Avatar"]',
  csdn: '.comment-item, [data-comment-id], [class*="comment-item"]',
  toutiao: 'div[role="dialog"].ttp-drawer .ttp-comment-item, .ttp-drawer .ttp-comment-item',
  sohu: '#commentList [class*="comment-item"], #commentList [class*="commentItem"], #commentList [data-comment-id], #commentList [data-commentid]',
  baidu: '.xcp-item[data-reply-id]',
  netease: '.tie-new .list-bdy > .trunk, .tie-hot .list-bdy > .trunk, .tie-new .floor .self, .tie-hot .floor .self',
};

// 滚动到评论区容器，并点击平台专属的「打开评论区」入口（知乎/CSDN 的评论在弹层里）。
// 返回评论区所在的 page：如果平台把评论放到新窗口/标签页，则返回该页；否则返回原页。
async function prepareCommentSection(page, platform) {
  // 1. 滚动到评论区容器（触发懒加载）
  const sels = COMMENT_SECTION_SELECTORS[platform] || [];
  for (const sel of sels) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await sleep(400);
        break;
      }
    } catch (e) { /* ignore */ }
  }
  // 2. 平台专属：点击打开评论区弹层
  if (platform === 'zhihu') {
    const opened = await clickAnyByText(page, /点击查看全部评论|查看全部\s*\d*\s*条?\s*评论/);
    if (opened) { await sleep(1200); console.log('📋 [留痕] 知乎：已点击「查看全部评论」打开评论区'); }
    // 点「最新」排序：评论区默认按热门，点最新后自己的新评论排最前，不用深滚动就能找到
    // 必须用真实鼠标点击，el.click() 知乎不响应
    await clickLatestSortZhihu(page);
  } else if (platform === 'csdn') {
    const opened = await clickFirstVisible(page, [
      'img[src*="toolbar/comment"]', 'img[src*="comment.png"]', 'a[class*="comment"]', '.toolbar-comment',
    ]);
    if (opened) {
      await sleep(1200);
      console.log('📋 [留痕] CSDN：已点击评论按钮打开评论区');
    }
    const more = await clickAnyByText(page, /查看更多评论|查看更多\s*\d*\s*条?\s*评论|加载更多/);
    if (more) { await sleep(800); console.log('📋 [留痕] CSDN：已点击「查看更多评论」'); }
  } else if (platform === 'toutiao') {
    const drawerSelectors = [
      'div[role="dialog"].ttp-drawer',
      '.ttp-drawer[role="dialog"]',
      '.ttp-drawer',
    ];
    let drawer = await firstVisibleLocator(page, drawerSelectors);
    if (!drawer) {
      // 文章底部 #comment-area 是预览区，必须点击这里的“查看全部 N 条评论”。
      const section = await firstVisibleLocator(page, [
        'div.ttp-comment-block[role="region"][aria-label="评论区"]',
        '.ttp-comment-block',
      ]);
      if (section) await section.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});

      let openButton = null;
      const buttonDeadline = Date.now() + 10000;
      while (!openButton && Date.now() < buttonDeadline) {
        openButton = await firstVisibleLocator(page, [
          'div.ttp-comment-block[role="region"][aria-label="评论区"] button.side-drawer-btn',
          '.ttp-comment-block button.side-drawer-btn',
          'button.side-drawer-btn',
        ]);
        if (!openButton) await sleep(250);
      }
      if (openButton) {
        await openButton.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await openButton.click({ timeout: 5000 });
        console.log('📋 [留痕] 头条：已点击「查看全部评论」打开评论抽屉');
      } else {
        console.log('📋 [留痕] 头条：未找到 button.side-drawer-btn');
      }

      const drawerDeadline = Date.now() + 10000;
      while (!drawer && Date.now() < drawerDeadline) {
        drawer = await firstVisibleLocator(page, drawerSelectors);
        if (!drawer) await sleep(250);
      }
    }
    if (drawer) {
      console.log('📋 [留痕] 头条：评论抽屉 .ttp-drawer 已打开');
      if (await clickLoadMore(page, 'toutiao')) {
        console.log('📋 [留痕] 头条：已在评论抽屉内点击「查看更多评论」');
      }
    } else {
      console.log('📋 [留痕] 头条：点击后未检测到评论抽屉 .ttp-drawer');
    }
  }
  // 3. 如果评论区跑到了新窗口/标签页，改用它
  try {
    const ctx = page.context();
    for (const ep of ctx.pages()) {
      if (ep === page || ep.isClosed()) continue;
      try {
        const has = await ep.evaluate(() => !!document.querySelector(
          '.CommentItem, .comment-item, [data-comment-id], [data-reply-id], .look-more-comment',
        ));
        if (has) {
          console.log('📋 [留痕] 检测到评论区在独立窗口/标签页，改用该页');
          return ep;
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return page;
}

async function findMatchingComments(page, platform, accounts, ids) {
  const selectors = COMMENT_SELECTORS[platform] || [];
  const matches = await page.evaluate(({ selectors: sels, accounts: wanted, ids: wantedIds, platform: plat }) => {
    // \p{Cf} 匹配所有零宽/格式字符（ZWSP、ZWJ、BOM 等），纯 ASCII 写法避免转义问题
    const normalize = (v) => String(v == null ? '' : v).replace(/\p{Cf}+/gu, '').replace(/\s+/g, ' ').trim();
    const wantedSet = new Set((wanted || []).map(normalize).filter(Boolean));
    const idSet = new Set((wantedIds || []).map(String).map(normalize).filter(Boolean));
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    // 从元素上取评论 ID（不同平台属性名不同）
    const getId = (el) => {
      for (const attr of ['data-comment-id', 'data-reply-id', 'data-commentid', 'commentid', 'data-commentId', 'data-id', 'data-spm-content']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) {
          const normalized = normalize(v);
          if (attr === 'data-spm-content' && plat === 'sohu') return normalized.split('|')[2] || normalized;
          return normalized;
        }
      }
      return '';
    };
    const authorSelectors = [
      '[class*="author"]', '[class*="Author"]', '[class*="user-name"]', '[class*="username"]',
      '[class*="userName"]', '[class*="uname"]', '[class*="nick"]', '[class*="Nick"]',
      '[class*="user-bar-uname"]', '[class*="name"]', '[class*="Name"]',
      'a[href*="/people/"]', 'a[href*="/user/"]', 'a[href*="/c/user/"]',
      '[data-user-name]', '[data-username]',
    ];
    // 生成唯一 CSS 路径，供留痕阶段重新定位该评论项
    const cssPath = (el) => {
      if (!el || el.nodeType !== 1) return '';
      const parts = [];
      while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
        if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
        let sel = el.tagName.toLowerCase();
        const parent = el.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
          if (sameTag.length > 1) sel += ':nth-of-type(' + (sameTag.indexOf(el) + 1) + ')';
        }
        parts.unshift(sel);
        el = parent;
      }
      return parts.join(' > ');
    };
    // 收集评论项候选：先按平台选择器；找不到时用「评论区容器内头像锚点」兜底
    // （知乎新版评论项用哈希类名 css-xxx，需靠 Avatar + 正文结构定位）
    let usedFallback = false;
    const collectCandidates = () => {
      // 合并所有选择器的可见元素（去重），不能只在第一个有可见评论的选择器就停——
      // 你的评论可能只出现在后面的选择器结构里
      const out = [];
      const seenEl = new Set();
      for (const selector of sels) {
        for (const el of document.querySelectorAll(selector)) {
          if (!visible(el) || seenEl.has(el)) continue;
          seenEl.add(el);
          out.push(el);
        }
      }
      if (out.length) return out;
      // 头像兜底只给知乎用（哈希类名）；其它平台保持原选择器逻辑，避免误收集
      if (plat !== 'zhihu') return out;
      usedFallback = true;
      const root = document.querySelector('#Comments, .Comments-container, [class*="Comments"], #comment, .comment-list, [class*="comment-list"]');
      if (root) {
        const seen = new Set();
        const avatars = root.querySelectorAll('[class*="Avatar"], [class*="avatar"], img[src*="avatar"], .Avatar');
        for (const av of avatars) {
          let el = av.parentElement;
          let fallbackEl = null;
          while (el && el !== root && el !== document.body) {
            const t = normalize(el.innerText || el.textContent || '');
            // 带评论 ID 的祖先（知乎是 data-id）就是评论项本体
            const hasCommentId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-comment-id') || el.getAttribute('data-reply-id'));
            if (t.length >= 15 && t.length <= 1500 && visible(el)) {
              if (hasCommentId) {
                if (!seen.has(el)) { seen.add(el); out.push(el); }
                fallbackEl = null;
                break;
              }
              if (!fallbackEl) fallbackEl = el;
            }
            el = el.parentElement;
          }
          if (fallbackEl && !seen.has(fallbackEl)) { seen.add(fallbackEl); out.push(fallbackEl); }
        }
      }
      // 按用户名文本找评论（放宽：短文本包含用户名即可，再向上定位到评论项——等价于 Ctrl+F）
      // 不强制 visible：懒加载刚渲染的评论可能 opacity/尺寸暂为 0，但已经在 DOM 里，必须算
      if (wantedSet.size) {
        const wantedArr = Array.from(wantedSet);
        const all = document.querySelectorAll('a, div, span, [class*="author"], [class*="user"]');
        for (const node of all) {
          const nt = normalize(node.textContent || node.innerText || '');
          if (nt.length === 0 || nt.length > 60) continue;
          if (!wantedArr.some((w) => nt.includes(w))) continue;
          let el = node.parentElement;
          let guard = 0;
          while (el && el !== document.body && el !== document.documentElement && guard++ < 12) {
            const t = normalize(el.innerText || el.textContent || '');
            const hasId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-comment-id') || el.getAttribute('data-reply-id'));
            const hasAvatar = el.querySelector && el.querySelector('[class*="Avatar"], .Avatar, img[src*="avatar"]');
            if ((hasId || hasAvatar) && t.length >= 8 && t.length <= 5000) {
              if (!seenEl.has(el)) { seenEl.add(el); out.push(el); }
              break;
            }
            if (t.length >= 4000) break;
            el = el.parentElement;
          }
        }
      }
      // 最终兜底：直接用 a[href*="/people/"] 作者链接精确定位评论项
      // （诊断证明此逻辑能找到 3/3，直接复用为候选收集，不加任何额外条件）
      let fallbackAdded = 0;
      if (wantedSet.size) {
        const wantedArr = Array.from(wantedSet);
        const links = document.querySelectorAll('a[href*="/people/"]');
        for (const l of links) {
          const lt = normalize(l.textContent || '');
          if (!wantedArr.includes(lt)) continue;
          let el = l.parentElement;
          for (let g = 0; el && el !== document.body && g < 12; g++) {
            const hasId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-comment-id'));
            const hasAvatar = el.querySelector && el.querySelector('[class*="Avatar"], .Avatar, img[src*="avatar"]');
            if (hasId || hasAvatar) {
              if (!seenEl.has(el)) { seenEl.add(el); out.push(el); fallbackAdded++; }
              break;
            }
            el = el.parentElement;
          }
        }
      }
      // 统一去重（各来源可能重复命中同一评论）
      const uniqueCands = [];
      for (const el of out) {
        if (seenEl.has(el)) continue;
        seenEl.add(el);
        uniqueCands.push(el);
      }
      return uniqueCands;
    };
    // 收集作者名样本（诊断用）
    const authorSample = new Set();
    const allCandidates = collectCandidates();
    // 最终兜底（在 collectCandidates 外面执行，排除闭包问题）：
    // 直接用 a[href*="/people/"] 作者链接 → 向上找评论项 → 加入候选
    if (wantedSet.size) {
      const wantedArr = Array.from(wantedSet);
      const peopleLinks = document.querySelectorAll('a[href*="/people/"]');
      for (const l of peopleLinks) {
        const lt = normalize(l.textContent || '');
        if (!wantedArr.includes(lt)) continue;
        let el = l.parentElement;
        for (let g = 0; el && el !== document.body && g < 12; g++) {
          const hasId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-comment-id'));
          const hasAvatar = el.querySelector && el.querySelector('[class*="Avatar"], .Avatar, img[src*="avatar"]');
          if (hasId || hasAvatar) {
            if (!allCandidates.includes(el)) allCandidates.push(el);
            break;
          }
          el = el.parentElement;
        }
      }
    }
    for (const el of allCandidates) {
      for (const attr of ['data-user-name', 'data-username', 'data-author', 'aria-label', 'title']) {
        const value = normalize(el.getAttribute(attr));
        if (value && value.length <= 40) authorSample.add(value);
      }
      for (const authorSelector of authorSelectors) {
        for (const node of el.querySelectorAll(authorSelector)) {
          const value = normalize(node.getAttribute('data-user-name') || node.getAttribute('data-username') || node.textContent);
          if (value && value.length <= 40) authorSample.add(value);
        }
      }
    }
    const authors = Array.from(authorSample).slice(0, 12);
    // 评论区容器类名 + 容器内部前几个子元素类名（诊断用，帮助定位真实评论项结构）
    const containerSample = [];
    for (const s of ['#Comments', '#comment', '#comment-area', '.ttp-comment-block', '.comment-list', '.comment-box', '.comments-area', '.comment-area', '[class*="comment-list"]', '[class*="Comments"]', '.xcp-list']) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cls = typeof el.className === 'string' ? el.className.replace(/\s+/g, ' ').slice(0, 60) : el.tagName;
      const inner = [];
      const els = el.querySelectorAll('[class]');
      for (let k = 0; k < els.length && inner.length < 5; k++) {
        const c = els[k].className;
        if (typeof c === 'string' && c.trim()) {
          const first = c.trim().split(/\s+/)[0];
          if (!inner.includes(first)) inner.push(first);
        }
      }
      containerSample.push(cls + (inner.length ? ' ⟶ ' + inner.join(' | ') : ''));
    }
    const containers = containerSample.slice(0, 6);
    // 诊断：收到的评论 ID 数 + 页面候选元素上的 ID 样本
    const elIdSample = [];
    for (const el of allCandidates.slice(0, 5)) {
      const id = getId(el);
      if (id) elIdSample.push(id);
    }
    const idsReceived = idSet.size;
    // 收到的评论 ID 是否出现在页面候选元素上（诊断）
    let idMatchesFound = 0;
    for (const el of allCandidates) {
      const id = getId(el);
      if (id && idSet.has(id)) idMatchesFound++;
    }
    // 用户名文本是否存在于页面（诊断：true=评论在DOM里但没被收集到；false=根本没加载出来）
    const nameInDom = wantedSet.size
      ? Array.from(wantedSet).some((w) => (document.body.innerText || '').includes(w))
      : false;
    // 更精确：作者链接（a[href*="/people/"]）文本=用户名 —— 说明评论真的以评论形式加载进 DOM
    const authorNameInDom = wantedSet.size
      ? Array.from(wantedSet).some((w) => {
        const links = document.querySelectorAll('a[href*="/people/"]');
        for (const l of links) { if (normalize(l.textContent || '') === w) return true; }
        return false;
      })
      : false;
    // 精确诊断：每个用户名的作者链接数 + 能否向上找到评论项
    const authorLinkMatches = wantedSet.size
      ? Array.from(wantedSet).map((w) => {
        const links = document.querySelectorAll('a[href*="/people/"]');
        let count = 0;
        let withAncestor = 0;
        for (const l of links) {
          if (normalize(l.textContent || '') !== w) continue;
          count++;
          let el = l.parentElement;
          for (let g = 0; el && el !== document.body && g < 12; g++) {
            const hasId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-comment-id'));
            const hasAvatar = el.querySelector && el.querySelector('[class*="Avatar"], .Avatar, img[src*="avatar"]');
            if (hasId || hasAvatar) { withAncestor++; break; }
            el = el.parentElement;
          }
        }
        return `${w}:${count}条/${withAncestor}有评论祖先`;
      })
      : [];
    // 逐个匹配（不强制 visible：懒加载刚渲染的评论可能暂被判不可见，但确实存在）
    const result = [];
    allCandidates.forEach((el) => {
      const elId = getId(el);
      let matchedName = null;
      // 头条当前账号自己的评论项会显示“删除”操作。新版 DOM 不再把
      // API 评论 ID 挂到 .ttp-comment-item 上，因此该控件比作者文本更可靠。
      const isToutiaoOwnComment = plat === 'toutiao'
        && el.matches('.ttp-comment-item')
        && !!el.querySelector('.ttp-comment-delete[aria-label="删除"], .ttp-comment-delete button');
      if (isToutiaoOwnComment) {
        matchedName = normalize(
          el.querySelector('.user-info .user-name .name, .user-name .name, .user-name')?.textContent,
        ) || '头条当前账号评论';
      } else if (idSet.size && elId && idSet.has(elId)) {
        matchedName = '评论ID:' + elId;
      } else {
        const names = [];
        for (const attr of ['data-user-name', 'data-username', 'data-author', 'aria-label', 'title']) {
          const value = normalize(el.getAttribute(attr));
          if (value) names.push(value);
        }
        for (const authorSelector of authorSelectors) {
          for (const node of el.querySelectorAll(authorSelector)) {
            const value = normalize(node.getAttribute('data-user-name') || node.getAttribute('data-username') || node.textContent);
            if (value) names.push(value);
          }
        }
        const text = normalize(el.innerText || el.textContent);
        matchedName = names.find((name) => wantedSet.has(name))
          || text.split(/\n|\r/).map(normalize).find((line) => wantedSet.has(line))
          // 兜底：data-id 会变，但用户名稳定——评论项文本里包含用户名也算命中
          || (wantedSet.size ? Array.from(wantedSet).find((w) => text.includes(w)) : undefined);
        if (!matchedName || text.length < 4) return;
      }
      const rect = el.getBoundingClientRect();
      result.push({
        index: -1,
        path: cssPath(el),
        elId,
        author: matchedName,
        text: normalize(el.innerText || el.textContent).slice(0, 500),
        top: rect.top + window.scrollY,
        height: rect.height,
      });
    });
    // 直接按作者链接匹配评论项（独立于候选收集，确保不被任何条件漏掉）
    if (wantedSet.size) {
      const wantedArr = Array.from(wantedSet);
      const peopleLinks = document.querySelectorAll('a[href*="/people/"]');
      for (const l of peopleLinks) {
        const lt = normalize(l.textContent || '');
        if (!wantedArr.includes(lt)) continue;
        let el = l.parentElement;
        for (let g = 0; el && el !== document.body && g < 12; g++) {
          const hasId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-comment-id'));
          const hasAvatar = el.querySelector && el.querySelector('[class*="Avatar"], .Avatar, img[src*="avatar"]');
          if (hasId || hasAvatar) {
            const rect = el.getBoundingClientRect();
            const top = rect.top + window.scrollY;
            if (!result.some((r) => Math.abs(r.top - top) < 4)) {
              result.push({
                index: -1,
                path: cssPath(el),
                elId: getId(el),
                author: lt,
                text: normalize(el.innerText || el.textContent).slice(0, 500),
                top: top,
                height: rect.height,
              });
            }
            break;
          }
          el = el.parentElement;
        }
      }
    }
    if (result.length) {
      // 页面可能同时存在包裹层和评论项，保留顺序稳定且优先靠后的评论。
      result.sort((a, b) => a.top - b.top);
      const unique = [];
      const seenIds = new Set();
      for (const item of result) {
        // 同一评论的嵌套结构（外层/内层带相同 ID）只保留最外层第一条
        if (item.elId) {
          if (seenIds.has(item.elId)) continue;
          seenIds.add(item.elId);
        }
        const duplicate = unique.some((old) => Math.abs(old.top - item.top) < 4 && Math.abs(old.height - item.height) < 8);
        if (!duplicate) unique.push(item);
      }
      return { selector: '', items: unique, found: allCandidates.length, authors, containers, idsReceived, elIdSample, idMatchesFound, nameInDom, authorNameInDom, authorLinkMatches, usedFallback };
    }
    return { selector: '', items: [], found: allCandidates.length, authors, containers, idsReceived, elIdSample, idMatchesFound, nameInDom, authorNameInDom, authorLinkMatches, usedFallback };
  }, { selectors, accounts, ids, platform });
  return matches;
}
async function discoverComments(page, platform, accounts, ids, deadline) {
  // 先点开评论区（含平台专属弹层），得到评论区所在的 page（可能是新窗口/标签页）
  const commentPage = await prepareCommentSection(page, platform);
  // 等待评论区真正渲染出评论项（弹层刚打开时可能还在加载）
  const primarySel = PRIMARY_COMMENT_SELECTOR[platform];
  if (primarySel) {
    const waitUntil = Date.now() + 10000;
    while (Date.now() < waitUntil) {
      try {
        const n = await commentPage.evaluate((sel) => document.querySelectorAll(sel).length, primarySel);
        if (n > 0) break;
      } catch (e) { /* ignore */ }
      await sleep(500);
    }
  }
  if (platform === 'zhihu') {
    await clickLatestSortZhihu(commentPage); // 知乎「最新」必须真实鼠标点击
  } else {
    await clickLatestSort(commentPage);
  }
  let last = { selector: '', items: [], found: 0, authors: [], containers: [], commentPage };
  // 检测走的是平台 API（能看到所有评论），截图看的是 DOM（只加载了部分）。
  // 所以只要「加载更多」还能加载出新评论，就继续翻，直到找到自己的评论；连续 3 轮没进展才收尾。
  let lastFound = 0;
  let stale = 0;
  let bailError = '';
  let lastLoggedFound = -1;
  let lastZhihuCount = -1;
  let lastZhihuContainer = '';
  for (let i = 0; Date.now() < deadline; i++) {
    last = await findMatchingComments(commentPage, platform, accounts, ids);
    last.commentPage = commentPage;
    if (last.found !== lastLoggedFound) {
      console.log(`📋 [留痕] 已加载 ${last.found} 条评论，继续找「${(accounts || []).join('、')}」`);
      lastLoggedFound = last.found;
    }
    if (last.items.length >= 3) {
      console.log(`📋 [留痕] 匹配到 ${last.items.length} 条评论（收到ID=${last.idsReceived}，ID命中=${last.idMatchesFound}）`);
      return last;
    }
    if (last.found > 0 && last.items.length === 0) {
      if (last.found === lastFound) stale++;
      else { stale = 0; lastFound = last.found; }
      // 知乎评论靠滚动逐批加载，found 可能隔几轮才涨：检测已通过就持续滚动找评论，不提前退出
      const staleLimit = platform === 'zhihu' ? 1000 : 3;
      if (stale >= staleLimit) {
        bailError = `评论区已定位到 ${last.found} 条评论，但未匹配到账号「${(accounts || []).join('、')}」`
          + (last.authors && last.authors.length ? `；页面上的作者名样本：${last.authors.join('、')}` : '');
        break;
      }
    } else {
      stale = 0;
      lastFound = last.found;
    }
    const loadedMore = await clickLoadMore(commentPage, platform);
    if (Date.now() >= deadline) break;
    if (platform === 'zhihu') {
      // 知乎评论区：把鼠标移到弹层里某条评论上（CommentContent 一定在弹层内），滚轮下滑。
      // 不做容器检测——鼠标在弹层上，滚轮就滚弹层，绝不会滚到后台文章页。这就是用户手动的方式。
      try {
        // 读「N 条评论」计数（进度确认）
        const count = await commentPage.evaluate(() => {
          const els = document.querySelectorAll('div, span');
          for (const ce of els) {
            const t = ce.textContent || '';
            if (t.length > 20) continue;
            const m = /(\d+)\s*条评论/.exec(t);
            if (m) return Number(m[1]);
          }
          return -1;
        });
        if (count >= 0 && count !== lastZhihuCount) {
          console.log(`📋 [留痕] 知乎：加载计数 ${count} 条评论，继续滚动找「${(accounts || []).join('、')}」`);
          lastZhihuCount = count;
        }
        // 照插件的 loadAllComments：找滚动容器 scrollTo + 点加载更多 + 小步滚轮
        // 滚动容器要求 overflowY:auto/scroll 且 scrollHeight>clientHeight+30（插件逻辑）
        await commentPage.evaluate(() => {
          const root = document.querySelector('.Comments-container, [class*="Comments"], [role="dialog"] [class*="Comment"], [class*="Modal"] [class*="Comment"]');
          if (!root) return;
          const candidates = [root];
          let parent = root.parentElement;
          while (parent && parent !== document.body) { candidates.push(parent); parent = parent.parentElement; }
          candidates.push(...Array.from(root.querySelectorAll('[class*="scroll"], [class*="Scroll"], [role="dialog"]')));
          const container = candidates.find((el) => {
            const style = getComputedStyle(el);
            return /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`) && el.scrollHeight > el.clientHeight + 30;
          });
          if (container) container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + 400);
        });
        await clickLoadMore(commentPage, platform); // 点「加载更多评论」按钮
        await commentPage.mouse.move(720, 350); // 滚轮辅助
        await commentPage.mouse.wheel(0, 150);
        await sleep(300);
      } catch (e) { /* ignore */ }
    } else if (platform === 'toutiao') {
      // 头条抽屉有自己的滚动容器；滚动页面本身不会加载抽屉内的后续评论。
      const scrollState = await commentPage.evaluate(() => {
        const visible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
        };
        const drawer = Array.from(document.querySelectorAll('div[role="dialog"].ttp-drawer, .ttp-drawer'))
          .find(visible);
        if (!drawer) return null;
        const candidates = [drawer, ...drawer.querySelectorAll('.body, [class*="scroll"], [class*="Scroll"]')];
        const scroller = candidates.find((el) => {
          if (!(el instanceof HTMLElement) || !visible(el)) return false;
          const style = getComputedStyle(el);
          return /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)
            && el.scrollHeight > el.clientHeight + 30;
        });
        const rect = drawer.getBoundingClientRect();
        if (!scroller) {
          return { moved: false, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        const before = scroller.scrollTop;
        scroller.scrollTop = Math.min(scroller.scrollHeight, before + 700);
        return {
          moved: scroller.scrollTop !== before,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }).catch(() => null);
      if (scrollState && !scrollState.moved) {
        await commentPage.mouse.move(scrollState.x, scrollState.y).catch(() => {});
        await commentPage.mouse.wheel(0, 700).catch(() => {});
      }
    } else {
      await commentPage.mouse.wheel(0, 900).catch(() => {});
    }
    await sleep(500);
    if (!loadedMore && i >= (platform === 'zhihu' ? 120 : 40)) break;
  }
  if (bailError) {
    last.error = bailError;
    console.log(`📋 [留痕] ${bailError}`);
  }
  const detail = last.found === 0 && last.containers && last.containers.length
    ? `；检测到评论区容器：${last.containers.join('、')}`
    : '';
  console.log(`📋 [留痕] 评论查找结束：页面共 ${last.found} 条评论，匹配到 ${last.items.length} 条${detail}${last.authors && last.authors.length ? `，作者名样本：${last.authors.join('、')}` : ''}`);
  console.log(`📋 [留痕] 诊断：收到评论ID=${last.idsReceived}，页面ID命中=${last.idMatchesFound}，作者链接在DOM=${last.authorNameInDom ? '是' : '否'}${last.authorLinkMatches && last.authorLinkMatches.length ? `（${last.authorLinkMatches.join('，')}）` : ''}，用户名在DOM=${last.nameInDom ? '是' : '否'}，页面ID样本=[${(last.elIdSample || []).join(',')}]，是否头像兜底=${last.usedFallback ? '是' : '否'}，匹配集=${(accounts || []).join('、')}`);
  return last;
}
// ===== 真实浏览器窗口截图（含系统地址栏）=====
// Playwright 的 page.screenshot() 只能截网页内容区，不含地址栏。留痕证据需要带 URL，
// 这里用 Windows 屏幕捕获把检测用的 chrome 窗口（含真实地址栏）整体截下来。
// 通过页面标题匹配 chrome 主窗口，PrintWindow 捕获整窗（即使被遮挡也能截到），失败回退 CopyFromScreen。
// 任何一步异常都返回失败，由调用方回退到普通视口截图，不影响留痕主流程。
const WINDOW_CAPTURE_PS = `
param([string]$ExpectedTitle, [string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class EvCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@
[EvCap]::SetProcessDPIAware() | Out-Null
$normalize = { param($s) (($s -replace '\\p{Zs}+', ' ')).Trim() }
$exp = & $normalize $ExpectedTitle
$procs = Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle }
$best = $null
$bestScore = -1
foreach ($p in $procs) {
  $t = & $normalize $p.MainWindowTitle
  if (-not $t) { continue }
  $score = 0
  if ($exp) {
    if ($t.IndexOf($exp, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $score = 10 }
    elseif ($exp.IndexOf($t, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and $t.Length -ge 4) { $score = 5 }
  }
  if ($score -gt $bestScore) { $bestScore = $score; $best = $p }
}
if (-not $best) { Write-Output 'NO_WINDOW'; exit 2 }
$hwnd = $best.MainWindowHandle
if ([EvCap]::IsIconic($hwnd)) { [EvCap]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 300 }
[EvCap]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 200
$r = New-Object RECT
[EvCap]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Output 'BAD_RECT'; exit 3 }
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = $false
try { $ok = [EvCap]::PrintWindow($hwnd, $hdc, 2) } catch { $ok = $false }
$g.ReleaseHdc($hdc)
$saved = $false
if ($ok) {
  try { $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png); $saved = $true } catch {}
}
if (-not $saved) {
  # 回退：屏幕区域截图（窗口必须可见在前台）
  Add-Type -AssemblyName System.Windows.Forms
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $left = [Math]::Max($r.Left, $vs.Left)
  $top = [Math]::Max($r.Top, $vs.Top)
  $right = [Math]::Min($r.Right, $vs.Right)
  $bottom = [Math]::Min($r.Bottom, $vs.Bottom)
  $cw = $right - $left
  $ch = $bottom - $top
  if ($cw -gt 0 -and $ch -gt 0) {
    $bmp2 = New-Object System.Drawing.Bitmap($cw, $ch)
    $g2 = [System.Drawing.Graphics]::FromImage($bmp2)
    $g2.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($cw, $ch)))
    $bmp2.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $g2.Dispose(); $bmp2.Dispose()
    $saved = $true
  }
}
$g.Dispose(); $bmp.Dispose()
if (-not $saved) { Write-Output 'SAVE_FAIL'; exit 4 }
Write-Output ("OK " + $best.MainWindowTitle)
`;

let _windowCaptureScriptPath = null;
function windowCaptureScriptPath() {
  if (_windowCaptureScriptPath) return _windowCaptureScriptPath;
  try {
    const p = path.join(__dirname, 'window_capture.ps1');
    fs.writeFileSync(p, WINDOW_CAPTURE_PS, 'utf8');
    _windowCaptureScriptPath = p;
  } catch (e) {
    _windowCaptureScriptPath = null;
  }
  return _windowCaptureScriptPath;
}

// 截真实浏览器窗口（含地址栏）。expectedTitle 用于在多个 chrome 窗口里找到当前文章页。
async function captureWindowScreenshot(page, expectedTitle, targetPath) {
  const psPath = windowCaptureScriptPath();
  if (!psPath || !expectedTitle) return { ok: false, error: '缺少窗口截图脚本或页面标题' };
  try { await page.bringToFront(); } catch (e) { /* ignore */ }
  const { execFile } = require('child_process');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psPath, expectedTitle, targetPath];
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { timeout: 25000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: (err && err.message) || 'powershell 未执行成功' });
      const out = String(stdout || '').trim();
      if (/^OK /.test(out)) return resolve({ ok: true, title: out.slice(3) });
      resolve({ ok: false, error: out || (stderr ? String(stderr).trim() : '窗口截图未成功') });
    });
  });
}

async function screenshotWithRetry(page, target, targetPath, deadline, windowTitle) {
  let lastError = null;
  let windowAttempted = false;
  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
    try {
      await centerLocator(target);
      // 优先截真实浏览器窗口（含系统地址栏）。只尝试一次（慢），失败回退普通视口截图。
      if (windowTitle && !windowAttempted) {
        const win = await captureWindowScreenshot(page, windowTitle, targetPath);
        windowAttempted = true;
        if (win.ok && fileOk(targetPath) && fs.statSync(targetPath).size > 8000) {
          return { ok: true, attempts: attempt + 1, windowCapture: true };
        }
        lastError = win.error || '窗口截图异常';
      }
      await page.waitForTimeout(250);
      await page.screenshot({ path: targetPath, fullPage: false, animations: 'disabled' });
      if (fileOk(targetPath)) return { ok: true, attempts: attempt + 1 };
      throw new Error('截图文件为空');
    } catch (e) {
      lastError = e;
      if (Date.now() < deadline) await sleep(1000);
    }
  }
  return { ok: false, error: lastError ? lastError.message : '截图超时' };
}

function fileOk(filePath) {
  try { return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0; } catch (e) { return false; }
}

function inspectEvidenceFiles(articleDir) {
  const names = [SCREENSHOT_FILES.likeCollect, ...SCREENSHOT_FILES.comments];
  const files = {};
  names.forEach((name) => { files[name] = fileOk(path.join(articleDir, name)); });
  return {
    files,
    complete: names.every((name) => files[name]),
    any: names.some((name) => files[name]),
  };
}

function evidencePaths(articleDir) {
  return {
    directory: articleDir,
    likeCollect: path.join(articleDir, SCREENSHOT_FILES.likeCollect),
    comments: SCREENSHOT_FILES.comments.map((name) => path.join(articleDir, name)),
  };
}

function writeTextInfo(articleDir, data) {
  const lines = [
    `平台：${data.platformLabel || data.platform || ''}`,
    `文章标题：${data.title || ''}`,
    `文章发布日期：${data.publishDateText || '未知'}`,
    `原始链接：${data.originalUrl || ''}`,
    `最终链接：${data.finalUrl || ''}`,
    `匹配账号：${(data.accounts || []).join('、') || '未知'}`,
    `检测时间：${data.updatedAt || ''}`,
    `评论数：${data.detection?.commentCount == null ? '未知' : data.detection.commentCount}`,
    `点赞：${data.detection?.liked === true ? '是' : data.detection?.liked === false ? '否' : '未知'}`,
    `收藏：${data.detection?.collected === true ? '是' : data.detection?.collected === false ? '否' : '未知'}`,
    `留痕状态：${data.status || ''}`,
    `留痕错误：${data.error || '无'}`,
    '',
    '截图文件：',
    `- ${SCREENSHOT_FILES.likeCollect}：${data.screenshots?.likeCollect?.status || '未生成'}`,
    ...SCREENSHOT_FILES.comments.map((name, index) => `- ${name}：${data.screenshots?.comments?.[index]?.status || '未生成'}`),
  ];
  fs.writeFileSync(path.join(articleDir, '文章信息.txt'), lines.join('\r\n'), 'utf8');
}

function safeJsonWrite(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore cleanup failure */ }
}

// 每次截图成功后立即把文件复制到最终目录（非 force 模式）：
// 即使任务中途被强杀（如用户点停止、进程被 kill），已生成的截图也能保留，不丢失在临时目录里。
function persistIncremental(tempPath, finalPath) {
  try {
    if (fileOk(tempPath) && !fileOk(finalPath)) fs.copyFileSync(tempPath, finalPath);
  } catch (e) { /* 最终目录写失败不影响本次截图，收尾时会再尝试 */ }
}

// 清理本文章目录下残留的旧临时/备份目录（进程被杀可能遗留），只删超过 1 小时的，避免误删正在进行的任务。
function cleanupStaleTemp(articleDir) {
  let names = [];
  try { names = fs.readdirSync(articleDir); } catch (e) { return; }
  const staleMs = Date.now() - 3600 * 1000;
  for (const name of names) {
    if (!/^\.留痕(临时|备份)-/.test(name)) continue;
    try {
      const stat = fs.statSync(path.join(articleDir, name));
      if (stat.mtimeMs < staleMs) removeDir(path.join(articleDir, name));
    } catch (e) { /* ignore */ }
  }
}

function commitCompleteEvidence(tempDir, articleDir) {
  const names = [SCREENSHOT_FILES.likeCollect, ...SCREENSHOT_FILES.comments];
  const backupDir = path.join(articleDir, `.留痕备份-${process.pid}-${Date.now()}`);
  const movedOld = [];
  const movedNew = [];
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    for (const name of names) {
      const oldPath = path.join(articleDir, name);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, path.join(backupDir, name));
        movedOld.push(name);
      }
    }
    for (const name of names) {
      fs.renameSync(path.join(tempDir, name), path.join(articleDir, name));
      movedNew.push(name);
    }
    removeDir(backupDir);
  } catch (e) {
    for (const name of movedNew) {
      try { fs.unlinkSync(path.join(articleDir, name)); } catch (ignore) { /* ignore */ }
    }
    for (const name of movedOld) {
      try { fs.renameSync(path.join(backupDir, name), path.join(articleDir, name)); } catch (ignore) { /* ignore */ }
    }
    removeDir(backupDir);
    throw e;
  }
}

async function captureEvidence({
  page,
  platform,
  originalUrl,
  result,
  screenshotRoot,
  force = false,
  timeoutMs = 90000,
}) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let metadata = { title: result.title || '', finalUrl: originalUrl, publishCandidates: [] };
  try { metadata = await collectPageMetadata(page); } catch (e) { /* metadata fallback is enough for screenshots */ }
  const publication = parsePublicationDate(metadata.publishCandidates, new Date());
  const location = buildLocation({
    screenshotRoot,
    platform,
    originalUrl,
    finalUrl: metadata.finalUrl || originalUrl,
    title: metadata.title || result.title,
    publicationDate: publication,
  });
  fs.mkdirSync(location.articleDir, { recursive: true });
  cleanupStaleTemp(location.articleDir); // 清理上次被强杀遗留的临时/备份目录

  // 用文章标题在系统里匹配检测浏览器窗口，以便截真实窗口（含地址栏）
  const windowTitle = metadata.title || result.title || '';

  const existing = inspectEvidenceFiles(location.articleDir);
  const paths = evidencePaths(location.articleDir);
  const accounts = accountList(result.username);
  // 检测阶段拿到的「我的评论 ID」，留痕按 ID 在 DOM 里精确定位（作者名匹配只做兜底）
  const commentIds = Array.isArray(result.commentIds) ? result.commentIds : [];
  // API 返回的「我的评论确切作者名」（昵称可能不同于账号），并入匹配集，解决 DOM 显示昵称匹配不上的问题
  const commentAuthors = Array.isArray(result.commentAuthors) ? result.commentAuthors : [];
  const matchAccounts = [...new Set([...accounts, ...commentAuthors])];
  const base = {
    version: 1,
    platform,
    platformLabel: location.platformLabel,
    title: metadata.title || result.title || '',
    originalUrl,
    finalUrl: metadata.finalUrl || originalUrl,
    publishDate: publication.year && publication.month ? `${publication.year}-${String(publication.month).padStart(2, '0')}` : null,
    publishDateText: publication.raw || '',
    articleFolder: location.articleFolder,
    articleId: location.articleId,
    accounts,
    detection: {
      commentCount: result.commentCount,
      liked: result.liked,
      collected: result.collected,
      username: result.username || '',
    },
    updatedAt: new Date().toISOString(),
    directory: location.articleDir,
    screenshots: {
      likeCollect: { status: existing.files[SCREENSHOT_FILES.likeCollect] ? 'existing' : 'missing', path: paths.likeCollect },
      comments: paths.comments.map((filePath, index) => ({
        status: existing.files[SCREENSHOT_FILES.comments[index]] ? 'existing' : 'missing',
        path: filePath,
      })),
    },
  };

  if (existing.complete && !force) {
    base.status = 'reused';
    base.reused = true;
    writeTextInfo(location.articleDir, base);
    safeJsonWrite(path.join(location.articleDir, '留痕信息.json'), base);
    return { ...base, status: 'complete', reused: true };
  }

  const tempDir = path.join(location.articleDir, `.留痕临时-${process.pid}-${Date.now()}-${hashUrl(originalUrl)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const tempLikePath = path.join(tempDir, SCREENSHOT_FILES.likeCollect);
  let likeResult = { status: 'failed', error: '' };
  const commentResults = [0, 1, 2].map(() => ({ status: 'failed', error: '' }));

  try {
    if (Date.now() < deadline) {
      const action = await firstVisibleLocator(page, ACTION_SELECTORS[platform]);
      if (action) {
        const shot = await screenshotWithRetry(page, action, tempLikePath, deadline, windowTitle);
        likeResult = shot.ok ? { status: 'success', attempts: shot.attempts } : { status: 'failed', error: shot.error };
        if (likeResult.status === 'success' && !force) persistIncremental(tempLikePath, paths.likeCollect);
      } else {
        likeResult = { status: 'failed', error: '未找到点赞操作栏' };
      }
    } else likeResult = { status: 'failed', error: '留痕超时' };

    const commentDeadline = deadline;
    if (!matchAccounts.length) {
      commentResults.forEach((item) => { item.error = '未识别到当前账号，无法定位评论'; });
    } else {
      console.log(`📋 [留痕] 检测返回：评论ID数=${commentIds.length}，匹配集=[${matchAccounts.join('、')}]`);
      const found = await discoverComments(page, platform, matchAccounts, commentIds, commentDeadline);
      // 评论区可能在独立窗口/标签页（知乎/CSDN 的评论弹层），截图用评论所在页
      const commentPage = found.commentPage || page;
      for (let i = 0; i < 3; i++) {
        if (Date.now() >= commentDeadline) {
          commentResults[i].error = '留痕超时';
          continue;
        }
        const selector = found.selector;
        const item = found.items[i];
        // item 存在就视为匹配成功（新版用 item.path 定位，selector 可能为空，不能用 !selector 误判）
        if (!item || (!item.path && !selector)) {
          commentResults[i].error = found.error
            ? found.error
            : (found.found > 0
              ? `评论区已加载 ${found.found} 条评论，但未匹配到账号「${accounts.join('、')}」`
              : '未定位到当前账号评论');
          continue;
        }
        const target = item.path
          ? commentPage.locator(item.path).first()
          : commentPage.locator(selector).nth(item.index);
        const shot = await screenshotWithRetry(commentPage, target, path.join(tempDir, SCREENSHOT_FILES.comments[i]), commentDeadline, windowTitle);
        commentResults[i] = shot.ok
          ? { status: 'success', attempts: shot.attempts, author: item.author }
          : { status: 'failed', error: shot.error };
        if (shot.ok && !force) persistIncremental(path.join(tempDir, SCREENSHOT_FILES.comments[i]), paths.comments[i]);
      }
    }
  } catch (e) {
    const error = e && e.message ? e.message : String(e);
    if (likeResult.status !== 'success' && !likeResult.error) likeResult.error = error;
    commentResults.forEach((item) => { if (item.status !== 'success' && !item.error) item.error = error; });
  }

  base.screenshots.likeCollect = { ...base.screenshots.likeCollect, ...likeResult, path: paths.likeCollect };
  base.screenshots.comments = commentResults.map((item, index) => ({
    ...base.screenshots.comments[index],
    ...item,
    path: paths.comments[index],
  }));
  const allSuccess = likeResult.status === 'success' && commentResults.every((item) => item.status === 'success');
  const hasAnySuccess = likeResult.status === 'success' || commentResults.some((item) => item.status === 'success');

  try {
    if (allSuccess) {
      commitCompleteEvidence(tempDir, location.articleDir);
      base.status = 'complete';
    } else {
      // 首次留痕允许保留已成功的文件；已有完整证据时绝不被失败重试覆盖。
      if (!existing.complete) {
        const generated = [SCREENSHOT_FILES.likeCollect, ...SCREENSHOT_FILES.comments];
        for (const name of generated) {
          const tempPath = path.join(tempDir, name);
          const finalPath = path.join(location.articleDir, name);
          if (fileOk(tempPath) && !fileOk(finalPath)) fs.renameSync(tempPath, finalPath);
        }
      }
      base.status = hasAnySuccess ? 'partial' : 'failed';
    }
  } catch (e) {
    base.status = 'failed';
    base.error = `保存截图失败：${e.message}`;
  } finally {
    removeDir(tempDir);
  }

  const errors = [];
  if (base.status !== 'complete') {
    if (likeResult.error) errors.push(`点赞收藏：${likeResult.error}`);
    commentResults.forEach((item, index) => { if (item.error) errors.push(`评论${index + 1}：${item.error}`); });
  }
  if (errors.length) base.error = [base.error, ...errors].filter(Boolean).join('；');
  const finalFiles = inspectEvidenceFiles(location.articleDir);
  if (finalFiles.complete) base.status = 'complete';
  base.updatedAt = new Date().toISOString();
  writeTextInfo(location.articleDir, base);
  safeJsonWrite(path.join(location.articleDir, '留痕信息.json'), base);
  return base;
}

module.exports = {
  PLATFORM_LABELS,
  SCREENSHOT_FILES,
  parsePublicationDate,
  extractArticleId,
  buildLocation,
  inspectEvidenceFiles,
  captureEvidence,
};
