// 网易 163 评论检测器。
// 该函数会被 page.evaluate 执行，因此必须保持自包含，只依赖浏览器页面全局对象。
//
// 2026-10-29 实测（新版文章页模板 + 「10天免登录」导致的跟帖会话失效）：
//   1) 文章页评论区容器已从 #tieArea 变成 #post_comment_area（类名 tie-areas post_comment）；
//      跟帖 SDK 没渲染时容器是空的，因此**不能**用「页面里有没有 #tieArea 昵称」判断登录。
//   2) 门户登录态（页头「131*****214 安全退出」）和跟帖登录态是两套：
//      勾了「10天免登录」后门户靠 NTES_YD_PASSPORT 长期保持登录，
//      但跟帖系统要 NTES_SESS，过期/浏览器重启后就没了 →
//      comment.api.163.com/.../users/myInfo 返回 401「未认证用户」，
//      于是跟帖区整块不渲染、计数显示 0（文章其实有 15 条跟帖）。
//   3) 旧实现靠「观察页面自己发出的评论接口请求」拿接口地址，评论区不渲染就永远拿不到 →
//      报「未发现网易评论接口」，评论数变成未知。现在改为**按文章 ID 自己拼接口**，
//      不再依赖评论区是否渲染。
async function detectNetease(manual) {
  const COMMENT_API_ORIGIN = 'https://comment.api.163.com';
  // 网易号（dy）文章统一用这个 productKey
  const PRODUCT_KEY = 'a2869674571f77b5a0867c3d71db5856';
  const COMMENT_PAGE_SIZE = 30;
  const MAX_COMMENT_PAGES = 100;
  const clean = (value) => String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const splitAccounts = (value) => [...new Set(String(value || '')
    .split(/[,，、]/)
    .map(clean)
    .filter(Boolean))];

  const title = (() => {
    try {
      return clean(document.querySelector('meta[property="og:title"]')?.content)
        || clean(document.querySelector('h1')?.textContent)
        || document.title.replace(/[_|｜].*网易.*$/i, '')
        || document.title
        || '未知文章';
    } catch (_) {
      return '';
    }
  })();

  // 跟帖编号：文章页 /dy/article/<id>.html 或跟帖页 comment.tie.163.com/<id>.html
  const threadId = (() => {
    try {
      const path = location.pathname || '';
      const m = path.match(/\/article\/([A-Za-z0-9_-]+)\.html/i) || path.match(/^\/([A-Za-z0-9_-]+)\.html$/i);
      return m ? m[1] : '';
    } catch (_) {
      return '';
    }
  })();

  // 门户是否登录：页头会出现「安全退出」。和跟帖登录态不是一回事，必须分开判断。
  const portalLoggedIn = (() => {
    try {
      const text = clean(document.body?.innerText || '').slice(0, 3000);
      return /安全退出/.test(text);
    } catch (_) {
      return false;
    }
  })();

  // 跟帖系统的用户信息接口：200 = 跟帖会话有效（能读到 userId / nickname）；401 = 会话失效。
  // 这是唯一可靠的口径 —— 页头登录着也可能 401。
  const readCommentIdentity = async () => {
    if (!PRODUCT_KEY) return { status: 'unknown' };
    try {
      const response = await fetch(
        `${COMMENT_API_ORIGIN}/api/v1/products/${PRODUCT_KEY}/users/myInfo?callback=_aiNeUser&_=${Date.now()}`,
        { credentials: 'include', headers: { Accept: 'text/javascript, application/json' } },
      );
      if (response.status === 401) return { status: 'invalid' };
      if (!response.ok) return { status: 'unknown', httpStatus: response.status };
      const text = await response.text();
      const open = text.indexOf('(');
      const close = text.lastIndexOf(')');
      let data = null;
      try {
        data = open > -1 && close > open ? JSON.parse(text.slice(open + 1, close)) : JSON.parse(text);
      } catch (_) { data = null; }
      const user = data?.user || data?.data || data || {};
      return {
        status: 'ok',
        userId: clean(user.userId || user.id || ''),
        nickname: clean(user.nickname || user.nickName || user.name || ''),
      };
    } catch (_) {
      return { status: 'unknown' };
    }
  };

  const identity = await readCommentIdentity();

  // 账号来源优先级：跟帖 myInfo（最权威）→ 输入框昵称 → 页头掩码手机号 → 退出链接 username
  const detected = (() => {
    const nickname = clean(
      document.querySelector('#tieArea .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('#post_comment_area .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('.tie-input-bar .photo-area .nickname')?.textContent,
    );
    let userId = '';
    const logoutLink = document.querySelector('a[href*="reg.163.com/Logout.jsp"]')
      || document.querySelector('#post_comment_area a[href*="Logout.jsp"]')
      || document.querySelector('a[href*="Logout.jsp"]');
    try {
      const value = logoutLink && new URL(logoutLink.href).searchParams.get('username');
      if (value && /^\d+$/.test(value)) userId = value;
    } catch (_) { /* ignore malformed logout link */ }
    // 页头掩码手机号（131*****214）：只在完全没有其他账号信息时用于「确认已登录」，不参与评论匹配
    let headerMask = '';
    try {
      const text = clean(document.body?.innerText || '').slice(0, 1200);
      headerMask = (text.match(/\d{3}\*{2,}\d{2,4}/) || [''])[0];
    } catch (_) { headerMask = ''; }
    return {
      nickname: identity.status === 'ok' ? (identity.nickname || nickname) : nickname,
      userId: identity.status === 'ok' ? (identity.userId || userId) : userId,
      headerMask,
    };
  })();

  const manualAccounts = splitAccounts(manual);
  const matchAccounts = manualAccounts.length ? manualAccounts : (detected.nickname ? [detected.nickname] : []);
  const detectedMatchesManual = !manualAccounts.length
    || (Boolean(detected.nickname) && manualAccounts.includes(detected.nickname));
  const hasDetectedAccount = Boolean(detected.nickname || detected.userId);
  const accountStatus = hasDetectedAccount
    ? (detectedMatchesManual ? 'logged_in' : 'account_mismatch')
    : (manualAccounts.length ? 'unknown' : 'auth_required');
  const accountWarning = accountStatus === 'account_mismatch'
    ? `手填网易账号“${manualAccounts.join('、')}”与当前登录账号“${detected.nickname || detected.userId}”不一致，已按手填账号检测`
    : '';

  const commentAuth = identity.status; // ok | invalid | unknown

  // 跟帖会话失效时给出**可操作**的结论，避免用户只看到「评论数 0 / 未登录」一头雾水
  const commentAuthError = commentAuth === 'invalid'
    ? (portalLoggedIn
      ? '网易跟帖登录态已失效：页面右上角仍显示已登录（10天免登录保住了门户会话），但跟帖接口返回 401「未认证用户」，导致评论区加载不出来。请在打开的窗口里点右上角「安全退出」，再重新登录网易，并且**不要勾选「10天免登录」**。'
      : '网易跟帖登录态已失效（跟帖接口返回 401「未认证用户」），请在打开的窗口里重新登录网易网易。')
    : '';

  const isAllowedApiUrl = (value) => {
    try {
      const url = new URL(value);
      return url.origin === COMMENT_API_ORIGIN
        && /\/api\/v1\/products\/[^/]+\/threads\/[^/]+\/comments\/(?:newList|hotList)$/.test(url.pathname);
    } catch (_) {
      return false;
    }
  };

  // 优先用页面自己发过的请求当模板（参数更贴近浏览器），拿不到就按线程 ID 自己拼
  const buildTemplateFromThread = () => {
    if (!threadId || !PRODUCT_KEY) return null;
    return new URL(`${COMMENT_API_ORIGIN}/api/v1/products/${PRODUCT_KEY}/threads/${threadId}/comments/newList`);
  };

  const findApiTemplate = () => {
    const candidates = [];
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        if (typeof entry.name === 'string') candidates.push(entry.name);
      }
    } catch (_) { /* ignore unavailable performance entries */ }
    for (const script of document.querySelectorAll('script[src]')) {
      if (script.src) candidates.push(script.src);
    }
    const source = candidates.find((value) => isAllowedApiUrl(value) && value.includes('/newList'))
      || candidates.find(isAllowedApiUrl);
    return source ? new URL(source) : buildTemplateFromThread();
  };

  const waitForApiTemplate = async (timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // 能自己拼就不用等页面渲染
      const own = buildTemplateFromThread();
      if (own) return own;
      const template = findApiTemplate();
      if (template) return template;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return findApiTemplate();
  };

  const parseJsonp = (text) => {
    const value = String(text || '').trim();
    if (value.startsWith('{')) return JSON.parse(value);
    const open = value.indexOf('(');
    const close = value.lastIndexOf(')');
    if (open < 1 || close <= open) throw new Error('网易评论接口返回的 JSONP 格式无效');
    return JSON.parse(value.slice(open + 1, close));
  };

  const fetchCommentPage = async (template, listType, offset) => {
    const url = new URL(template.toString());
    url.pathname = url.pathname.replace(/\/(?:newList|hotList)$/, `/${listType}`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(COMMENT_PAGE_SIZE));
    url.searchParams.set('showLevelThreshold', '200');
    url.searchParams.set('headLimit', '100');
    url.searchParams.set('tailLimit', '100');
    url.searchParams.set('ibc', 'jssdk');
    url.searchParams.set('callback', `_aiNetease${Date.now()}${offset}`);
    url.searchParams.set('_', String(Date.now()));
    const response = await fetch(url.toString(), {
      credentials: 'include',
      headers: { Accept: 'text/javascript, application/json' },
    });
    if (!response.ok) throw new Error(`网易评论接口返回 HTTP ${response.status}`);
    return parseJsonp(await response.text());
  };

  try {
    const container = document.querySelector('#post_comment_area')
      || document.querySelector('#tieArea')
      || document.querySelector('.tie-areas');
    container?.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch (_) { /* ignore missing comment area */ }
  const template = await waitForApiTemplate();
  if (!template) {
    return {
      platform: 'netease', title, username: matchAccounts.join(','),
      commentCount: null, liked: null, collected: null,
      commentIds: [], commentAuthors: [], accountStatus, portalLoggedIn, commentAuth,
      warning: accountWarning,
      error: commentAuthError || (threadId
        ? '未能构造网易跟帖接口地址'
        : '未能从链接识别网易跟帖编号，评论区可能尚未加载'),
    };
  }

  const seenIds = new Set();
  const matchedIds = [];
  const matchedAuthors = [];
  const matchSet = new Set(matchAccounts.map(clean));
  const countPayload = (payload) => {
    let matched = 0;
    for (const comment of Object.values(payload.comments || {})) {
      if (!comment || comment.del || comment.isDel) continue;
      const id = clean(comment.postId || comment.commentId);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const commentUserId = clean(comment.user?.userId);
      const nickname = clean(comment.user?.nickname);
      const sameUserId = Boolean(detected.userId) && commentUserId === detected.userId && detectedMatchesManual;
      const sameNickname = Boolean(nickname) && matchSet.has(nickname);
      if (sameUserId || sameNickname) {
        matched++;
        matchedIds.push(id);
        if (nickname && !matchedAuthors.includes(nickname)) matchedAuthors.push(nickname);
      }
    }
    return matched;
  };

  const scanList = async (listType) => {
    let offset = 0;
    let matched = 0;
    for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
      const payload = await fetchCommentPage(template, listType, offset);
      const ids = Array.isArray(payload.commentIds) ? payload.commentIds : [];
      matched += countPayload(payload);
      const declaredTotal = Number(listType === 'newList' ? payload.newListSize : payload.hotListSize);
      if (ids.length === 0 || ids.length < COMMENT_PAGE_SIZE) break;
      offset += ids.length;
      if (Number.isFinite(declaredTotal) && offset >= declaredTotal) break;
    }
    return matched;
  };

  try {
    const canMatch = Boolean(matchSet.size || (detected.userId && detectedMatchesManual));
    const commentCount = canMatch ? (await scanList('newList')) + (await scanList('hotList')) : null;
    return {
      platform: 'netease', title,
      username: matchedAuthors[0] || matchAccounts.join(',') || detected.userId,
      commentCount, liked: null, collected: null,
      commentIds: matchedIds, commentAuthors: matchedAuthors,
      accountStatus, portalLoggedIn, commentAuth,
      warning: accountWarning,
      error: canMatch ? '' : (commentAuthError || '未能识别当前网易账号，无法统计本人跟帖'),
    };
  } catch (error) {
    return {
      platform: 'netease', title, username: matchAccounts.join(','),
      commentCount: null, liked: null, collected: null,
      commentIds: matchedIds, commentAuthors: matchedAuthors,
      accountStatus, portalLoggedIn, commentAuth,
      warning: accountWarning,
      error: commentAuthError || `网易评论检测失败：${error.message}`,
    };
  }
}

module.exports = detectNetease;
