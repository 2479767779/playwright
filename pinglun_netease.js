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

  // 网易登录态：门户（页头「安全退出」）与跟帖（myInfo 接口）是两套，必须分开看。
  // 勾了「10天免登录」时门户一直登录着，但跟帖会话会失效 → 跟帖区不渲染、输入框不存在。
  const NETEASE_PRODUCT_KEY = 'a2869674571f77b5a0867c3d71db5856';
  const readAccount = async (page) => page.evaluate(async (productKey) => {
    const clean = (value) => String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
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
    } catch (_) { /* ignore */ }
    const nickname = clean(
      document.querySelector('#tieArea .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('#post_comment_area .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('.tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('#tieArea .submit-row .photo-area')?.textContent,
    );
    let userId = '';
    const logout = document.querySelector('#tieArea a[href*="reg.163.com/Logout.jsp"]')
      || document.querySelector('a[href*="Logout.jsp"]');
    try {
      const value = logout && new URL(logout.href).searchParams.get('username');
      if (value && /^\d+$/.test(value)) userId = value;
    } catch (_) { /* ignore */ }
    const portalLoggedIn = /安全退出/.test(clean(document.body?.innerText || '').slice(0, 3000));
    return {
      nickname: commentNickname || nickname,
      userId: commentUserId || userId,
      commentAuth,
      portalLoggedIn,
    };
  }, NETEASE_PRODUCT_KEY);

  const waitForLogin = async (page, timeoutMs = 3 * 60 * 1000) => {
    const deadline = Date.now() + timeoutMs;
    let prompted = false;
    while (Date.now() < deadline) {
      const account = await readAccount(page).catch(() => ({ nickname: '', userId: '', commentAuth: 'unknown', portalLoggedIn: false }));
      // 跟帖会话可用 = 一定会渲染输入框，才算真的能评论；
      // myInfo 网络异常（unknown）但有输入框昵称时也放行，避免误判卡住。
      if (account.commentAuth === 'ok' || (account.commentAuth === 'unknown' && account.nickname)) return account;
      if (!prompted) {
        if (account.portalLoggedIn) {
          console.log('⚠️ 网易门户仍是登录状态，但**跟帖登录态已失效**（跟帖接口返回 401）。');
          console.log('   评论区会显示 0 条、输入框也不存在，这就是「什么都没有」的原因。');
          console.log('   请在弹出的窗口里：① 点右上角「安全退出」；② 重新登录网易，**不要勾选「10天免登录」**。');
        } else {
          console.log('⚠️ 网易未登录：请在弹出的文章页登录网易，登录后会自动继续。');
        }
        console.log(`   最多等 ${Math.round(timeoutMs / 60000)} 分钟。`);
        prompted = true;
      }
      await page.waitForTimeout(2500);
    }
    throw new Error('网易跟帖登录态不可用（跟帖接口 401）：请点右上角「安全退出」后重新登录，且不要勾选「10天免登录」');
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
        await page.evaluate(() => {
          const el = document.querySelector('#post_comment_area')
            || document.querySelector('#tieArea')
            || document.querySelector('.tie-areas');
          el?.scrollIntoView({ block: 'center' });
        }).catch(() => {});

        const account = await waitForLogin(page);
        console.log(`✅ 网易跟帖登录态正常：${account.nickname || account.userId}`);

        const before = await detectArticle(page, 'netease', '');
        if (before.accountStatus !== 'logged_in') {
          throw new Error(before.error || `网易账号状态不可用：${before.accountStatus || '未知'}`);
        }
        if (!Number.isFinite(before.commentCount)) {
          throw new Error(before.error || '无法取得网易评论基线，已停止发布');
        }
        console.log(`📊 发布前当前账号评论数：${before.commentCount}`);

        const articleText = await extractArticleText(page);
        console.log(`已提取网易正文约 ${articleText.length} 字`);
        let previousCount = before.commentCount;

        // 预生成流水线：把 AI 的等待藏进「发布 + 随机等待」里（详见其他平台脚本同样注释）
        let pendingComment = generateQuestionComment(articleText, AI_CONFIG);
        pendingComment.catch(() => {});

        for (let i = 1; i <= perUrlCommentCount; i++) {
          await checkPause();
          console.log(`当前文章第 ${i}/${perUrlCommentCount} 条网易评论`);
          let commentText;
          try {
            commentText = await pendingComment;
          } catch (error) {
            console.log(`❌ AI 生成失败，停止当前网易文章：${error.message}`);
            break;
          }
          // 立刻发起下一条的生成（不 await）—— 它和本条的填写/发布同时进行
          if (i < perUrlCommentCount) {
            pendingComment = generateQuestionComment(articleText, AI_CONFIG);
            pendingComment.catch(() => {});
          }
          console.log(`本次网易评论内容：${commentText}`);

          // 新版文章页评论区容器是 #post_comment_area（旧版是 #tieArea），两者都要兼容
          const editor = page.locator([
            '#post_comment_area textarea.js-cnt-box',
            '#post_comment_area textarea',
            '#post_comment_area [contenteditable="true"]',
            '#tieArea textarea.js-cnt-box',
            '#tieArea textarea',
            '#tieArea [contenteditable="true"]',
            '.tie-input-bar textarea',
            '.tie-input-bar [contenteditable="true"]',
          ].join(', ')).first();
          await editor.waitFor({ state: 'visible', timeout: 30000 });
          await editor.fill(commentText);
          await randomSleep(800, 1600);

          let button = null;
          for (const selector of [
            '#post_comment_area .submit-btn.js-submit-btn',
            '#post_comment_area button[type="submit"]',
            '#post_comment_area .submit-btn',
            '#tieArea .submit-btn.js-submit-btn',
            '#tieArea button[type="submit"]',
            '#tieArea .submit-btn',
            '.js-submit-btn',
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
