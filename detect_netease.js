// 网易 163 评论检测器。
// 该函数会被 page.evaluate 执行，因此必须保持自包含，只依赖浏览器页面全局对象。
async function detectNetease(manual) {
  const COMMENT_API_ORIGIN = 'https://comment.api.163.com';
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
        || document.title.replace(/[_|｜].*网易.*$/i, '').trim()
        || document.title
        || '未知文章';
    } catch (_) {
      return '';
    }
  })();

  const detected = (() => {
    const nickname = clean(
      document.querySelector('#tieArea .tie-input-bar .photo-area .nickname')?.textContent
        || document.querySelector('#tieArea .submit-row .photo-area')?.textContent,
    );
    let userId = '';
    const logoutLink = document.querySelector('#tieArea a[href*="reg.163.com/Logout.jsp"]');
    try {
      const value = logoutLink && new URL(logoutLink.href).searchParams.get('username');
      if (value && /^\d+$/.test(value)) userId = value;
    } catch (_) { /* ignore malformed logout link */ }
    return { nickname, userId };
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

  const isAllowedApiUrl = (value) => {
    try {
      const url = new URL(value);
      return url.origin === COMMENT_API_ORIGIN
        && /\/api\/v1\/products\/[^/]+\/threads\/[^/]+\/comments\/(?:newList|hotList)$/.test(url.pathname);
    } catch (_) {
      return false;
    }
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
    return source ? new URL(source) : null;
  };

  const waitForApiTemplate = async (timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
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
    document.querySelector('#tieArea')?.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch (_) { /* ignore missing comment area */ }
  const template = await waitForApiTemplate();
  if (!template) {
    return {
      platform: 'netease', title, username: matchAccounts.join(','),
      commentCount: null, liked: null, collected: null,
      commentIds: [], commentAuthors: [], accountStatus,
      warning: accountWarning,
      error: '未发现网易评论接口，评论区可能尚未加载',
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
    const commentCount = (matchSet.size || (detected.userId && detectedMatchesManual))
      ? (await scanList('newList')) + (await scanList('hotList'))
      : null;
    return {
      platform: 'netease', title,
      username: matchedAuthors[0] || matchAccounts.join(',') || detected.userId,
      commentCount, liked: null, collected: null,
      commentIds: matchedIds, commentAuthors: matchedAuthors,
      accountStatus, warning: accountWarning,
    };
  } catch (error) {
    return {
      platform: 'netease', title, username: matchAccounts.join(','),
      commentCount: null, liked: null, collected: null,
      commentIds: matchedIds, commentAuthors: matchedAuthors,
      accountStatus, warning: accountWarning, error: `网易评论检测失败：${error.message}`,
    };
  }
}

module.exports = detectNetease;
