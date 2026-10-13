const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { fork, execFile } = require('child_process');
const logger = require('./logger'); // 统一日志：控制台 + 落盘到 logs/ 目录
const { probeConnection } = require('./aiComment'); // 连通性探测（与评论脚本同一套协议实现）

// 可写工作目录：打包后由主进程透传 APP_USER_DATA（用户数据目录）；开发模式兜底用 __dirname
const WORK_DIR = process.env.APP_USER_DATA ? path.join(process.env.APP_USER_DATA, 'runtime') : __dirname;
const CONFIG_DIR = process.env.APP_USER_DATA ? path.join(process.env.APP_USER_DATA, 'config') : __dirname;
// 留痕截图按要求放在安装目录；开发模式使用项目根目录。
const INSTALL_DIR = process.env.APP_INSTALL_DIR
  || (process.env.APP_USER_DATA ? path.dirname(process.execPath) : __dirname);
const SCREENSHOT_ROOT = path.join(INSTALL_DIR, '留痕截图');
// 是否由 Electron 主进程启动（main.js 会注入 APP_USER_DATA）。纯 node server.js 浏览器模式不启动资源管理器。
const IS_ELECTRON = !!process.env.APP_USER_DATA;
fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });
// 预创建留痕根目录，保证「打开留痕目录」入口始终可用
fs.mkdirSync(SCREENSHOT_ROOT, { recursive: true });
// 可写的 aiConfig.js 路径（打包后 __dirname 在只读 asar 内，配置必须写到用户目录）
const aiConfigPath = path.join(CONFIG_DIR, 'aiConfig.js');
// 检测账号配置（手填用户名，优先于页面自动识别），写到用户目录
const detectAccountsPath = path.join(CONFIG_DIR, 'detectAccounts.json');
// 首次运行：从包内只读的种子 aiConfig.js 复制到可写位置
if (process.env.APP_USER_DATA && !fs.existsSync(aiConfigPath)) {
  try { fs.copyFileSync(path.join(__dirname, 'aiConfig.js'), aiConfigPath); } catch (e) { /* 种子缺失忽略，首次保存会创建 */ }
}

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====================== 平台映射 ======================
const SCRIPT_MAP = {
  zhihu: 'pinglun_zhihu.js',
  toutiao: 'pinglun_toutiao.js',
  csdn: 'pinglun_csdn.js',
  sohu: 'pinglun_sohu.js',
  baidu: 'pinglun_baidu.js',
  netease: 'pinglun_netease.js'
};
const URL_LIST_NAMES = {
  zhihu: 'zhihuUrlList',
  toutiao: 'toutiaoUrlList',
  csdn: 'csdnUrlList',
  sohu: 'sohuUrlList',
  baidu: 'baiduUrlList',
  netease: 'neteaseUrlList'
};
// 一键运行的串行顺序
const PLATFORM_ORDER = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];
// 参与检测的平台（搜狐使用页面 DOM 检测）
const DETECT_PLATFORMS = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];

// 存储运行中的「单平台任务」runner；一键运行用 allRunner；独立检测用 detectRunner；补跑用 fixRunner
const runningProcesses = new Map();
let allRunner = null;
let detectRunner = null; // 独立检测（批量 / 单链接复检）同一时刻只允许一个
let fixRunner = null;    // 补跑不达标项（给不达标文章再跑一遍评论+点赞+收藏）

// 是否有任意任务在跑（全局串行序列 或 任一单平台评论）
function anyTaskRunning() {
  return !!allRunner || !!detectRunner || !!fixRunner || runningProcesses.size > 0;
}
// 是否有全局串行序列在跑（一键运行 / 一键检测 / 补跑）
function globalSequenceRunning() {
  return !!allRunner || !!detectRunner || !!fixRunner;
}

