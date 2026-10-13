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

async function waitForNeteaseLogin(page, timeoutMs = 5 * 60 * 1000) {
  const readAccount = () => page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    const nickname = clean(
      document.querySelector('#tieArea .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('#tieArea .submit-row .photo-area')?.textContent,
    );
    let userId = '';
    const logout = document.querySelector('#tieArea a[href*="reg.163.com/Logout.jsp"]');
    try {
      const value = logout && new URL(logout.href).searchParams.get('username');
      if (value && /^\d+$/.test(value)) userId = value;
    } catch (_) { /* ignore */ }
    return { nickname, userId };
  });

  await page.evaluate(() => document.querySelector('#tieArea')?.scrollIntoView({ block: 'center' })).catch(() => {});
  let account = await readAccount().catch(() => ({ nickname: '', userId: '' }));
  if (account.nickname || account.userId) return account;
  console.log('⚠️ 未检测到网易登录态：请在弹出的文章页登录网易，登录后会自动继续（最多等 5 分钟）。');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    account = await readAccount().catch(() => ({ nickname: '', userId: '' }));
    if (account.nickname || account.userId) return account;
  }
  throw new Error('等待网易登录超时，请重新运行');
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
