// 网易 163 自动评论脚本。
// 由 server.js 注入文章列表、每篇评论数和持久化 profile；网易不执行文章点赞/收藏。
const { chromium } = require('patchright');
const { generateQuestionComment, extractArticleText } = require('./aiComment');
const AI_CONFIG = require('./aiConfig');
const { checkPause } = require('./pauser');
const { detectArticle } = require('./detect');

(async () => {
  const neteaseUrlList = [
  ];
  const perUrlCommentCount = 1;
  const userDataPath = 'D:\\playwright\\pw-data-netease';

  const randomSleep = (min = 2500, max = 5000) => new Promise((resolve) => {
    const ms = Math.floor(Math.random() * (max - min) + min);
    setTimeout(resolve, ms);
  });

  const readAccount = async (page) => page.evaluate(() => {
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

  const waitForLogin = async (page, timeoutMs = 5 * 60 * 1000) => {
    const deadline = Date.now() + timeoutMs;
    let prompted = false;
    while (Date.now() < deadline) {
      const account = await readAccount(page).catch(() => ({ nickname: '', userId: '' }));
      if (account.nickname || account.userId) return account;
      if (!prompted) {
        console.log('⚠️ 未检测到网易登录态：请在弹出的文章页登录网易，登录后会自动继续（最多等 5 分钟）。');
        prompted = true;
      }
      await page.waitForTimeout(2000);
    }
    throw new Error('未检测到网易登录态，等待登录超时');
  };

  const waitForCommentIncrease = async (page, previousCount) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.waitForTimeout(5000);
      const state = await detectArticle(page, 'netease', '');
      if (state.accountStatus === 'account_mismatch') {
        throw new Error('网易当前登录账号发生变化，已停止后续评论');
      }
      if (Number.isFinite(state.commentCount) && state.commentCount > previousCount) return state;
      console.log(`⏳ 网易评论仍在同步（${attempt + 1}/12），当前检测数：${Number.isFinite(state.commentCount) ? state.commentCount : '未知'}`);
    }
    return null;
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataPath, {
      headless: false,
      viewport: { width: 1200, height: 900 },
    });

    for (const targetUrl of neteaseUrlList) {
      await checkPause();
      let page;
      try {
        console.log(`\n===== 开始处理网易文章：${targetUrl} =====`);
        page = await context.newPage();
        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (response && response.status() === 404) throw new Error('文章链接返回 404');
        await page.waitForTimeout(3000);
        await page.evaluate(() => document.querySelector('#tieArea')?.scrollIntoView({ block: 'center' })).catch(() => {});

        const account = await waitForLogin(page);
        console.log(`✅ 网易已登录：${account.nickname || account.userId}`);

        const before = await detectArticle(page, 'netease', '');
        if (before.accountStatus !== 'logged_in') {
          throw new Error(`网易账号状态不可用：${before.accountStatus || '未知'}`);
        }
        if (!Number.isFinite(before.commentCount)) {
          throw new Error(before.error || '无法取得网易评论基线，已停止发布');
        }
        console.log(`📊 发布前当前账号评论数：${before.commentCount}`);

        const articleText = await extractArticleText(page);
        console.log(`已提取网易正文约 ${articleText.length} 字`);
        let previousCount = before.commentCount;

        for (let i = 1; i <= perUrlCommentCount; i++) {
          await checkPause();
          console.log(`当前文章第 ${i}/${perUrlCommentCount} 条网易评论`);
          let commentText;
          try {
            commentText = await generateQuestionComment(articleText, AI_CONFIG);
          } catch (error) {
            console.log(`❌ AI 生成失败，停止当前网易文章：${error.message}`);
            break;
          }
          console.log(`本次网易评论内容：${commentText}`);

          const editor = page.locator(
            '#tieArea textarea.js-cnt-box, #tieArea textarea, #tieArea [contenteditable="true"], .tie-input-bar textarea',
          ).first();
          await editor.waitFor({ state: 'visible', timeout: 30000 });
          await editor.fill(commentText);
          await randomSleep(800, 1600);

          let button = null;
          for (const selector of [
            '#tieArea .submit-btn.js-submit-btn',
            '#tieArea button[type="submit"]',
            '#tieArea .submit-btn',
            '.tie-submit',
          ]) {
            const candidate = page.locator(selector).first();
            if (await candidate.isVisible().catch(() => false)) {
              button = candidate;
              break;
            }
          }
          if (!button) throw new Error('找不到网易跟帖发布按钮');
          await button.click({ timeout: 15000 });
          console.log('✅ 已点击网易跟帖发布，等待接口确认');

          const after = await waitForCommentIncrease(page, previousCount);
          if (!after) {
            console.log('⚠️ 网易评论未在 60 秒内确认新增，标记待平台同步并停止当前文章');
            break;
          }
          previousCount = after.commentCount;
          console.log(`✅ 网易评论已复检确认，当前账号评论数：${previousCount}`);
        }
      } catch (error) {
        console.log(`❌ 网易当前文章处理异常，跳过本篇：${error.message}`);
      } finally {
        if (page && !page.isClosed()) await page.close().catch(() => {});
      }
      await randomSleep(8000, 15000);
    }
    console.log(`\n✅ 所有网易文章评论任务执行完毕`);
  } catch (error) {
    console.log(`❌ 网易浏览器上下文异常：${error.message}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }
})();
