// aiComment.js
// 调用 OpenAI 兼容大模型接口，依据文章正文生成一条「提问式」评论（而非吹捧式）。
// 同时兼容两种接口格式：
//   - 'chat'      => /v1/chat/completions
//   - 'responses' => /v1/responses
// Node 18+ 内置 fetch，无需额外依赖。

// 系统提示：决定评论的风格——读完文章后提出真实、有针对性的问题，不夸不复述。
const SYSTEM_PROMPT = [
  '你是一名对文章主题有真实兴趣、并有实际了解/选型需求的读者，读完文章后会产生具体的疑问。',
  '请根据给定的文章正文，写出 1 条中文评论，要求：',
  '1. 不要吹捧、夸奖，也不要复述文章观点；',
  '2. 紧扣文章的具体内容，提出 1 个有针对性的真实问题（可围绕适用场景、实现细节、兼容性、部署成本、落地效果等，但必须由正文内容自然引出）；',
  '3. 语气自然、口语化，像真实读者随手提问，25~60 字；',
  '4. 只输出评论本身，不要加引号、编号或任何额外说明。',
].join('\n');

/**
 * 根据文章正文生成一条提问式评论。
 * @param {string} articleText 文章正文
 * @param {object} cfg 配置
 * @param {'chat'|'responses'|'messages'} [cfg.apiType] 接口格式，默认 'chat'
 * @param {string} cfg.endpoint 完整接口地址，例：https://api.openai.com/v1/chat/completions
 * @param {string} cfg.apiKey   接口密钥
 * @param {string} cfg.model    模型名
 * @param {number} [cfg.maxTokens]    最大输出 token，默认 200
 * @param {number} [cfg.temperature]  采样温度，默认 0.9
 * @param {number} [cfg.maxInputChars] 正文最大输入字符数，默认 3000（超出截断）
 * @returns {Promise<string>} 生成的评论文本
 */
async function generateQuestionComment(articleText, cfg = {}) {
  const {
    apiType = 'chat',
    endpoint,
    apiKey,
    model,
    maxTokens = 200,
    temperature = 0.9,
    timeout = 60,
    maxInputChars = 3000,
  } = cfg;

  if (!endpoint || !apiKey || !model) {
    throw new Error('请先在配置中填写 endpoint / apiKey / model');
  }

  // 正文过长时截断，避免超出上下文并控制成本
  const content = String(articleText || '').slice(0, maxInputChars).trim();
  if (!content) throw new Error('文章正文为空，无法生成评论');

  const userPrompt = `文章正文如下：\n"""\n${content}\n"""\n\n请按要求写 1 条提问式评论。`;

  const timeoutMs = Math.max(1, Number(timeout) || 60) * 1000;
  const payload = { endpoint, apiKey, model, maxTokens, temperature, userPrompt, timeoutMs };
  let text;
  if (apiType === 'messages') {
    text = await callMessages(payload);        // Anthropic /v1/messages
  } else if (apiType === 'responses') {
    text = await callResponses(payload);       // OpenAI /v1/responses
  } else {
    text = await callChatCompletions(payload); // OpenAI /v1/chat/completions
  }

  return cleanComment(text);
}

// ---- /v1/chat/completions 格式 ----
async function callChatCompletions({ endpoint, apiKey, model, maxTokens, temperature, userPrompt, timeoutMs }) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  }, timeoutMs);
  const data = await readJsonOrThrow(res);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('接口未返回评论内容：' + JSON.stringify(data).slice(0, 500));
  return text;
}

// ---- /v1/responses 格式 ----
async function callResponses({ endpoint, apiKey, model, maxTokens, temperature, userPrompt, timeoutMs }) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: userPrompt,
      max_output_tokens: maxTokens,
      temperature,
    }),
  }, timeoutMs);
  const data = await readJsonOrThrow(res);
  const text = extractResponsesText(data);
  if (!text) throw new Error('接口未返回评论内容：' + JSON.stringify(data).slice(0, 500));
  return text;
}

