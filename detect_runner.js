// detect_runner.js
// 检测阶段独立执行入口：由 server.js fork。
// 环境变量：
//   PLATFORM       zhihu | csdn | toutiao | sohu | baidu | netease
//   URLS           JSON 文章链接数组
//   USER_DATA_PATH 浏览器用户数据目录（与评论阶段一致，复用登录态）
//   ACCOUNTS       JSON {平台: 手动账号名}，手填账号优先于页面自动识别
const { chromium } = require('patchright');
const { detectArticle } = require('./detect');
const { checkPause } = require('./pauser'); // 支持暂停/继续（与评论脚本一致）
const { captureEvidence } = require('./evidence');

const PLATFORM = process.env.PLATFORM;
let URLS = [];
try { URLS = JSON.parse(process.env.URLS || '[]'); } catch (e) { URLS = []; }
const USER_DATA_PATH = process.env.USER_DATA_PATH;
const SCREENSHOT_ROOT = process.env.SCREENSHOT_ROOT || '';
const FORCE_EVIDENCE = process.env.FORCE_EVIDENCE === '1';
let ACCOUNTS = {};
try { ACCOUNTS = JSON.parse(process.env.ACCOUNTS || '{}'); } catch (e) { ACCOUNTS = {}; }
const MANUAL_USER = ACCOUNTS[PLATFORM] || '';