// ====================== runner / fork 工具 ======================
// runner 统一管理一个流程（单平台 = 评论→检测；一键 = 评论全部→检测全部），
// 持有当前子进程引用，支持取消（kill 当前子进程 + 置取消标志，序列里逐步退出）。
function createRunner() {
  const runner = { currentChild: null, cancelled: false, paused: false };
  runner.cancel = () => {
    runner.cancelled = true;
    if (runner.currentChild && runner.currentChild.connected) {
      try { runner.currentChild.send({ cmd: 'cancel' }); } catch (e) { /* ignore */ }
      // 等 3 秒让子进程发送已完成的结果，再强杀
      setTimeout(() => {
        if (runner.currentChild) {
          try { runner.currentChild.kill(); } catch (e) { /* ignore */ }
        }
      }, 3000);
    } else if (runner.currentChild) {
      try { runner.currentChild.kill(); } catch (e) { /* ignore */ }
    }
  };
  // 暂停/继续：通过 ipc 给评论脚本发消息，脚本在下一个检查点阻塞/放行（不重启、不丢进度）
  runner.pause = () => {
    const c = runner.currentChild;
    if (c && typeof c.send === 'function' && c.connected) {
      runner.paused = true;
      try { c.send({ cmd: 'pause' }); } catch (e) { /* ignore */ }
    }
  };
  runner.resume = () => {
    const c = runner.currentChild;
    if (c && typeof c.send === 'function' && c.connected) {
      runner.paused = false;
      try { c.send({ cmd: 'resume' }); } catch (e) { /* ignore */ }
    }
  };
  return runner;
}

// 当前正在跑的 runner（各 runner 互斥，至多一个）。用于暂停/继续定位目标。
function activeRunner() {
  return allRunner || detectRunner || fixRunner || (runningProcesses.size ? [...runningProcesses.values()][0] : null);
}

// fork 一个脚本，行缓冲 stdout/stderr（按行回调 onLog，避免半行被拆散），
// 返回 { child, done }：child 供 runner 记录以便 kill，done 为退出码 Promise。
function forkScript(scriptPath, opts, onLog) {
  const child = fork(scriptPath, [], {
    execPath: process.execPath,
    cwd: opts.cwd,
    // NODE_PATH 让 WORK_DIR 下的临时脚本能 require 到 app/node_modules 的 patchright
    env: { ...process.env, ...opts.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(__dirname, 'node_modules') },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });

  const splitLines = (chunk, type, state) => {
    state.buf += chunk.toString();
    let idx;
    while ((idx = state.buf.indexOf('\n')) >= 0) {
      const line = state.buf.slice(0, idx).replace(/\r$/, '');
      state.buf = state.buf.slice(idx + 1);
      if (line.length) onLog(line, type);
    }
  };
  const outState = { buf: '' };
  const errState = { buf: '' };
  child.stdout.on('data', (d) => splitLines(d, 'info', outState));
  child.stderr.on('data', (d) => splitLines(d, 'error', errState));

  const done = new Promise((resolve) => {
    child.on('close', (code) => {
      // flush 末尾不带换行的残余行
      if (outState.buf.trim()) onLog(outState.buf, 'info');
      if (errState.buf.trim()) onLog(errState.buf, 'error');
      resolve(code);
    });
  });

  return { child, done };
}