// 解析 responses 接口的多种返回结构
function extractResponsesText(data) {
  // 1) SDK 便捷字段
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  // 2) 标准结构 output[].content[].text
  if (Array.isArray(data?.output)) {
    const parts = [];
    for (const item of data.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === 'string') parts.push(c.text);
          else if (typeof c?.text?.value === 'string') parts.push(c.text.value);
        }
      }
    }
    if (parts.length) return parts.join('');
  }
  // 3) 有些代理把 responses 也包成 chat 格式
  if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  return '';
}

// ---- Anthropic /v1/messages 格式（Claude 模型 / Claude Code 代理）----
async function callMessages({ endpoint, apiKey, model, maxTokens, userPrompt, timeoutMs }) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    // 注意：claude-opus-4-8 等模型不接受 temperature / top_p，带上会 400
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  }, timeoutMs);
  const data = await readJsonOrThrow(res);
  const text = extractMessagesText(data);
  if (!text) throw new Error('接口未返回评论内容：' + JSON.stringify(data).slice(0, 500));
  return text;
}

// 解析 Anthropic messages 返回：content 是块数组，取 type==='text' 的 text 拼接
function extractMessagesText(data) {
  if (Array.isArray(data?.content)) {
    const textParts = data.content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text);

    if (textParts.length > 0) {
      return textParts.join('');
    }

    // 如果只有 thinking 块没有 text 块，说明模型配置有问题（某些模型需要禁用 thinking）
    const hasThinking = data.content.some(b => b && b.type === 'thinking');
    if (hasThinking) {
      throw new Error('模型返回了 thinking 块但没有 text 块，请在 API 配置中添加参数禁用 thinking 或换用其他模型');
    }
  }

  return '';
}

// 带超时的 fetch：超时转成可读错误（默认超时来自配置的「请求超时（秒）」）
async function fetchWithTimeout(url, options, timeoutMs) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 60000;
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`请求超时（${Math.round(ms / 1000)} 秒未响应）`);
    }
    throw e;
  }
}

/**
 * 轻量连通性探测：用当前配置发一次最小请求，只关心「通不通 / 多快 / 状态码」。
 * 不解析业务内容；401/403 等会以 ok:false + detail 返回，由调用方决定怎么展示。
 */
async function probeConnection(cfg = {}) {
  const { apiType = 'chat', endpoint, apiKey, model, timeout = 20 } = cfg;
  if (!endpoint) throw new Error('未配置 API Endpoint');
  if (!apiKey) throw new Error('未配置 API Key');
  if (!model) throw new Error('未配置模型标识符');
  const timeoutMs = Math.max(1, Number(timeout) || 20) * 1000;

  const started = Date.now();
  let res;
  if (apiType === 'messages') {
    res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    }, timeoutMs);
  } else if (apiType === 'responses') {
    res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: 'ping', max_output_tokens: 16 }),
    }, timeoutMs);
  } else {
    res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    }, timeoutMs);
  }
  const latencyMs = Date.now() - started;
  const raw = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, latencyMs, apiType, model, detail: raw.slice(0, 400) };
}

async function readJsonOrThrow(res) {
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`接口返回 ${res.status} ${res.statusText}：${errText.slice(0, 500)}`);
  }
  return res.json();
}

// 清理模型偶尔多加的引号/前后空白
function cleanComment(text) {
  return String(text).trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
}

/**
 * 从 Playwright 页面中提取文章正文（供后续集成进评论脚本使用）。
 * 依次尝试常见正文容器，取到足够长的文本即返回，兜底用整页 body。
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function extractArticleText(page) {
  const selectors = [
    '.Post-RichText',   // 知乎专栏
    'article',          // 通用文章标签 / 头条
    '#content_views',   // CSDN 正文
    '.RichText',
    'main',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      const text = (await el.innerText().catch(() => '')).trim();
      if (text.length > 50) return text;
    }
  }
  return (await page.locator('body').innerText().catch(() => '')).trim();
}

module.exports = { generateQuestionComment, extractArticleText, probeConnection, SYSTEM_PROMPT };