function sleep(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

// 判定页面是否已失效（HTTP 404 或软 404 错误页）
async function isInvalid(page, resp) {
  try {
    if (resp && resp.status() === 404) return true;
    return await page.evaluate(() => {
      const title = (document.title || '').trim();
      if (/^404(?:\s|$|[-_|])/i.test(title)) return true;
      const nodes = document.querySelectorAll(
        '.new_404, .error-404, .error-page, .error-container, .notfound, [class*="not-found"], [class*="notfound"]'
      );
      for (const n of nodes) {
        const t = (n.textContent || '').replace(/\s+/g, '');
        if (/内容不存在|文章不存在|页面不存在|作者删除了内容|想找的内容离你而去|已被删除|资源不存在|404/.test(t)) return true;
      }
      return false;
    });
  } catch (e) {
    return false;
  }
}

async function getTitle(page) {
  try { return (await page.title()) || ''; } catch (e) { return ''; }
}

// 网易登录态判定（2026-10-29 重写）。
//
// 门户登录态 ≠ 跟帖登录态：
//   勾选「10天免登录」后，门户靠 NTES_YD_PASSPORT 长期保持登录（页头一直显示「安全退出」），
//   但跟帖系统要 NTES_SESS，浏览器会话一结束/过期就没了 →
//   comment.api.163.com/.../users/myInfo 返回 401「未认证用户」→
//   跟帖区整块不渲染（评论数显示 0），输入框也不存在。
// 旧实现只找 `#tieArea` 输入框里的昵称，遇到这种情况会误报「未检测到登录态」并死等 5 分钟，
// 用户完全不知道该怎么办。现在改为以 myInfo 为准，并把原因讲清楚。
const NETEASE_PRODUCT_KEY = 'a2869674571f77b5a0867c3d71db5856';

async function readNeteaseAuth(page) {
  return page.evaluate(async (productKey) => {
    const clean = (value) => String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    // 跟帖会话：唯一可靠口径
    let commentAuth = 'unknown';
    let commentUserId = '';
    let commentNickname = '';
    try {
      const r = await fetch(
        `https://comment.api.163.com/api/v1/products/${productKey}/users/myInfo?callback=_aiNeUser&_=${Date.now()}`,
        { credentials: 'include', headers: { Accept: 'text/javascript, application/json' } },
      );
      if (r.status === 401) commentAuth = 'invalid';
      else if (r.ok) {
        commentAuth = 'ok';
        const text = await r.text();
        const open = text.indexOf('(');
        const close = text.lastIndexOf(')');
        let data = null;
        try { data = open > -1 && close > open ? JSON.parse(text.slice(open + 1, close)) : JSON.parse(text); } catch (_) { data = null; }
        const user = data?.user || data?.data || data || {};
        commentUserId = clean(user.userId || user.id || '');
        commentNickname = clean(user.nickname || user.nickName || user.name || '');
      }
    } catch (_) { /* 网络异常按 unknown 处理 */ }
    // 门户登录态：页头出现「安全退出」即视为已登录
    const portalLoggedIn = /安全退出/.test(clean(document.body?.innerText || '').slice(0, 3000));
    // 输入框昵称（只有跟帖区渲染出来才存在，仅作兜底）
    const nickname = clean(
      document.querySelector('#tieArea .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('#post_comment_area .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('.tie-input-bar .photo-area .nickname')?.textContent,
    );
    return { commentAuth, commentUserId, commentNickname, portalLoggedIn, nickname };
  }, NETEASE_PRODUCT_KEY).catch(() => ({
    commentAuth: 'unknown', commentUserId: '', commentNickname: '', portalLoggedIn: false, nickname: '',
  }));
}

async function waitForNeteaseLogin(page, timeoutMs = 2 * 60 * 1000) {
  await page.evaluate(() => {
    const el = document.querySelector('#post_comment_area')
      || document.querySelector('#tieArea')
      || document.querySelector('.tie-areas');
    el?.scrollIntoView({ block: 'center' });
  }).catch(() => {});

  let state = await readNeteaseAuth(page);
  // 输入框昵称存在 = 跟帖区渲染出来了，等价于登录可用；myInfo 异常时用它兜底，避免误判要重新登录
  if (state.commentAuth === 'ok' || (state.commentAuth === 'unknown' && state.nickname)) {
    return { nickname: state.commentNickname || state.nickname, userId: state.commentUserId };
  }

  if (state.portalLoggedIn) {
    console.log('⚠️ 网易门户仍是登录状态，但**跟帖登录态已失效**（跟帖接口返回 401「未认证用户」）。');
    console.log('   这就是「评论区显示 0 条、什么都没有」的原因：门户靠「10天免登录」保持着登录，跟帖会话并没有。');
    console.log('   请在弹出的窗口里做两步：① 点右上角「安全退出」；② 重新登录网易，**不要勾选「10天免登录」**。');
    console.log(`   登录完成后会自动继续（最多等 ${Math.round(timeoutMs / 60000)} 分钟）。`);
  } else {
    console.log(`⚠️ 网易未登录：请在弹出的文章页登录网易，登录后会自动继续（最多等 ${Math.round(timeoutMs / 60000)} 分钟）。`);
  }

  // 手填账号时仍然可以算数：检测端会自己拼跟帖接口，按昵称匹配，不需要跟帖会话。
  // 这种情况不必卡在这里等用户动手，直接放行（评论发布才必须要跟帖会话）。
  if (MANUAL_USER) {
    console.log(`ℹ️ 已手填账号「${MANUAL_USER}」：按昵称统计跟帖数不依赖跟帖登录态，继续检测。`);
    return { nickname: '', userId: '' };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    state = await readNeteaseAuth(page);
    if (state.commentAuth === 'ok') {
      console.log(`✅ 网易跟帖登录态已恢复：${state.commentNickname || state.commentUserId}`);
      return { nickname: state.commentNickname || state.nickname, userId: state.commentUserId };
    }
  }
  throw new Error(state.portalLoggedIn
    ? '网易跟帖登录态失效未恢复：请点右上角「安全退出」后重新登录网易，且不要勾选「10天免登录」'
    : '等待网易登录超时，请重新运行');
}

function neteaseCommentThreadUrl(articleUrl) {
  const parsed = new URL(articleUrl);
  if (parsed.hostname === 'comment.tie.163.com') return parsed.toString();
  const threadId = parsed.pathname.match(/\/article\/([A-Za-z0-9_-]+)\.html(?:$|\/)/i)?.[1];
  if (!threadId) throw new Error('无法从网易文章链接识别跟贴编号');
  return `https://comment.tie.163.com/${encodeURIComponent(threadId)}.html`;
}

(async () => {
  if (!PLATFORM || !DETECT_SUPPORTED(PLATFORM)) {
    console.log(`@@DETECT_RESULT@@${JSON.stringify({ platform: PLATFORM, results: [], reason: '不支持的平台' })}`);
    return;
  }
  if (!URLS.length) {
    console.log(`@@DETECT_RESULT@@${JSON.stringify({ platform: PLATFORM, results: [] })}`);
    return;
  }
  if (!USER_DATA_PATH) {
    console.log(`@@DETECT_RESULT@@${JSON.stringify({ platform: PLATFORM, results: [], reason: '缺少 USER_DATA_PATH' })}`);
    return;
  }

  console.log(`===== 开始检测 ${PLATFORM}：共 ${URLS.length} 篇${MANUAL_USER ? '（手填账号：' + MANUAL_USER + '）' : ''} =====`);

  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(USER_DATA_PATH, {
      headless: false,
      viewport: { width: 1440, height: 1000 },
    });

    // IPC：收到取消信号时发送已完成的结果再退出
    if (process.send) {
      process.on('message', (msg) => {
        if (msg && msg.cmd === 'cancel') {
          console.log('⏹ 收到取消信号，发送已完成结果');
          console.log(`@@DETECT_RESULT@@${JSON.stringify({ platform: PLATFORM, results })}`);
          process.exit(0);
        }
      });
    }

    for (const url of URLS) {
      await checkPause();
      const page = await context.newPage();
      try {
        console.log(`检测中：${url}`);
        // 搜狐互动状态依赖首页会话初始化；先建立会话再打开文章，和评论脚本保持一致。
        if (PLATFORM === 'sohu') {
          await page.goto('https://www.sohu.com/', { waitUntil: 'load', timeout: 60000 });
          await sleep(1500, 2500);
        }
        const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await sleep(2500, 4500);

        // 先判失效（404/被删），失效就跳过具体检测
        const invalid = await isInvalid(page, resp);
        let r;
        if (invalid) {
          r = { platform: PLATFORM, title: await getTitle(page) || '链接已失效', username: MANUAL_USER || null, commentCount: null, liked: null, collected: null, invalid: true };
          console.log(`⚠ 链接已失效（404/被删），跳过：${url}`);
        } else {
          if (PLATFORM === 'netease') await waitForNeteaseLogin(page);
          r = await detectArticle(page, PLATFORM, MANUAL_USER);
          r.invalid = false;

          // 网易没有文章级点赞/收藏，只按评论数达标；其余平台仍要求三项明确达标。
          const evidenceEligible = Number.isFinite(r.commentCount)
            && r.commentCount >= 3
            && (PLATFORM === 'netease' || (r.liked === true && r.collected === true));
          if (evidenceEligible) {
            if (!SCREENSHOT_ROOT) {
              r.evidence = { status: 'failed', error: '未配置留痕截图根目录' };
            } else {
              console.log(`📸 检测达标，开始留痕：${url}`);
              try {
                if (PLATFORM === 'netease') {
                  await page.goto(neteaseCommentThreadUrl(url), { waitUntil: 'domcontentloaded', timeout: 60000 });
                  await page.waitForTimeout(2500);
                }
                r.evidence = await captureEvidence({
                  page,
                  platform: PLATFORM,
                  originalUrl: url,
                  result: r,
                  screenshotRoot: SCREENSHOT_ROOT,
                  force: FORCE_EVIDENCE,
                  timeoutMs: 180000,
                });
              } catch (e) {
                r.evidence = { status: 'failed', error: `留痕异常：${e.message}` };
              }
              console.log(`📸 留痕${r.evidence.status === 'complete' ? '完成' : '未完整'}：${r.evidence.directory || ''}${r.evidence.error ? `（${r.evidence.error}）` : ''}`);
            }
          } else {
            r.evidence = {
              status: 'skipped',
              reason: PLATFORM === 'netease'
                ? '检测未达标（网易评论需≥3）'
                : '检测未严格达标（评论需≥3且点赞、收藏均明确为是）',
            };
          }
        }

        const likedTxt = PLATFORM === 'netease' ? '不适用' : (r.liked === null ? '未知' : (r.liked ? '✅' : '❌'));
        const colTxt = PLATFORM === 'netease' ? '不适用' : (r.collected === null ? '未知' : (r.collected ? '✅' : '❌'));
        const cmtTxt = r.commentCount === null ? '未知' : `${r.commentCount}条`;
        console.log(`→ 评论[${cmtTxt}] 点赞[${likedTxt}] 收藏[${colTxt}]${r.username ? ' 账号=' + r.username : ''}${r.error ? ' 错误=' + r.error : ''}`);

        results.push({
          url,
          title: r.title || '',
          username: r.username || '',
          commentCount: r.commentCount,
          liked: r.liked,
          collected: r.collected,
          invalid: !!r.invalid,
          evidence: r.evidence,
          accountStatus: r.accountStatus,
          warning: r.warning,
          error: r.error || undefined,
        });
      } catch (e) {
        console.log(`❌ 检测失败 ${url}：${e.message}`);
        results.push({ url, title: '', commentCount: null, liked: null, collected: null, invalid: false, error: e.message });
      } finally {
        if (page && !page.isClosed()) await page.close().catch(() => {});
        await sleep(1500, 3000);
      }
    }

    console.log(`===== ${PLATFORM} 检测完成 =====`);
  } catch (e) {
    console.log(`❌ 检测浏览器启动失败：${e.message}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }

  console.log(`@@DETECT_RESULT@@${JSON.stringify({ platform: PLATFORM, results })}`);
  // 兜底：确保检测进程一定退出（即便有 patchright/IPC 残留句柄），否则 server 会一直等子进程退出
  process.exit(0);
})();

function DETECT_SUPPORTED(p) {
  return p === 'zhihu' || p === 'csdn' || p === 'toutiao' || p === 'sohu' || p === 'baidu' || p === 'netease';
}