function copyToWorkDir(sourcePath, targetName) {
  const targetPath = path.join(WORK_DIR, targetName || path.basename(sourcePath));
  if (path.resolve(sourcePath) !== path.resolve(targetPath)) fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

// ====================== 评论阶段 ======================
// 生成临时脚本（注入 URL 列表 / 评论数 / 用户数据目录），fork 执行并等待结束。
async function runCommentPhase(runner, platform, urls, commentCount) {
  const scriptFile = SCRIPT_MAP[platform];
  const originalScriptPath = path.join(__dirname, scriptFile);
  let scriptContent = fs.readFileSync(originalScriptPath, 'utf-8');

  // 替换 URL 列表
  const urlListName = URL_LIST_NAMES[platform];
  const urlsJson = JSON.stringify(urls, null, 4);
  scriptContent = scriptContent.replace(
    new RegExp(`const ${urlListName} = \\[[\\s\\S]*?\\];`),
    `const ${urlListName} = ${urlsJson};`
  );
  // 替换评论数
  scriptContent = scriptContent.replace(/const perUrlCommentCount = \d+;/, `const perUrlCommentCount = ${commentCount};`);
  // 替换浏览器 profile 目录（脚本里硬编码了 D:\playwright\pw-data-*，打包后该路径不存在）
  const pwDir = path.join(WORK_DIR, 'pw-data-' + platform).replace(/\\/g, '\\\\');
  scriptContent = scriptContent.replace(/const userDataPath = '[^']*';/, `const userDataPath = '${pwDir}';`);

  const tempScriptPath = path.join(WORK_DIR, `temp_${platform}_${Date.now()}.js`);
  fs.writeFileSync(tempScriptPath, scriptContent);

  // 复制依赖到临时目录
  copyToWorkDir(path.join(__dirname, 'aiComment.js'));
  copyToWorkDir(aiConfigPath, 'aiConfig.js');
  copyToWorkDir(path.join(__dirname, 'pauser.js'));
  if (platform === 'netease') {
    copyToWorkDir(path.join(__dirname, 'detect.js'));
    copyToWorkDir(path.join(__dirname, 'detect_netease.js'));
  }

  logger.info(`[${platform}] 评论阶段启动：${urls.length} 篇文章，每篇 ${commentCount} 条评论`);
  io.emit('log', { platform, log: `===== 评论阶段：${urls.length} 篇，每篇 ${commentCount} 条 =====`, type: 'info' });

  const { child, done } = forkScript(tempScriptPath, { cwd: WORK_DIR }, (line, type) => {
    logger.child(platform, line, type);
    io.emit('log', { platform, log: line, type });
  });
  runner.currentChild = child;
  const code = await done;
  runner.currentChild = null;

  try { fs.unlinkSync(tempScriptPath); } catch (e) { /* ignore */ }
  logger[code === 0 ? 'info' : 'error'](`[${platform}] 评论阶段结束，退出码: ${code}`);
  return code;
}

// ====================== 检测阶段 ======================
// 复制 detect 模块到 WORK_DIR，fork detect_runner（env 传参），等待结束并收集结果标记。
async function runDetectPhase(runner, platform, urls, options = {}) {
  copyToWorkDir(path.join(__dirname, 'detect.js'));
  copyToWorkDir(path.join(__dirname, 'detect_netease.js'));
  copyToWorkDir(path.join(__dirname, 'detect_runner.js'));
  copyToWorkDir(path.join(__dirname, 'evidence.js'));
  copyToWorkDir(path.join(__dirname, 'pauser.js'));

  const detectScript = path.join(WORK_DIR, 'detect_runner.js');
  const userDataPath = path.join(WORK_DIR, 'pw-data-' + platform);
  // 读取手填检测账号，传给 detect_runner（手填优先于页面自动识别）
  let accounts = {};
  try { accounts = JSON.parse(fs.readFileSync(detectAccountsPath, 'utf-8') || '{}'); } catch (e) { /* ignore */ }
  const env = {
    PLATFORM: platform,
    URLS: JSON.stringify(urls),
    USER_DATA_PATH: userDataPath,
    ACCOUNTS: JSON.stringify(accounts),
    SCREENSHOT_ROOT,
    FORCE_EVIDENCE: options.forceEvidence ? '1' : '0',
  };

  logger.info(`[${platform}] 检测阶段启动：${urls.length} 篇文章`);
  io.emit('log', { platform, log: `===== 检测阶段：回查评论数 / 点赞 / 收藏 =====`, type: 'info' });

  let results = [];
  const MARKER = '@@DETECT_RESULT@@';
  const { child, done } = forkScript(detectScript, { cwd: WORK_DIR, env }, (line, type) => {
    logger.child(platform, line, type);
    io.emit('log', { platform, log: line, type });
    // 捕获结构化结果标记
    if (line.startsWith(MARKER)) {
      try {
        const parsed = JSON.parse(line.slice(MARKER.length));
        results = parsed.results || [];
      } catch (e) { /* ignore */ }
    }
  });
  runner.currentChild = child;
  const code = await done;
  runner.currentChild = null;

  logger.info(`[${platform}] 检测阶段结束，退出码: ${code}`);
  return results;
}

// ====================== 序列编排 ======================
// 单平台：评论 →（可选）检测
function startPlatformSequence(platform, urls, commentCount, enableDetection) {
  const runner = createRunner();
  runningProcesses.set(platform, runner);
  io.emit('status', { platform, status: 'running' });

  (async () => {
    try {
      await runCommentPhase(runner, platform, urls, commentCount);
      if (runner.cancelled) return;
      if (enableDetection) {
        if (DETECT_PLATFORMS.includes(platform)) {
          await runDetectPhase(runner, platform, urls);
        } else {
          io.emit('log', { platform, log: '该平台暂不参与检测，跳过检测阶段', type: 'info' });
        }
      }
    } catch (e) {
      logger.error(`[${platform}] 流程异常: ${e.message}`);
      io.emit('log', { platform, log: '流程异常：' + e.message, type: 'error' });
    } finally {
      runningProcesses.delete(platform);
      io.emit('status', { platform, status: 'idle' });
    }
  })();
}

// 一键运行：评论全部（串行）→ 检测全部（串行）
function startAllSequence(tasks, commentCount, enableDetection) {
  allRunner = createRunner();
  io.emit('status', { platform: 'all', status: 'running' });
  const total = tasks.length;

  (async () => {
    try {
      // ---- 评论阶段：逐平台串行 ----
      let i = 0;
      for (const t of tasks) {
        if (allRunner.cancelled) break;
        i++;
        io.emit('all-progress', { phase: 'comment', platform: t.platform, status: 'running', index: i, total });
        await runCommentPhase(allRunner, t.platform, t.urls, commentCount);
        io.emit('all-progress', { phase: 'comment', platform: t.platform, status: 'done', index: i, total });
      }

      // ---- 检测阶段：逐平台串行 ----
      if (enableDetection && !allRunner.cancelled) {
        const detectTasks = tasks.filter((t) => DETECT_PLATFORMS.includes(t.platform));
        const dtotal = detectTasks.length;
        let j = 0;
        for (const t of detectTasks) {
          if (allRunner.cancelled) break;
          j++;
          io.emit('all-progress', { phase: 'detect', platform: t.platform, status: 'running', index: j, total: dtotal });
          const results = await runDetectPhase(allRunner, t.platform, t.urls);
          io.emit('detection', { platform: t.platform, results });
          io.emit('all-progress', { phase: 'detect', platform: t.platform, status: 'done', index: j, total: dtotal });
        }
      }
    } catch (e) {
      logger.error(`[all] 一键运行异常: ${e.message}`);
      io.emit('log', { platform: 'all', log: '一键运行异常：' + e.message, type: 'error' });
    } finally {
      allRunner = null;
      io.emit('all-done', {});
      io.emit('status', { platform: 'all', status: 'idle' });
    }
  })();
}

// 独立检测：批量（一键检测）。tasks=[{platform,urls}]，按平台串行检测。
// merge=true 时结果按 url 合并（重测未达标项用，前端保留已达标行）。
function startDetectSequence(tasks, merge) {
  detectRunner = createRunner();
  io.emit('status', { platform: 'detect', status: 'running' });

  const valid = tasks.filter((t) => DETECT_PLATFORMS.includes(t.platform));
  const dtotal = valid.length;
  logger.info(`[detect] 一键检测启动：${dtotal} 个平台（merge=${!!merge}）`);
  io.emit('log', { platform: 'detect', log: `===== ${merge ? '重测未达标项' : '一键检测'}：${dtotal} 个平台 =====`, type: 'info' });

  (async () => {
    try {
      let j = 0;
      for (const t of valid) {
        if (detectRunner.cancelled) break;
        j++;
        io.emit('detect-progress', { platform: t.platform, status: 'running', index: j, total: dtotal });
        const results = await runDetectPhase(detectRunner, t.platform, t.urls);
        io.emit('detection', { platform: t.platform, results, merge: !!merge });
        io.emit('detect-progress', { platform: t.platform, status: 'done', index: j, total: dtotal });
      }
    } catch (e) {
      logger.error(`[detect] 一键检测异常: ${e.message}`);
      io.emit('log', { platform: 'detect', log: '一键检测异常：' + e.message, type: 'error' });
    } finally {
      detectRunner = null;
      io.emit('detect-done', {});
      io.emit('status', { platform: 'detect', status: 'idle' });
    }
  })();
}

// 补跑不达标项：给不达标文章再跑一遍评论+点赞+收藏。tasks=[{platform,urls,count}]，按任务串行。
// 复用 runCommentPhase（即各 pinglun_*.js），count=该批补发评论数（0 则只补赞/藏）。
function startFixSequence(tasks) {
  fixRunner = createRunner();
  io.emit('status', { platform: 'detect', status: 'running' });
  const total = tasks.length;
  logger.info(`[fix] 补跑不达标项：${total} 个任务`);
  io.emit('log', { platform: 'detect', log: `===== 补跑不达标项：${total} 个任务（每篇最多 2 次）=====`, type: 'info' });

  (async () => {
    try {
      let i = 0;
      for (const t of tasks) {
        if (fixRunner.cancelled) break;
        i++;
        io.emit('fix-progress', { platform: t.platform, count: t.count, status: 'running', index: i, total });
        await runCommentPhase(fixRunner, t.platform, t.urls, t.count);
        io.emit('fix-progress', { platform: t.platform, count: t.count, status: 'done', index: i, total });
      }
    } catch (e) {
      logger.error(`[fix] 补跑异常: ${e.message}`);
      io.emit('log', { platform: 'detect', log: '补跑异常：' + e.message, type: 'error' });
    } finally {
      fixRunner = null;
      io.emit('fix-done', {});
      io.emit('status', { platform: 'detect', status: 'idle' });
    }
  })();
}

// 独立检测：单链接复检（结果表里的「重新检测」按钮）。
// 复用同一 detectRunner 锁，保证同一时刻只有一个检测在跑。
function startDetectSingle(platform, url, forceEvidence) {
  detectRunner = createRunner();
  logger.info(`[detect] 重新检测 ${platform}：${url}`);
  (async () => {
    let result;
    try {
      const results = await runDetectPhase(detectRunner, platform, [url], { forceEvidence: !!forceEvidence });
      result = results[0] || { url, commentCount: null, liked: null, collected: null, error: '未获取到结果' };
    } catch (e) {
      result = { url, commentCount: null, liked: null, collected: null, error: e.message };
    } finally {
      detectRunner = null;
    }
    io.emit('detection-row', { platform, result });
  })();
}

// ====================== 配置接口 ======================
// 解析当前 aiConfig.js（优先双引号，兼容单引号旧文件）
function readAiConfig() {
  const content = fs.readFileSync(aiConfigPath, 'utf-8');
  const pick = (key) => {
    const d = content.match(new RegExp(key + ':\\s*"([^"]*)"'));
    if (d) return d[1];
    const s = content.match(new RegExp(key + ":\\s*'([^']*)'"));
    return s ? s[1] : '';
  };
  const num = (key, fallback) => {
    const m = content.match(new RegExp(key + ':\\s*([\\d.]+)'));
    return m ? Number(m[1]) : fallback;
  };
  return {
    apiType: pick('apiType') || 'messages',
    endpoint: pick('endpoint'),
    apiKey: pick('apiKey'),
    model: pick('model'),
    maxTokens: num('maxTokens', 4096),
    temperature: num('temperature', 0.7),
    timeout: num('timeout', 60)
  };
}

// 密钥掩码：只暴露头尾，用于回显「已配置」，不泄露明文
function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 10) return '•'.repeat(k.length);
  return k.slice(0, 6) + '••••••' + k.slice(-4);
}

// 获取 AI 配置（不返回明文密钥，只返回掩码与是否已配置）
app.get('/api/config', (req, res) => {
  try {
    const c = readAiConfig();
    res.json({
      success: true,
      config: {
        apiType: c.apiType,
        endpoint: c.endpoint,
        model: c.model,
        maxTokens: c.maxTokens,
        temperature: c.temperature,
        timeout: c.timeout,
        apiKey: '',
        hasApiKey: !!c.apiKey,
        apiKeyMask: maskKey(c.apiKey)
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 保存 AI 配置
// 约定：apiKey 字段缺省/未发送 => 保持原密钥不变（前端未改动时不提交该字段）；
//       显式发送字符串（含空串）=> 覆盖（空串表示清空）。
app.post('/api/config', (req, res) => {
  try {
    const { apiType, endpoint, model } = req.body;
    // 用 JSON.stringify 生成合法 JS 字符串字面量，避免密钥含引号/反斜杠时写坏配置文件
    const q = (v) => JSON.stringify(String(v == null ? '' : v));
    const mt = Math.max(1, Math.min(200000, Number(req.body.maxTokens) || 4096));
    const tpRaw = Number(req.body.temperature);
    const tp = Math.max(0, Math.min(2, Number.isFinite(tpRaw) ? tpRaw : 0.7));
    const toRaw = Number(req.body.timeout);
    const to = Math.max(5, Math.min(600, Number.isFinite(toRaw) ? toRaw : 60));

    let apiKey = req.body.apiKey;
    if (apiKey === undefined || apiKey === null) {
      try { apiKey = readAiConfig().apiKey; } catch (e) { apiKey = ''; }
    }

    const configContent = `// aiConfig.js
// AI 接口共用配置：测试脚本和各评论脚本都从这里读取，改一处即可全局生效。
module.exports = {
  // 接口格式：'chat' => /v1/chat/completions ；'responses' => /responses ；'messages' => /v1/messages（Claude）
  apiType: ${q(apiType)},
  // 完整接口地址
  endpoint: ${q(endpoint)},
  // 接口密钥
  apiKey: ${q(apiKey)},
  // 模型名
  model: ${q(model)},
  // 单次生成最大输出 token（评论脚本读取）
  maxTokens: ${mt},
  // 采样温度（Anthropic Messages 协议下部分模型会忽略）
  temperature: ${tp},
  // 单次请求超时（秒）
  timeout: ${to},
};
`;

    fs.writeFileSync(aiConfigPath, configContent);
    logger.info(`AI 配置已保存（接口类型: ${apiType}，模型: ${model}，maxTokens: ${mt}，temperature: ${tp}，timeout: ${to}，密钥: ${apiKey ? maskKey(apiKey) : '（空）'}）`);
    res.json({ success: true, message: '配置已保存并生效', apiKeyMask: maskKey(apiKey), hasApiKey: !!apiKey });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 测试 AI 连接：用已保存的配置发一次最小真实请求，返回延迟与状态码
app.post('/api/test-connection', async (req, res) => {
  let cfg;
  try {
    cfg = readAiConfig();
  } catch (error) {
    return res.json({ success: false, error: '读取配置失败：' + error.message });
  }
  if (!cfg.endpoint || !cfg.apiKey || !cfg.model) {
    return res.json({ success: false, error: '请先填写并保存 API Endpoint / API Key / 模型标识符' });
  }

  try {
    const r = await probeConnection({
      apiType: cfg.apiType,
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      timeout: Math.min(cfg.timeout || 60, 30),
    });
    logger.info(`[test-connection] HTTP ${r.status} · ${r.latencyMs}ms · ${r.apiType}/${r.model}`);
    res.json({
      success: true,
      ok: r.ok,
      status: r.status,
      latencyMs: r.latencyMs,
      apiType: r.apiType,
      model: r.model,
      detail: r.detail,
      message: r.ok
        ? `接口正常（HTTP ${r.status} · ${r.latencyMs}ms · ${r.model}）`
        : `接口返回 HTTP ${r.status}，请检查密钥、模型名或端点`,
    });
  } catch (error) {
    logger.error(`[test-connection] 失败：${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// ====================== 检测账号配置（手填用户名，优先于自动识别）======================
app.get('/api/detect-accounts', (req, res) => {
  let accounts = {};
  try { accounts = JSON.parse(fs.readFileSync(detectAccountsPath, 'utf-8') || '{}'); } catch (e) { /* ignore */ }
  res.json({ success: true, accounts: { zhihu: '', toutiao: '', csdn: '', sohu: '', baidu: '', netease: '', ...accounts } });
});

app.post('/api/detect-accounts', (req, res) => {
  try {
    const incoming = req.body && req.body.accounts ? req.body.accounts : {};
    const clean = {};
    ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].forEach((p) => {
      clean[p] = String(incoming[p] || '').trim();
    });
    fs.writeFileSync(detectAccountsPath, JSON.stringify(clean, null, 2));
    logger.info(`检测账号配置已保存：${['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].filter((p) => clean[p]).map((p) => p + '=' + clean[p]).join('、') || '（全部清空）'}`);
    res.json({ success: true, message: '账号设置已保存，后续检测按手填账号统计' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ====================== 任务接口 ======================
// 启动单平台任务（评论 → 可选检测）
app.post('/api/start', (req, res) => {
  const { platform, urls, commentCount, enableDetection = true } = req.body;

  if (!platform || !urls || urls.length === 0) {
    return res.json({ success: false, error: '参数不完整' });
  }
  if (runningProcesses.has(platform)) {
    return res.json({ success: false, error: '该平台任务已在运行中' });
  }
  if (globalSequenceRunning()) {
    return res.json({ success: false, error: '有批量任务（一键运行/检测/补跑）进行中，请先停止' });
  }

  startPlatformSequence(platform, urls, commentCount, enableDetection);
  res.json({ success: true, message: '任务已启动' });
});

// 停止单平台任务
app.post('/api/stop', (req, res) => {
  const { platform } = req.body;
  const runner = runningProcesses.get(platform);
  if (!runner) {
    return res.json({ success: false, error: '该平台没有运行中的任务' });
  }
  runner.cancel();
  logger.info(`[${platform}] 任务已被用户手动停止`);
  io.emit('log', { platform, log: '任务已被用户手动停止', type: 'info' });
  res.json({ success: true, message: '任务已停止' });
});

// 暂停当前评论任务（不重启、不丢进度；评论脚本在下一篇/下一条评论前阻塞）
app.post('/api/pause', (req, res) => {
  const runner = activeRunner();
  if (!runner) return res.json({ success: false, error: '没有运行中的任务' });
  runner.pause();
  logger.info('[pause] 已暂停');
  res.json({ success: true, message: '已暂停' });
});

// 继续当前评论任务（从暂停处继续）
app.post('/api/resume', (req, res) => {
  const runner = activeRunner();
  if (!runner) return res.json({ success: false, error: '没有暂停的任务' });
  runner.resume();
  logger.info('[resume] 已继续');
  res.json({ success: true, message: '已继续' });
});

// 一键运行（全部平台串行：评论全部 → 检测全部）
app.post('/api/start-all', (req, res) => {
  const { tasks, commentCount, enableDetection = true } = req.body;
  // tasks: [{ platform, urls }]
  const valid = (tasks || [])
    .filter((t) => t && t.platform && Array.isArray(t.urls) && t.urls.length > 0)
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

  if (valid.length === 0) {
    return res.json({ success: false, error: '没有可运行的平台，请先在各平台填入文章链接' });
  }
  if (anyTaskRunning()) {
    return res.json({ success: false, error: '有任务正在运行，请先停止' });
  }

  startAllSequence(valid, commentCount, enableDetection);
  res.json({ success: true, message: `一键运行已启动：${valid.map((t) => t.platform).join('、')}` });
});

// 停止一键运行
app.post('/api/stop-all', (req, res) => {
  if (!allRunner) {
    return res.json({ success: false, error: '没有进行中的一键运行' });
  }
  allRunner.cancel();
  logger.info('[all] 一键运行已被用户手动停止');
  io.emit('log', { platform: 'all', log: '一键运行已被用户手动停止', type: 'info' });
  res.json({ success: true, message: '已发送停止指令，正在收尾…' });
});

// 一键检测（独立检测，与评论流程互斥）。tasks=[{platform,urls}]，merge=true 时按 url 合并结果（重测未达标项用，保留已达标行）
app.post('/api/detect', (req, res) => {
  const { tasks, merge = false } = req.body;
  const valid = (tasks || [])
    .filter((t) => t && t.platform && Array.isArray(t.urls) && t.urls.length > 0)
    .map((t) => ({ platform: t.platform, urls: t.urls }))
    .filter((t) => DETECT_PLATFORMS.includes(t.platform));

  if (valid.length === 0) {
    return res.json({ success: false, error: '没有可检测的有效链接（仅支持知乎/头条/CSDN/搜狐/百度/网易）' });
  }
  if (anyTaskRunning()) {
    return res.json({ success: false, error: '有任务正在运行，请先停止' });
  }

  startDetectSequence(valid, merge);
  res.json({ success: true, message: `一键检测已启动：${valid.map((t) => t.platform).join('、')}` });
});

// 停止一键检测
app.post('/api/detect-stop', (req, res) => {
  if (!detectRunner) {
    return res.json({ success: false, error: '没有进行中的一键检测' });
  }
  detectRunner.cancel();
  logger.info('[detect] 一键检测已被用户手动停止');
  io.emit('log', { platform: 'detect', log: '一键检测已被用户手动停止', type: 'info' });
  res.json({ success: true, message: '已发送停止指令，正在收尾…' });
});

// 单链接重新检测（结果表里的「重新检测」按钮）
app.post('/api/detect-single', (req, res) => {
  const { platform, url, forceEvidence = false } = req.body;
  if (!platform || !url) {
    return res.json({ success: false, error: '缺少平台或链接' });
  }
  if (!DETECT_PLATFORMS.includes(platform)) {
    return res.json({ success: false, error: '该平台暂不支持检测' });
  }
  if (globalSequenceRunning()) {
    return res.json({ success: false, error: '有批量任务进行中，请稍后再试' });
  }
  if (runningProcesses.has(platform)) {
    return res.json({ success: false, error: '该平台评论任务进行中，请先停止' });
  }

  startDetectSingle(platform, url, forceEvidence);
  res.json({ success: true, message: forceEvidence ? '已开始重新检测并重新留痕' : '已开始重新检测' });
});

// 打开留痕目录（仅允许打开留痕截图根目录及其子目录，避免把服务端变成任意路径启动器）。
// Electron 模式：用资源管理器打开并返回路径；纯浏览器模式：只返回完整路径，不启动资源管理器。
app.post('/api/evidence/open', (req, res) => {
  const requested = req.body && req.body.dir ? String(req.body.dir) : SCREENSHOT_ROOT;
  const root = path.resolve(SCREENSHOT_ROOT);
  const target = path.resolve(requested);
  const inside = target === root || target.startsWith(root + path.sep);
  if (!inside) return res.json({ success: false, error: '目录不在留痕截图范围内' });
  if (!fs.existsSync(target)) return res.json({ success: false, error: '目录尚未创建：' + target });
  if (!IS_ELECTRON) return res.json({ success: true, path: target, browserMode: true });
  if (process.platform !== 'win32') {
    return res.json({ success: false, error: '当前系统不支持自动打开资源管理器，请手动打开：' + target });
  }
  execFile('explorer.exe', [target], (error) => {
    if (error) return res.json({ success: false, error: '打开目录失败：' + error.message });
    res.json({ success: true, path: target });
  });
});

// 留痕截图根目录（供纯浏览器模式展示完整路径）
app.get('/api/evidence/root', (req, res) => {
  res.json({ success: true, path: SCREENSHOT_ROOT });
});

// 补跑不达标项（给不达标文章再跑一遍评论+点赞+收藏）。tasks=[{platform,urls,count}]
// count = 该批文章要补发的评论数（按缺口 3-当前评论数 算，已≥3 则 count=0 只补赞/藏）。
app.post('/api/fix', (req, res) => {
  const { tasks } = req.body;
  const valid = (tasks || [])
    .filter((t) => t && t.platform && Array.isArray(t.urls) && t.urls.length > 0)
    .map((t) => ({
      platform: t.platform,
      urls: t.urls,
      count: Math.max(0, Math.min(3, Number(t.count) || 0))
    }))
    .filter((t) => DETECT_PLATFORMS.includes(t.platform));

  if (valid.length === 0) {
    return res.json({ success: false, error: '没有需要补跑的不达标文章' });
  }
  if (anyTaskRunning()) {
    return res.json({ success: false, error: '有任务正在运行，请先停止' });
  }

  startFixSequence(valid);
  res.json({ success: true, message: `补跑已启动：${valid.length} 个任务` });
});

// 停止补跑
app.post('/api/fix-stop', (req, res) => {
  if (!fixRunner) {
    return res.json({ success: false, error: '没有进行中的补跑' });
  }
  fixRunner.cancel();
  logger.info('[fix] 补跑已被用户手动停止');
  io.emit('log', { platform: 'detect', log: '补跑已被用户手动停止', type: 'info' });
  res.json({ success: true, message: '已发送停止指令，正在收尾…' });
});

// WebSocket 连接
io.on('connection', (socket) => {
  logger.info(`Web 客户端已连接: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Web 客户端已断开: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
// 只监听回环地址：桌面端自己访问 + 本机浏览器调试；不暴露给局域网
server.listen(PORT, '127.0.0.1', () => {
  logger.info('=================================');
  logger.info('🤖 AI 评论助手服务已启动');
  logger.info(`📡 访问地址: http://localhost:${PORT}`);
  logger.info(`📁 本次日志文件: ${logger.logFile}`);
  logger.info('=================================');
});
