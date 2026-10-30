// WebSocket 连接
const socket = io();

// 当前平台
let currentPlatform = 'config';

// 各平台导入的链接（分类后回填用）
const importedUrls = { zhihu: [], toutiao: [], csdn: [], sohu: [], baidu: [], netease: [], unknown: [] };

// 平台中文名（导入结果展示用）
const PLATFORM_LABELS = {
  zhihu: '知乎',
  toutiao: '今日头条',
  csdn: 'CSDN',
  sohu: '搜狐平台',
  baidu: '百度百家号',
  netease: '网易新闻',
  unknown: '未识别'
};

// 内联图标（lucide 线稿，24 viewBox）。只放用到的，按名字取。
const ICONS = {
  'settings-2': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  'message-square-text': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  minus: '<path d="M5 12h14"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'link-2-off': '<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
};
function ic(name) {
  return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

// 左侧导航：两组，功能 + 平台
const NAV = [
  { group: '功能管理', items: [['config', 'AI 接口配置', 'settings-2'], ['import', '批量数据导入', 'upload'], ['all', '一键智能运行', 'play'], ['detect', '检测与合规中心', 'scan-search']] },
  { group: '接入平台 (6)', items: [['zhihu', '知乎', 'book-open'], ['toutiao', '今日头条', 'newspaper'], ['csdn', 'CSDN', 'code'], ['sohu', '搜狐平台', 'rss'], ['baidu', '百度百家号', 'search'], ['netease', '网易新闻', 'mail']] }
];

// 快速预设服务商：一键填入协议与官方端点（Anthropic / OpenAI / DeepSeek / 通义千问 / 自定义）
const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', apiType: 'messages', endpoint: 'https://api.anthropic.com/v1/messages', models: ['claude-3-7-sonnet', 'claude-3-5-haiku', 'claude-opus-4-8', 'claude-sonnet-4'] },
  openai: { label: 'OpenAI', apiType: 'chat', endpoint: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  deepseek: { label: 'DeepSeek', apiType: 'chat', endpoint: 'https://api.deepseek.com/v1/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'] },
  qwen: { label: '通义千问', apiType: 'chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'] },
  custom: { label: '自定义接口', apiType: 'chat', endpoint: '', models: [] }
};
// 当前选中的服务商（按端点/协议推断，用户点击后覆盖）
let activeProvider = 'anthropic';

// 平台配置模板
const templates = {
  config: () => `
    <div class="cfg-grid">
      <div class="cfg-col-main">
        <div class="config-card">
          <div class="card-head">
            <div class="card-title-row">${ic('server')}接口协议与服务端点</div>
            <span class="chip chip-static chip-info">支持官方与代理协议</span>
          </div>
          <div class="field">
            <label>快速预设服务商</label>
            <div class="chips" id="provider-chips">
              ${Object.keys(PROVIDERS).map((k) => '<button type="button" class="chip" data-provider="' + k + '" onclick="selectProvider(\'' + k + '\')">' + PROVIDERS[k].label + '</button>').join('')}
            </div>
          </div>
          <div class="field">
            <label>接口通信协议</label>
            <select id="api-type" onchange="onApiTypeChange()">
              <option value="messages">Anthropic Messages API (/v1/messages)</option>
              <option value="chat">OpenAI Chat Completions API (/v1/chat/completions)</option>
              <option value="responses">OpenAI Responses API (/responses)</option>
            </select>
          </div>
          <div class="field">
            <div class="field-head">
              <label>API Endpoint（接口完整地址）</label>
              <button type="button" class="link-btn" onclick="restoreEndpoint()">恢复官方端点</button>
            </div>
            <div class="input-with-badge">
              <span class="method-badge">POST</span>
              <input type="text" id="api-endpoint" placeholder="https://api.anthropic.com/v1/messages">
            </div>
            <div class="hint-text">完整的 API 请求端点，支持中继网关与反代链接（如 api.deepseek.com / 聚合接口）</div>
          </div>
        </div>

        <div class="config-card">
          <div class="card-head">
            <div class="card-title-row">${ic('key')}访问凭证与模型定义</div>
            <span class="chip chip-static chip-ok">${ic('shield-check')}仅存本机</span>
          </div>
          <div class="field">
            <label>API Key（访问授权密钥）</label>
            <div class="input-with-actions">
              <input type="password" id="api-key" placeholder="sk-xxxxxxxxxxxx" autocomplete="off">
              <button type="button" onclick="togglePassword('api-key')">显示</button>
              <button type="button" onclick="copyApiKey()">复制</button>
            </div>
            <div class="hint-text" id="api-key-hint">密钥写入本地应用程序数据目录，不经过任何云端同步</div>
          </div>
          <div class="field">
            <label>模型标识符（Model ID）</label>
            <input type="text" id="model-name" placeholder="claude-3-7-sonnet-20250219">
            <div class="chips" id="model-chips" style="margin-top:8px;"></div>
          </div>
        </div>
      </div>

      <div class="cfg-col-side">
        <div class="config-card">
          <div class="card-head">
            <div class="card-title-row">${ic('sliders')}生成参数调优</div>
          </div>
          <div class="field">
            <div class="field-head">
              <label>Temperature（多样性）</label>
              <span class="field-val" id="temp-val">0.7</span>
            </div>
            <input type="range" class="slider" id="temperature" min="0" max="1" step="0.1" value="0.7" oninput="onTempInput()">
            <div class="hint-text">Anthropic Messages 协议下部分模型不接受该参数，保存后会被忽略。</div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Max Tokens</label>
              <input type="number" id="max-tokens" value="4096" min="1" step="1">
            </div>
            <div class="field">
              <label>请求超时（秒）</label>
              <input type="number" id="timeout" value="60" min="5" step="1">
            </div>
          </div>
        </div>

        <div class="config-card">
          <div class="card-head">
            <div class="card-title-row">${ic('activity')}服务连通性诊断</div>
            <span class="chip chip-static" id="diag-status">未测试</span>
          </div>
          <div class="stats">
            <div class="stat"><div class="stat-num" id="diag-latency">—</div><div class="stat-label">平均延迟</div></div>
            <div class="stat"><div class="stat-num" id="diag-uptime">—</div><div class="stat-label">可用率</div></div>
            <div class="stat"><div class="stat-num" id="exec-mode-stat">串行</div><div class="stat-label">执行模式</div></div>
          </div>
          <div class="terminal">
            <div class="term-dots"><i></i><i></i><i></i></div>
            <div class="term-body" id="term-body">尚未测试。点击下方「测试接口连接」后在此显示诊断输出。</div>
          </div>
        </div>
      </div>
    </div>

    <div class="cfg-footer">
      <div class="cfg-footer-hint" id="cfg-footer-hint">${ic('info')}<span>配置修改后请点击「保存并应用配置」写入本地。</span></div>
      <div class="cfg-footer-actions">
        <button type="button" class="btn btn-secondary" onclick="restoreDefaultConfig()">恢复默认</button>
        <button type="button" class="btn btn-secondary" onclick="testConnection()">测试接口连接</button>
        <button type="button" class="btn btn-primary" onclick="saveConfig()">保存并应用配置</button>
      </div>
    </div>
  `,

  import: () => `
    <div class="config-card">
      <div class="card-head">
        <div class="card-title-row">${ic('list-checks')}粘贴文章链接</div>
        <span class="chip chip-static chip-info">支持 6 个平台自动识别</span>
      </div>
      <div class="field">
        <textarea id="import-textarea" style="min-height:148px;" placeholder="从 Excel 复制一列链接粘贴到这里，每行一个&#10;系统会自动识别其中的 http 链接并按平台归类"></textarea>
      </div>
      <div class="hint-text" style="margin-top:0;">支持知乎、今日头条、CSDN、搜狐、百度百家号、网易链接</div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="classifyAndFill()">${ic('list-checks')}分类并回填</button>
      <button class="btn btn-secondary" onclick="clearImported()">清空</button>
    </div>

    <div class="config-card">
      <div class="card-head">
        <div class="card-title-row">${ic('file')}上传 Excel 文件</div>
      </div>
      <div class="upload-row">
        <div class="file-input-wrapper">
          <span class="file-input-btn">${ic('file')}选择文件</span>
          <input type="file" id="import-file" accept=".xlsx,.xls,.csv" onchange="handleFileUpload(event)">
        </div>
        <span class="file-name" id="file-name-display" style="margin-top:0;">未选择任何文件</span>
      </div>
      <div class="hint-text">自动读取所有工作表的单元格内容，提取其中的链接（.xlsx / .xls / .csv）</div>
    </div>

    <div class="config-card" id="import-result-card" style="display:none;">
      <div class="card-head">
        <div class="card-title-row">分类结果</div>
        <span class="chip chip-static" id="import-result-total">共 0 条链接</span>
      </div>
      <div id="import-result-content"></div>
    </div>
  `,

  all: () => `
    <div class="config-card">
      <div class="card-head">
        <div class="card-title-row">${ic('play')}各平台文章链接</div>
        <span class="chip chip-static chip-info">评论 → 检测</span>
      </div>
      <div class="hint-text" style="margin:0 0 14px;">为每个平台填入文章链接（每行一个）；也可先去「批量数据导入」自动分类回填到这里。默认串行评论全部平台，全部评论完后再统一检测；可在下方「运行设置」里开启多平台并行。</div>
      <div class="form-row">
        ${['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].map((p) => `
          <div class="form-group">
            <label>${PLATFORM_LABELS[p]}</label>
            <textarea id="all-urls-${p}" style="min-height:82px;" placeholder="每行一个文章链接…">${(importedUrls[p] || []).join('\n')}</textarea>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="config-card">
      <div class="card-head">
        <div class="card-title-row">${ic('sliders')}运行设置</div>
      </div>
      <div class="form-row">
          <div class="form-group">
            <label>每篇文章评论数</label>
            <input type="number" id="all-comment-count" placeholder="1~10" min="1" max="10">
          </div>
        <div class="form-group">
          <label>评论后自动检测</label>
          <label class="checkbox-row"><input type="checkbox" id="all-enable-detect" checked> 全部评论完成后回查达标状态（搜狐也参与完整检测；网易仅检测评论数）</label>
        </div>
      </div>

      <div class="parallel-box">
        <label class="checkbox-row">
          <input type="checkbox" id="all-parallel" onchange="onParallelToggle()"> 多平台并行（同时跑多个平台，总耗时最短）
        </label>
        <div class="form-group" id="all-parallel-lanes-wrap" style="display:none;margin-top:2px;">
          <label>同时运行的平台数</label>
          <select id="all-parallel-lanes" onchange="saveParallelPref()">
            <option value="2">2 个（最稳）</option>
            <option value="3" selected>3 个（推荐）</option>
            <option value="6">6 个（全部，占内存最多）</option>
          </select>
        </div>
        <div class="hint-text" id="all-parallel-hint">串行：按 知乎→头条→CSDN→搜狐→百度→网易 顺序逐个跑，一个跑完再跑下一个。</div>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" id="all-start-btn" onclick="startAll()">${ic('play')}开始全部</button>
        <button class="btn btn-secondary" id="all-pause-btn" onclick="pauseRun()" disabled>${ic('pause')}暂停</button>
        <button class="btn btn-secondary" id="all-resume-btn" onclick="resumeRun()" disabled>${ic('play')}继续</button>
        <button class="btn btn-danger" id="all-stop-btn" onclick="stopAll()" disabled>${ic('square')}停止</button>
      </div>
      <div class="hint-text">评论全部完成后自动进入检测阶段；结果在「检测与合规中心」查看。</div>
    </div>

    <div class="config-card">
      <div class="card-head">
        <div class="card-title-row">${ic('activity')}运行进度</div>
      </div>
      <div id="all-progress" class="all-progress">尚未开始</div>
      <div class="all-rows" id="all-rows">
        ${['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].map((p) => `
          <div class="plat-row" id="all-row-${p}">
            <span class="plat-row-name">${PLATFORM_LABELS[p]}</span>
            <span class="plat-row-state" data-state="idle">未开始</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="log-block">
      <div class="log-block-title">运行日志（全部平台）</div>
      <div class="log-container" id="log-container">
        <div class="log-entry log-info">[系统] 等待启动...</div>
      </div>
    </div>
  `,

  detect: () => `
    <div class="config-card">
      <div class="card-head">
        <div class="card-title-row">${ic('scan-search')}粘贴文章链接</div>
        <div id="detect-classify" class="classify-tags"></div>
      </div>
      <div class="field">
        <textarea id="detect-textarea" style="min-height:118px;" placeholder="每行一个文章链接，例如：&#10;https://zhuanlan.zhihu.com/p/xxxxxx&#10;https://blog.csdn.net/xxx/article/details/xxxxxx" oninput="updateDetectClassify()"></textarea>
      </div>
      <div class="btn-group" style="margin-top:14px;">
        <button class="btn btn-primary" id="detect-start-btn" onclick="startDetect()">${ic('scan-search')}一键检测</button>
        <button class="btn btn-danger" id="detect-stop-btn" onclick="stopDetect()" disabled>${ic('square')}停止</button>
        <button class="btn btn-secondary" onclick="openAccountModal()">${ic('user')}检测账号</button>
        <span class="hint-text">自动识别 知乎 / 头条 / CSDN / 搜狐 / 百度 / 网易；搜狐按可见评论、点赞、收藏检测，网易只回查评论数</span>
      </div>
    </div>

    <div class="config-card">
      <div class="card-head">
        <div class="card-head-left">
          <div class="card-title-row">${ic('circle-check')}检测结果</div>
          <div class="detect-summary" id="detect-summary"></div>
        </div>
        <div class="card-head-right">
          <button class="btn btn-secondary btn-sm" onclick="exportDetectCsv()">${ic('download')}导出 CSV</button>
          <button class="btn btn-secondary btn-sm" onclick="openEvidenceDir('')">${ic('folder-open')}留痕目录</button>
          <button class="btn btn-secondary btn-sm" id="clear-detect-history-btn" onclick="openClearDetectModal()">${ic('trash-2')}清除历史</button>
        </div>
      </div>
      <div id="detect-progress" class="all-progress" style="font-size:13px;margin-bottom:12px;"></div>
      <div id="detect-results"></div>
    </div>

    <div class="fix-bar">
      <div>
        <div class="fix-bar-title" id="fix-bar-title">达标操作</div>
        <div class="fix-bar-sub">普通平台达标线：评论≥3 且已点赞、已收藏；网易：评论≥3。不达标按缺口补跑，每篇最多 2 次；补跑后点「重测未达标项」刷新结果。</div>
      </div>
      <div class="fix-bar-actions">
        <button class="btn btn-primary" id="fix-btn" onclick="startFix()" disabled>${ic('wrench')}补跑不达标项</button>
        <button class="btn btn-secondary" id="refail-btn" onclick="redetectFailed()" disabled>${ic('refresh-cw')}重测未达标项</button>
      </div>
    </div>

    <div class="log-block">
      <div class="log-block-title">检测日志</div>
      <div class="log-container" id="log-container">
        <div class="log-entry log-info">[系统] 等待启动...</div>
      </div>
    </div>
  `,

  platform: (platform, defaultUrls, userDataDir) => {
    const dirName = String(userDataDir || '').replace(/^.*[\\/]/, '');
    const steps = (platform === 'netease')
      ? ['打开文章跟贴区（网易不执行点赞 / 收藏）', 'AI 依据正文生成提问式评论', '按设定条数发布并等待回执', '完成后自动进入检测阶段']
      : ['点赞 + 喜欢 + 收藏文章', 'AI 依据正文生成提问式评论', '按设定条数发布并等待回执', '完成后自动进入检测阶段'];
    return `
    <div class="cfg-grid">
      <div class="cfg-col-main">
        <div class="config-card">
          <div class="card-head">
            <div class="card-title-row">${ic('newspaper')}文章配置</div>
            <span class="chip chip-static chip-info">支持多链接批量</span>
          </div>
          <div class="field">
            <label>文章链接（每行一个）</label>
            <textarea id="article-urls" style="min-height:150px;" placeholder="每行一个链接…">${defaultUrls}</textarea>
            <div class="hint-text">每行一个链接，按顺序串行处理；进度在下方日志中可见。</div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>每篇文章评论数</label>
              <input type="number" id="comment-count" placeholder="1~10" min="1" max="10">
            </div>
            <div class="field">
              <label>用户数据目录（登录态）</label>
              <input type="text" class="input-readonly" value="${dirName}" readonly>
            </div>
          </div>
        </div>

        <div class="config-card">
          <div class="card-head"><div class="card-title-row">${ic('play')}运行控制</div></div>
          <div class="btn-group" style="margin-top:0;">
            <button class="btn btn-primary" id="start-btn" onclick="startTask('${platform}')">${ic('play')}开始评论</button>
            <button class="btn btn-secondary" id="pause-btn" onclick="pauseRun()" disabled>${ic('pause')}暂停</button>
            <button class="btn btn-secondary" id="resume-btn" onclick="resumeRun()" disabled>${ic('play')}继续</button>
            <button class="btn btn-danger" id="stop-btn" onclick="stopTask('${platform}')" disabled>${ic('square')}停止</button>
          </div>
          <div class="hint-text">暂停粒度为「文章之间」：点暂停后当前文章会跑完，下一篇前停住；「停止」立即终止且下次从头开始。</div>
        </div>
      </div>

      <div class="cfg-col-side">
        <div class="config-card">
          <div class="card-head"><div class="card-title-row">${ic('user')}平台账号</div></div>
          <div class="account-row">
            <div class="avatar">${ic('user')}</div>
            <div>
              <div class="account-name">登录态保存在本机</div>
              <div class="account-sub">首次使用会弹出浏览器，登录一次后免登录</div>
            </div>
          </div>
          <div class="btn-group" style="margin-top:0;">
            <button class="btn btn-secondary btn-sm" onclick="openAccountModal()">${ic('user')}检测账号设置</button>
          </div>
        </div>

        <div class="config-card">
          <div class="card-head"><div class="card-title-row">${ic('list-checks')}执行流程</div></div>
          <div class="steps">
            ${steps.map((t, i) => '<div class="step"><span class="step-num">' + (i + 1) + '</span><span class="step-text">' + t + '</span></div>').join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="log-block" style="margin-top:16px;">
      <div class="log-block-title">运行日志</div>
      <div class="log-container" id="log-container">
        <div class="log-entry log-info">[系统] 等待启动...</div>
      </div>
    </div>
  `;
  }
};

// 平台默认配置
const platformDefaults = {
  zhihu: {
    urls: '',
    userDataDir: 'D:\\playwright\\pw-data-zhihu'
  },
  toutiao: {
    urls: '',
    userDataDir: 'D:\\playwright\\pw-data-toutiao'
  },
  csdn: {
    urls: '',
    userDataDir: 'D:\\playwright\\pw-data-csdn'
  },
  sohu: {
    urls: '',
    userDataDir: 'D:\\playwright\\pw-data-sohu'
  },
  baidu: {
    urls: '',
    userDataDir: 'D:\\playwright\\pw-data-baidu'
  },
  netease: {
    urls: '',
    userDataDir: 'D:\\playwright\\pw-data-netease'
  }
};

// 平台标题映射
const platformTitles = {
  config: 'AI 接口配置',
  import: '批量数据导入',
  all: '一键智能运行',
  detect: '检测与合规中心',
  zhihu: '知乎 - 自动评论',
  toutiao: '今日头条 - 自动评论',
  csdn: 'CSDN - 自动评论',
  sohu: '搜狐 - 自动评论',
  baidu: '百度 - 自动评论',
  netease: '网易 - 自动评论'
};

// 页面副标题（顶栏标题下方一句话）
const platformSubtitles = {
  config: '配置大模型通信协议、鉴权密钥与推理参数 · 配置与密钥仅保存在本机',
  import: '粘贴或上传 Excel，按平台分类后回填',
  all: '评论全部平台（可开多平台并行），评论完自动检测',
  detect: '回查我的评论数 / 点赞 / 收藏，达标自动留痕',
  zhihu: '专栏文章：点赞、喜欢、收藏后发布评论',
  toutiao: '文章：点赞、收藏后在评论抽屉发布',
  csdn: '博客文章：点赞、收藏后在侧边评论栏发布',
  sohu: '文章：点赞、收藏后发布评论',
  baidu: '百家号文章：点赞、收藏后发布评论',
  netease: '文章跟贴：发布后按评论 API 复检确认'
};

// 平台导航右侧的状态徽标：有导入链接显示条数，否则显示「就绪」
function platformBadge(key) {
  if (['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].indexOf(key) < 0) return null;
  const n = (importedUrls[key] || []).length;
  if (n > 0) return { text: n + ' 条', has: true };
  return { text: '就绪', has: false };
}

// 渲染左侧导航并绑定切换
function renderSidebar() {
  const list = document.getElementById('platform-list');
  if (!list) return;
  list.innerHTML = NAV.map((g) =>
    '<div class="nav-group-label">' + g.group + '</div>'
    + g.items.map(([key, label, icon]) => {
      const b = platformBadge(key);
      return '<div class="platform-item' + (key === currentPlatform ? ' active' : '') + '" data-platform="' + key + '">'
        + ic(icon) + '<span class="platform-name">' + label + '</span>'
        + (b ? '<span class="nav-badge' + (b.has ? ' has' : '') + '">' + b.text + '</span>' : '')
        + '</div>';
    }).join('')
  ).join('');
  list.querySelectorAll('.platform-item').forEach((item) => {
    item.addEventListener('click', function () {
      const platform = this.dataset.platform;
      // 离开「一键运行」页前，把已编辑的各平台链接回填到 importedUrls，避免切回时丢失
      if (currentPlatform === 'all' && platform !== 'all') saveAllUrls();
      currentPlatform = platform;

      list.querySelectorAll('.platform-item').forEach((i) => i.classList.remove('active'));
      this.classList.add('active');

      document.getElementById('page-title').textContent = platformTitles[platform];
      document.getElementById('page-subtitle').textContent = platformSubtitles[platform] || '';

      renderContent(platform);
    });
  });
}

// 渲染内容
// ===== 页面容器：建一次、留着复用，切页只换挂载的节点 =====
//
// 原实现每次切页都 innerHTML 全量重建，切走再切回会：
//   - 把输入框里手填的内容覆盖回旧值（只能靠 importedUrls 等外部状态硬撑）
//   - 丢掉页面内的滚动位置等一切临时状态
//   - 每次切页都要重新解析一遍 HTML（有可见的闪动）
// 改成「节点缓存 + 只换挂载」后，这些都自然保留。
//
// ⚠️ 为什么不干脆把 6 个平台页一起挂在 DOM 里：它们用的是**相同的元素 id**
// （article-urls / comment-count / log-container …），同时挂载会让 getElementById
// 全部命中第一个页面，产生一批很难排查的静默 bug。
// 所以这里始终只挂载一个页面，其余节点游离保留（状态完整，只是不在文档里）。
const pageCache = {};
const pageInited = {};

// 只负责把 HTML 建出来。**不要**在这里调用任何初始化函数 ——
// 建节点时它还是游离的（不在文档里），那些函数内部用 document.getElementById
// 会全部拿到 null。初始化统一放到 renderContent 里、挂载之后执行。
function buildPageNode(key) {
  const node = document.createElement('div');
  node.className = 'page';
  node.dataset.page = key;

  if (key === 'config') {
    node.innerHTML = templates.config();
  } else if (key === 'import') {
    node.innerHTML = templates.import();
  } else if (key === 'all') {
    node.innerHTML = templates.all();
  } else if (key === 'detect') {
    node.innerHTML = templates.detect();
  } else {
    const defaults = platformDefaults[key];
    const urls = (importedUrls[key] && importedUrls[key].length)
      ? importedUrls[key].join('\n')
      : defaults.urls;
    node.innerHTML = templates.platform(key, urls, defaults.userDataDir);
  }
  return node;
}

function renderContent(platform) {
  const content = document.getElementById('main-content');
  // 切页一次淡入（重新触发动画）
  content.classList.remove('page-enter');
  void content.offsetWidth;
  content.classList.add('page-enter');

  // 先把当前挂载的节点摘下来（它已存在 pageCache 里，状态不丢）
  while (content.firstChild) content.removeChild(content.firstChild);
  if (!pageCache[platform]) pageCache[platform] = buildPageNode(platform);
  content.appendChild(pageCache[platform]);

  // 一次性初始化：必须等挂载之后再做（内部要用 getElementById）。
  // 同理，只做一次 —— 每次显示都重跑会把用户在表单里未保存的编辑冲掉。
  if (!pageInited[platform]) {
    pageInited[platform] = true;
    if (platform === 'config') loadConfig();
  }

  // 每次显示都要重刷的「会变的内容」：
  //   - 日志：离开期间 socket 推来的日志先写进缓冲，这里回填
  //     （节点游离时没法直接 append，所以日志缓冲仍然必要，不能删）
  //   - 运行状态：离开期间 status 事件可能已把该通道切成 running/paused，
  //     而那一刻该页面的 DOM 不在文档里，applyRunState 找不到元素
  renderLogPanel(activeLogKey());
  if (platform === 'import') renderImportResult();
  if (platform === 'detect') { updateDetectClassify(); renderDetectionTable(); }
  if (platform === 'all') { paintAllRows(); loadParallelPref(); }
  if (platform === 'config') updateExecModeStat();
  applyRunState();
}

// ===== AI 配置页：工具函数 =====
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

// 终端面板输出：首次写入时清掉占位文案
function termWrite(text, cls) {
  const body = document.getElementById('term-body');
  if (!body) return;
  if (body.dataset.live !== '1') { body.textContent = ''; body.dataset.live = '1'; }
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}
function setDiagStatus(text, cls) {
  const el = document.getElementById('diag-status');
  if (!el) return;
  el.className = 'chip chip-static' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

// 服务商预设芯片
function renderProviderChips() {
  const box = document.getElementById('provider-chips');
  if (!box) return;
  box.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.provider === activeProvider);
  });
}
function selectProvider(key) {
  const p = PROVIDERS[key];
  if (!p) return;
  activeProvider = key;
  setVal('api-type', p.apiType);
  if (p.endpoint) setVal('api-endpoint', p.endpoint);
  renderProviderChips();
  renderModelChips();
  termWrite('$ 已套用预设：' + p.label + ' → ' + p.apiType + (p.endpoint ? ' · ' + p.endpoint : ''), 't-cmd');
}
// 切换协议时，若当前端点与预设不符则视为自定义
function onApiTypeChange() {
  const cur = getVal('api-type');
  const hit = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].endpoint && PROVIDERS[k].apiType === cur && PROVIDERS[k].endpoint === getVal('api-endpoint'));
  if (hit) { activeProvider = hit; renderProviderChips(); renderModelChips(); }
}
// 模型预设芯片（跟随服务商）
function renderModelChips() {
  const box = document.getElementById('model-chips');
  if (!box) return;
  const models = (PROVIDERS[activeProvider] || {}).models || [];
  if (!models.length) { box.innerHTML = '<span class="hint-text" style="margin:0;">自定义接口：请直接填写模型标识符</span>'; return; }
  const cur = getVal('model-name');
  box.innerHTML = models.map((m) =>
    '<button type="button" class="chip' + (m === cur ? ' active' : '') + '" onclick="selectModelPreset(\'' + m + '\')">' + m + '</button>'
  ).join('');
}
function selectModelPreset(m) {
  setVal('model-name', m);
  renderModelChips();
}
// 恢复官方端点：回到当前服务商（或按协议匹配）的官方地址
function restoreEndpoint() {
  const p = PROVIDERS[activeProvider];
  if (p && p.endpoint) { setVal('api-endpoint', p.endpoint); termWrite('$ 已恢复官方端点：' + p.endpoint, 't-cmd'); }
  else termWrite('! 自定义接口没有可恢复的官方端点', '');
}
function onTempInput() {
  const v = document.getElementById('temperature');
  const out = document.getElementById('temp-val');
  if (v && out) out.textContent = Number(v.value).toFixed(1);
}
async function copyApiKey() {
  const v = getVal('api-key');
  if (!v) { showToast('error', 'API Key 为空'); return; }
  try { await navigator.clipboard.writeText(v); showToast('success', 'API Key 已复制'); }
  catch (e) { showToast('error', '复制失败：' + e.message); }
}
function restoreDefaultConfig() {
  activeProvider = 'anthropic';
  setVal('api-type', PROVIDERS.anthropic.apiType);
  setVal('api-endpoint', PROVIDERS.anthropic.endpoint);
  setVal('max-tokens', 4096);
  setVal('temperature', 0.7);
  onTempInput();
  renderProviderChips();
  renderModelChips();
  termWrite('$ 已恢复为默认配置（未保存）', 't-cmd');
}
function showGuide() {
  showToast('info', '流程：① 选服务商并填 API Key ② 保存并应用配置 ③ 批量数据导入链接 ④ 一键智能运行 ⑤ 在检测与合规中心查看达标与留痕。');
}

// 加载 AI 配置（密钥永不回显明文：显示掩码作为提示，留空表示不修改）
async function loadConfig() {
  renderProviderChips();
  renderModelChips();
  onTempInput();
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (!data.success) return;
    const c = data.config || {};

    setVal('api-type', c.apiType || 'messages');
    setVal('api-endpoint', c.endpoint || '');
    setVal('model-name', c.model || '');
    if (c.maxTokens) setVal('max-tokens', c.maxTokens);
    if (typeof c.temperature === 'number') { setVal('temperature', c.temperature); onTempInput(); }
    if (c.timeout) setVal('timeout', c.timeout);

    const keyEl = document.getElementById('api-key');
    if (keyEl) {
      keyEl.value = '';
      keyEl.placeholder = c.hasApiKey ? (c.apiKeyMask + '（已配置，留空不修改）') : 'sk-xxxxxxxxxxxx';
    }
    const hint = document.getElementById('api-key-hint');
    if (hint) {
      hint.textContent = c.hasApiKey
        ? '已保存密钥（' + c.apiKeyMask + '）。留空即保持原密钥，填写新值才会覆盖。密钥仅写入本地应用程序数据目录，不经过任何云端同步。'
        : '密钥仅写入本地应用程序数据目录，不经过任何云端同步。';
    }

    // 按端点反推当前服务商；从未配置过则默认 Anthropic
    const hit = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].endpoint && PROVIDERS[k].endpoint === (c.endpoint || ''));
    activeProvider = hit || (c.endpoint ? 'custom' : 'anthropic');
    renderProviderChips();
    renderModelChips();
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

// 保存配置（maxTokens / temperature / timeout 写入本地 aiConfig.js，评论脚本即时生效）
async function saveConfig() {
  const newKey = getVal('api-key').trim();
  const config = {
    apiType: getVal('api-type'),
    endpoint: getVal('api-endpoint'),
    model: getVal('model-name'),
    maxTokens: Number(getVal('max-tokens')) || 4096,
    temperature: Number(getVal('temperature')),
    timeout: Number(getVal('timeout')) || 60
  };
  // 只在用户实际填了新密钥时才提交该字段（空 = 保持原密钥不变）
  if (newKey) config.apiKey = newKey;

  if (!config.endpoint) { showToast('error', '请先填写 API Endpoint'); return; }
  if (!config.model) { showToast('error', '请先填写模型标识符'); return; }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const data = await res.json();

    if (data.success) {
      showToast('success', data.message || '配置已保存');
      termWrite('$ 配置已写入本地：' + config.apiType + ' · ' + config.model, 't-ok');
      if (newKey) termWrite('$ 密钥已更新（' + (data.apiKeyMask || '') + '）', 't-ok');
      setVal('api-key', '');
      loadConfig();
    } else {
      showToast('error', (data.error || '保存失败'));
    }
  } catch (error) {
    showToast('error', '保存失败: ' + error.message);
  }
}

// 测试连接：用已保存的配置发一次真实最小请求，把过程写进诊断终端
async function testConnection() {
  setDiagStatus('测试中…');
  termWrite('$ POST /api/test-connection', 't-cmd');
  const t0 = performance.now();
  const latencyEl = document.getElementById('diag-latency');
  try {
    const res = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    const ms = (data.latencyMs != null) ? data.latencyMs : Math.round(performance.now() - t0);
    if (latencyEl) latencyEl.textContent = ms + 'ms';

    if (data.success && data.ok) {
      termWrite('HTTP ' + data.status + '  [time: ' + ms + 'ms]', 't-ok');
      termWrite('protocol: ' + data.apiType + '  ·  model: ' + data.model);
      termWrite('✓ 接口响应正常', 't-ok');
      setDiagStatus('正常', 'chip-ok');
      showToast('success', data.message || '接口正常');
    } else if (data.success && !data.ok) {
      termWrite('HTTP ' + data.status + '  [time: ' + ms + 'ms]');
      if (data.detail) termWrite(data.detail);
      termWrite('! ' + data.message);
      setDiagStatus('异常', 'chip-danger');
      showToast('error', data.message || '接口异常');
    } else {
      if (latencyEl) latencyEl.textContent = '—';
      termWrite('! ' + (data.error || '测试失败'));
      setDiagStatus('失败', 'chip-danger');
      showToast('error', data.error || '测试失败');
    }
  } catch (error) {
    if (latencyEl) latencyEl.textContent = '—';
    termWrite('! 测试失败：' + error.message);
    setDiagStatus('失败', 'chip-danger');
    showToast('error', '测试失败: ' + error.message);
  }
}

// 本地引擎状态（侧栏底部卡片）：由 socket 连接状态驱动
function updateEngineStatus(connected) {
  const dot = document.getElementById('engine-dot');
  const title = document.getElementById('engine-title');
  const ep = document.getElementById('engine-endpoint');
  if (dot) dot.className = 'dot-live' + (connected ? '' : ' off');
  if (title) title.textContent = connected ? '本地引擎运行中' : '本地引擎已断开';
  if (ep) ep.textContent = '127.0.0.1:' + (location.port || '27188') + (connected ? ' (正常响应)' : ' (无响应)');
}

// 启动任务
async function startTask(platform) {
  const urls = document.getElementById('article-urls').value.trim().split('\n').filter(u => u);
  const commentCount = parseInt(document.getElementById('comment-count').value, 10);

  if (urls.length === 0) {
    alert('请输入至少一个文章链接');
    return;
  }
  if (!Number.isFinite(commentCount) || commentCount < 1 || commentCount > 10) {
    alert('请填写每篇文章评论数（1~10）');
    return;
  }

  // 清空本页日志（含缓冲）
  clearLogPanel('p:' + platform);

  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, urls, commentCount })
    });
    const data = await res.json();

    if (data.success) {
      setRunState(platform, 'running');
      addLog('success', '[系统] ' + data.message);
    } else {
      addLog('error', '[错误] ' + data.error);
    }
  } catch (error) {
    addLog('error', '[错误] 启动失败: ' + error.message);
  }
}

// 停止任务
async function stopTask(platform) {
  try {
    const res = await fetch('/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const data = await res.json();

    if (data.success) {
      setRunState(platform, 'idle');
      addLog('info', '[系统] ' + data.message);
    } else {
      addLog('error', '[错误] ' + data.error);
    }
  } catch (error) {
    addLog('error', '[错误] 停止失败: ' + error.message);
  }
}

// 切换密码显示
function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  const button = event.target;
  if (input.type === 'password') {
    input.type = 'text';
    button.textContent = '隐藏';
  } else {
    input.type = 'password';
    button.textContent = '显示';
  }
}

// ===== 运行日志缓冲 =====
// 切页会重建 #log-container：若不缓存，历史日志会全丢，而且切走期间 socket 推来的日志也会被直接丢弃
// （表现为"切回来只剩等待启动，必须等新的点赞/评论事件才冒日志"）。
// key：'p:<platform>' 单平台页（无前缀）| 'agg' 一键运行 / 检测页（带平台前缀的聚合流）
const logBuffer = {};
const LOG_BUFFER_MAX = 500;

function nowStamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
function logEntryHtml(type, time, text) {
  return '<div class="log-entry log-' + type + '">[' + time + '] ' + escapeHtml(text) + '</div>';
}
function pushLogEntry(key, type, time, text) {
  const list = logBuffer[key] || (logBuffer[key] = []);
  list.push({ type: type, time: time, text: text });
  if (list.length > LOG_BUFFER_MAX) list.splice(0, list.length - LOG_BUFFER_MAX);
}
// 当前页面应对应的缓冲 key
function activeLogKey() {
  return (currentPlatform === 'all' || currentPlatform === 'detect') ? 'agg' : ('p:' + currentPlatform);
}
// 把缓冲回填到日志面板（切页后调用）
function renderLogPanel(key) {
  const box = document.getElementById('log-container');
  if (!box) return;
  const list = logBuffer[key] || [];
  if (!list.length) {
    box.innerHTML = '<div class="log-entry log-info">[系统] 等待启动...</div>';
    box.dataset.placeholder = '1';
    return;
  }
  box.innerHTML = list.map(function (e) { return logEntryHtml(e.type, e.time, e.text); }).join('');
  box.dataset.placeholder = '0';
  box.scrollTop = box.scrollHeight;
}
// 实时追加一条（会先清掉「等待启动」占位）
function appendLogEntry(type, time, text) {
  const box = document.getElementById('log-container');
  if (!box) return false;
  if (box.dataset.placeholder === '1') box.innerHTML = '';
  box.insertAdjacentHTML('beforeend', logEntryHtml(type, time, text));
  box.scrollTop = box.scrollHeight;
  return true;
}
// 开始任务前清空某页日志（连同它的缓冲）
function clearLogPanel(key) {
  delete logBuffer[key];
  const box = document.getElementById('log-container');
  if (box) {
    box.innerHTML = '<div class="log-entry log-info">[系统] 等待启动...</div>';
    box.dataset.placeholder = '1';
  }
}

// 本地提示日志（非 socket 推送）：写入当前页缓冲 + 面板；无日志面板的页面（如 AI 配置）改用右下角提示
function addLog(type, message) {
  const text = String(message == null ? '' : message);
  const box = document.getElementById('log-container');
  if (!box) { showToast(type, text); return; }
  const time = nowStamp();
  pushLogEntry(activeLogKey(), type, time, text);
  appendLogEntry(type, time, text);
}

// 右下角轻提示：3 秒自动消失
function showToast(type, message) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML = ic(type === 'error' ? 'circle-alert' : type === 'success' ? 'circle-check' : 'info') + '<span></span>';
  t.querySelector('span').textContent = message;
  root.appendChild(t);
  setTimeout(() => { t.classList.add('toast-leave'); setTimeout(() => t.remove(), 200); }, 3000);
}

// 更新状态：顶栏状态胶囊
function updateStatus(status, text) {
  const pill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');

  if (pill) pill.className = 'status-pill status-' + status;
  if (statusText) statusText.textContent = text;
}

// 按运行状态切换 开始/暂停/继续/停止 按钮的可用性
// prefix='' 单平台页，prefix='all-' 一键运行页
function setRunButtons(prefix, state) {
  const start = document.getElementById(prefix + 'start-btn');
  const pause = document.getElementById(prefix + 'pause-btn');
  const resume = document.getElementById(prefix + 'resume-btn');
  const stop = document.getElementById(prefix + 'stop-btn');
  if (start) start.disabled = (state === 'running' || state === 'paused');
  if (pause) pause.disabled = (state !== 'running');
  if (resume) resume.disabled = (state !== 'paused');
  if (stop) stop.disabled = (state === 'idle');
}

// ===== 运行状态存储 =====
// 切页会重建内容区 DOM，按钮回到模板默认值；socket 的 status 事件又只在"状态变化"时才推，
// 所以切走再切回来时按钮会被重置（表现为任务明明还在跑，「开始」却又是可点的）。
// 这里按"通道"记住状态，切页时据此恢复按钮与顶栏胶囊。
// 通道：单平台名（zhihu…netease）/ 'all'（一键运行）/ 'detect'（检测中心）
const runStates = {}; // channel -> 'idle' | 'running' | 'paused' | 'error'
const STATUS_TEXT = { idle: '就绪', running: '运行中', paused: '已暂停', error: '错误' };
const RUN_PLATFORMS = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];
function isRunPlatform(p) { return RUN_PLATFORMS.indexOf(p) >= 0; }
function getRunState(ch) { return runStates[ch] || 'idle'; }
function setRunState(ch, state) {
  runStates[ch] = state;
  applyRunState();
}

// 检测中心的按钮（开始/停止/清除历史）——与 fix/refail 分开，后者由 renderDetectionTable 按计数算
function applyDetectButtons(busy) {
  const start = document.getElementById('detect-start-btn');
  const stop = document.getElementById('detect-stop-btn');
  const clearHistory = document.getElementById('clear-detect-history-btn');
  if (start) start.disabled = busy;
  if (stop) stop.disabled = !busy;
  if (clearHistory) clearHistory.disabled = busy;
}

// 把"当前页面"的运行状态应用到按钮与顶栏胶囊（切页、状态变化时都调用）
function applyRunState() {
  if (currentPlatform === 'all') {
    const st = getRunState('all');
    setRunButtons('all-', st);
    updateStatus(st, STATUS_TEXT[st]);
  } else if (isRunPlatform(currentPlatform)) {
    const st = getRunState(currentPlatform);
    setRunButtons('', st);
    updateStatus(st, STATUS_TEXT[st]);
  } else if (currentPlatform === 'detect') {
    const busy = getRunState('detect') !== 'idle';
    detectBusy = busy;
    applyDetectButtons(busy);
    updateStatus(busy ? 'running' : 'idle', busy ? '运行中' : '就绪');
  }
  // 其它页面（AI 配置 / 批量导入）不显示运行按钮，胶囊保持原值
}

// 从服务端拉一次各通道运行状态，写入 runStates。
// 用途：runStates 只在前端内存里，刷新页面（F5 / Ctrl+R）会清空，
// 导致「任务明明在跑，按钮却显示就绪」。页面初始化时调一次即可闭合。
async function loadRunStates() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!data || !data.success || !data.states) return;
    Object.keys(data.states).forEach(function (ch) { runStates[ch] = data.states[ch]; });
    detectBusy = getRunState('detect') !== 'idle';
    applyRunState();
  } catch (e) {
    // 拿不到就按 idle 显示，与刷新前的旧行为一致，不额外报错打扰用户
    console.error('读取运行状态失败:', e);
  }
}

// 侧栏版本号：从服务端读 package.json 的 version。
// 不要在 HTML 里硬编码 —— 之前写死的 "v2.4.0" 与 package.json 长期不一致。
async function loadAppVersion() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    if (data && data.success && data.version) {
      const el = document.getElementById('brand-version');
      if (el) el.textContent = 'v' + data.version + ' · 桌面专业版';
    }
  } catch (e) {
    // 拿不到就保留 HTML 里的兜底文案，不打扰用户
    console.error('读取版本号失败:', e);
  }
}

// 暂停/继续当前评论任务（通过 ipc，不重启、从当前位置继续）
// 注意：服务端不推送 paused 状态，需在前端本地记状态，否则按钮不会跟着变
async function pauseRun() {
  try {
    const r = await fetch('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: currentPlatform }) });
    const d = await r.json();
    if (!d.success) addLog('error', '[错误] ' + d.error);
    else { setRunState(currentPlatform, 'paused'); addLog('info', '[系统] ' + (d.message || '已暂停')); }
  } catch (e) { addLog('error', '[错误] 暂停失败: ' + e.message); }
}
async function resumeRun() {
  try {
    const r = await fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: currentPlatform }) });
    const d = await r.json();
    if (!d.success) addLog('error', '[错误] ' + d.error);
    else { setRunState(currentPlatform, 'running'); addLog('info', '[系统] ' + (d.message || '已继续')); }
  } catch (e) { addLog('error', '[错误] 继续失败: ' + e.message); }
}

// ===== 检测账号设置弹窗 =====
async function openAccountModal() {
  try {
    const r = await fetch('/api/detect-accounts');
    const d = await r.json();
    const a = (d.success && d.accounts) || {};
    document.getElementById('acc-csdn').value = a.csdn || '';
    document.getElementById('acc-zhihu').value = a.zhihu || '';
    document.getElementById('acc-toutiao').value = a.toutiao || '';
    document.getElementById('acc-baidu').value = a.baidu || '';
    document.getElementById('acc-sohu').value = a.sohu || '';
    document.getElementById('acc-netease').value = a.netease || '';
  } catch (e) { /* 首次无配置忽略 */ }
  document.getElementById('account-modal').style.display = 'flex';
}
function closeAccountModal() {
  document.getElementById('account-modal').style.display = 'none';
}
async function saveAccounts() {
  const accounts = {
    csdn: document.getElementById('acc-csdn').value.trim(),
    zhihu: document.getElementById('acc-zhihu').value.trim(),
    toutiao: document.getElementById('acc-toutiao').value.trim(),
    baidu: document.getElementById('acc-baidu').value.trim(),
    sohu: document.getElementById('acc-sohu').value.trim(),
    netease: document.getElementById('acc-netease').value.trim()
  };
  try {
    const r = await fetch('/api/detect-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: accounts }) });
    const d = await r.json();
    if (d.success) { addLog('success', '[系统] ' + d.message); closeAccountModal(); }
    else addLog('error', '[错误] ' + d.error);
  } catch (e) { addLog('error', '[错误] 保存失败: ' + e.message); }
}

// WebSocket 事件监听
socket.on('log', (data) => {
  const p = data.platform || 'system';
  const raw = String(data.log == null ? '' : data.log).trim();
  if (!raw) return;
  const time = nowStamp();
  const aggTag = (p === 'all' || p === 'detect') ? '' : ('[' + (PLATFORM_LABELS[p] || p) + '] ');

  // 无论当前在看哪个页面都先缓存：单平台页存原文，一键运行 / 检测页存带前缀的聚合流
  pushLogEntry('p:' + p, data.type, time, raw);
  pushLogEntry('agg', data.type, time, aggTag + raw);

  // 实时渲染：只往当前页面对应的缓冲上追加（切走时不再丢弃，切回后由 renderLogPanel 回填）
  if (activeLogKey() === 'agg') appendLogEntry(data.type, time, aggTag + raw);
  else if (p === currentPlatform) appendLogEntry(data.type, time, raw);
});

// 进度行片段：进行中带转圈图标，完成带对勾
function progRunning(text) { return '<span class="prog-running">' + ic('loader') + text + '</span>'; }
function progDone(text) { return '<span class="prog-done">' + ic('check') + text + '</span>'; }

// 一键运行：进度更新
socket.on('all-progress', (data) => {
  const phaseLabel = data.phase === 'comment' ? '评论' : '检测';
  const state = data.status === 'running' ? 'running' : (data.status === 'error' ? 'error' : 'done');
  // 先记状态再落 DOM：该页面可能处于游离状态（节点被缓存但不在文档里），
  // 这时写不到 DOM，切回「一键运行」页时由 paintAllRows 补画。
  setRowState(data.platform, state, phaseLabel);
});

// 检测结果（整平台，来自一键运行检测阶段 或 检测中心一键检测；merge 时按 url 合并保留旧行）
socket.on('detection', (data) => {
  const results = data.results || [];
  // 检测中心是历史列表：同一平台 + URL 更新最新结果，其他历史链接继续保留。
  if (!detectionData[data.platform]) detectionData[data.platform] = [];
  const list = detectionData[data.platform];
  results.forEach(function (r) {
    const i = list.findIndex(function (x) { return x.url === r.url; });
    if (i >= 0) list[i] = r; else list.push(r);
  });
  saveDetectionHistory();
  if (currentPlatform === 'detect') renderDetectionTable();
});

// 单链接重新检测结果
socket.on('detection-row', (data) => {
  const result = data.result;
  if (!result) return;
  if (!detectionData[data.platform]) detectionData[data.platform] = [];
  const list = detectionData[data.platform];
  const i = list.findIndex((r) => r.url === result.url);
  if (i >= 0) list[i] = result; else list.push(result);
  saveDetectionHistory();
  delete redetectingUrls[result.url];
  delete redetectingEvidence[result.url];
  if (currentPlatform === 'detect') renderDetectionTable();
});

// 检测中心：一键检测/重测 进度
socket.on('detect-progress', (data) => {
  if (currentPlatform !== 'detect') return;
  const el = document.getElementById('detect-progress');
  if (!el) return;
  const platLabel = PLATFORM_LABELS[data.platform] || data.platform;
  if (data.status === 'running') {
    el.innerHTML = '正在检测 (' + data.index + '/' + data.total + ')：' + platLabel + ' ' + progRunning('进行中');
  } else {
    el.innerHTML = '检测 (' + data.index + '/' + data.total + ')：' + platLabel + ' ' + progDone('完成');
  }
});

// 检测中心：补跑进度
socket.on('fix-progress', (data) => {
  if (currentPlatform !== 'detect') return;
  const el = document.getElementById('detect-progress');
  if (!el) return;
  const platLabel = PLATFORM_LABELS[data.platform] || data.platform;
  if (data.status === 'running') {
    el.innerHTML = '补跑 (' + data.index + '/' + data.total + ')：' + platLabel + '，补发 ' + data.count + ' 条评论 ' + progRunning('进行中');
  } else {
    el.innerHTML = '补跑 (' + data.index + '/' + data.total + ')：' + platLabel + ' ' + progDone('完成');
  }
});

// 检测中心：一键检测/重测 完成
socket.on('detect-done', () => {
  if (currentPlatform === 'detect') {
    const el = document.getElementById('detect-progress');
    if (el) el.innerHTML = progDone('检测完成');
  }
  setDetectBusy(false);
});

// 检测中心：补跑完成
socket.on('fix-done', () => {
  if (currentPlatform === 'detect') {
    const el = document.getElementById('detect-progress');
    if (el) el.innerHTML = progDone('补跑完成') + '，可点「重测未达标项」刷新结果';
    addLog('success', '[系统] 补跑完成。建议点「重测未达标项」刷新结果，看哪些已达标。');
  }
  setDetectBusy(false);
});

// 一键运行：全部完成
socket.on('all-done', () => {
  runStates.all = 'idle'; // 无论当前在哪页都记下来，切回来才不会是「运行中」
  if (currentPlatform !== 'all') return;
  const el = document.getElementById('all-progress');
  if (el) el.innerHTML = progDone('全部运行完成');
  applyRunState();
});
socket.on('status', (data) => {
  if (!data || !data.platform) return;
  // 无论当前在哪一页都先记下来（切回该页时才能恢复按钮/胶囊）
  runStates[data.platform] = data.status;
  if (data.platform === 'detect') detectBusy = (data.status !== 'idle');
  // 只把状态应用到"当前页"，避免别的通道的状态改动当前页 UI
  if (data.platform === currentPlatform) applyRunState();
});

// ===== 一键运行相关 =====

// 各平台检测结果缓存（platform -> results[]），用于切回页面时重渲染表格
let detectionData = {};
const DETECTION_HISTORY_KEY = 'aiCommentDetectionHistoryV1';
const DETECTION_PLATFORMS = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];

function saveDetectionHistory() {
  try {
    localStorage.setItem(DETECTION_HISTORY_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      detectionData: detectionData,
    }));
  } catch (e) {
    console.error('保存检测历史失败:', e);
  }
}

function loadDetectionHistory() {
  try {
    const raw = localStorage.getItem(DETECTION_HISTORY_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const restored = {};
    DETECTION_PLATFORMS.forEach(function (platform) {
      const list = saved && saved.detectionData && saved.detectionData[platform];
      if (Array.isArray(list)) {
        restored[platform] = list.filter(function (row) {
          return row && typeof row === 'object' && typeof row.url === 'string' && row.url;
        });
      }
    });
    detectionData = restored;
  } catch (e) {
    console.error('读取检测历史失败:', e);
    detectionData = {};
  }
}
// 正在重新检测的链接（url -> true），用于表格里显示「检测中…」
let redetectingUrls = {};
// 正在强制重新留痕的链接（url -> true）
let redetectingEvidence = {};
// 达标线（写死，与一键运行的评论数无关）：评论≥3 且 已点赞 且 已收藏
const COMPLIANCE_MIN = 3;
// 每篇文章「补跑」最多次数，到上限交人工
const MAX_FIX_RETRY = 2;
// 每篇文章已补跑次数（url -> n），独立于 detectionData，避免重测时被清掉；持久化以免刷新后丢失导致重复补跑
const RETRY_COUNTS_KEY = 'aiCommentRetryCountsV1';
let retryCounts = {};
function saveRetryCounts() {
  try { localStorage.setItem(RETRY_COUNTS_KEY, JSON.stringify(retryCounts)); } catch (e) { /* ignore */ }
}
function loadRetryCounts() {
  try { retryCounts = JSON.parse(localStorage.getItem(RETRY_COUNTS_KEY) || '{}') || {}; } catch (e) { retryCounts = {}; }
}
// 检测中心是否有操作在跑（一键检测/补跑/重测）→ 控制按钮可用性
let detectBusy = false;

// 判定单篇文章达标状态：pass / fail / unknown / invalid（404已失效，不参与补跑补测）
function rowStatus(r, platform) {
  if (r.invalid) return { status: 'invalid', missing: ['链接已失效（404/被删）'] };
  const cc = r.commentCount;
  if (cc === null || cc === undefined) return { status: 'unknown', missing: ['评论数未知'] };
  const missing = [];
  if (cc < COMPLIANCE_MIN) missing.push('缺' + (COMPLIANCE_MIN - cc) + '评论');
  if (platform === 'netease') {
    return missing.length ? { status: 'fail', missing: missing } : { status: 'pass', missing: [] };
  }
  if (r.liked === false) missing.push('缺赞');
  else if (r.liked !== true) missing.push('点赞未知');
  if (r.collected === false) missing.push('缺收藏');
  else if (r.collected !== true) missing.push('收藏未知');
  if (missing.length === 0) return { status: 'pass', missing: [] };
  const hasConcreteFail = cc < COMPLIANCE_MIN || r.liked === false || r.collected === false;
  return { status: hasConcreteFail ? 'fail' : 'unknown', missing };
}

function evidenceStatus(r) {
  const e = r && r.evidence;
  if (!e) return { status: 'unknown', label: '未生成', detail: '本次结果未返回留痕信息' };
  if (e.status === 'complete' || e.status === 'reused') return { status: 'complete', label: e.reused ? '已完成（复用）' : '已完成', detail: '' };
  if (e.status === 'partial') return { status: 'partial', label: '部分完成', detail: e.error || '仍有截图缺失' };
  if (e.status === 'failed') return { status: 'failed', label: '失败', detail: e.error || '截图保存失败' };
  if (e.status === 'skipped') return { status: 'skipped', label: '未触发', detail: e.reason || '检测未达标' };
  return { status: 'unknown', label: e.status || '未知', detail: e.error || '' };
}

// ===== 多平台并行：偏好持久化 + 每平台进度行 =====
const PARALLEL_PREF_KEY = 'aiCommentParallelV1';
const ALL_ROW_PLATFORMS = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];

// 进度状态存内存：页面节点可能处于游离状态（不在文档里），
// 直接写 DOM 会找不到元素，所以先记状态、再由 paintRow 落到 DOM。
const allRowStates = {};
let allRunMode = '';

function loadParallelPref() {
  let pref = null;
  try { pref = JSON.parse(localStorage.getItem(PARALLEL_PREF_KEY) || 'null'); } catch (e) { pref = null; }
  const enabled = !!(pref && pref.enabled);
  const lanes = (pref && [2, 3, 6].indexOf(Number(pref.lanes)) >= 0) ? String(Number(pref.lanes)) : '3';
  const cb = document.getElementById('all-parallel');
  const sel = document.getElementById('all-parallel-lanes');
  const wrap = document.getElementById('all-parallel-lanes-wrap');
  if (cb) cb.checked = enabled;
  if (sel) sel.value = lanes;
  if (wrap) wrap.style.display = enabled ? '' : 'none';
  updateParallelHint();
}

function saveParallelPref() {
  const cb = document.getElementById('all-parallel');
  const sel = document.getElementById('all-parallel-lanes');
  const enabled = !!(cb && cb.checked);
  const lanes = Number((sel && sel.value) || 3);
  try { localStorage.setItem(PARALLEL_PREF_KEY, JSON.stringify({ enabled: enabled, lanes: lanes })); } catch (e) { /* ignore */ }
}

function onParallelToggle() {
  const cb = document.getElementById('all-parallel');
  const wrap = document.getElementById('all-parallel-lanes-wrap');
  if (wrap) wrap.style.display = (cb && cb.checked) ? '' : 'none';
  saveParallelPref();
  updateParallelHint();
  updateExecModeStat();
}

// 配置页「执行模式」小卡跟随并行设置。
// 读 localStorage 而不是读开关 DOM —— 切到配置页时「一键运行」页是游离的，
// 从那里取不到 #all-parallel / #all-parallel-lanes。
function updateExecModeStat() {
  const el = document.getElementById('exec-mode-stat');
  if (!el) return;
  let pref = null;
  try { pref = JSON.parse(localStorage.getItem(PARALLEL_PREF_KEY) || 'null'); } catch (e) { pref = null; }
  el.textContent = (pref && pref.enabled) ? ('并行 ×' + (Number(pref.lanes) || 3)) : '串行';
}

function updateParallelHint() {
  const cb = document.getElementById('all-parallel');
  const sel = document.getElementById('all-parallel-lanes');
  const el = document.getElementById('all-parallel-hint');
  if (!el) return;
  if (cb && cb.checked) {
    const n = Number((sel && sel.value) || 3);
    el.innerHTML = '并行：最多同时跑 <b>' + n + '</b> 个平台，各自独立浏览器，跑完一个立刻补上下一个。'
      + '<br>注意：每个平台约占 300~600MB 内存，' + n + ' 个同时跑需 ' + (n * 0.4).toFixed(1)
      + 'GB 左右；机器吃紧时反而会因页面等待超时而变慢。';
  } else {
    el.textContent = '串行：按 知乎→头条→CSDN→搜狐→百度→网易 顺序逐个跑，一个跑完再跑下一个。';
  }
}

function setRowState(p, state, phase) {
  allRowStates[p] = { state: state, phase: phase || '' };
  paintRow(p);
  updateAllSummary();
}

function paintRow(p) {
  const st = allRowStates[p] || { state: 'idle', phase: '' };
  const row = document.getElementById('all-row-' + p);
  if (!row) return;
  const el = row.querySelector('.plat-row-state');
  if (!el) return;
  el.dataset.state = st.state;
  const prefix = st.phase ? st.phase + ' ' : '';
  if (st.state === 'running') el.innerHTML = prefix + progRunning('进行中');
  else if (st.state === 'done') el.innerHTML = progDone((st.phase || '') + '完成');
  else if (st.state === 'error') el.textContent = prefix + '失败';
  else if (st.state === 'skipped') el.textContent = '已跳过';
  else el.textContent = '未开始';
}

function paintAllRows() {
  ALL_ROW_PLATFORMS.forEach(paintRow);
  updateAllSummary();
}

function resetAllRows() {
  ALL_ROW_PLATFORMS.forEach(function (p) { allRowStates[p] = { state: 'idle', phase: '' }; });
  allRunMode = '';
  paintAllRows();
}

function updateAllSummary() {
  const el = document.getElementById('all-progress');
  if (!el) return;
  let running = 0, done = 0, failed = 0;
  ALL_ROW_PLATFORMS.forEach(function (p) {
    const st = (allRowStates[p] || {}).state;
    if (st === 'running') running++;
    else if (st === 'done') done++;
    else if (st === 'error') failed++;
  });
  if (running === 0 && done === 0 && failed === 0) { el.textContent = '尚未开始'; return; }
  const parts = [];
  if (allRunMode) parts.push(allRunMode);
  if (running) parts.push(running + ' 个进行中');
  parts.push(done + '/' + ALL_ROW_PLATFORMS.length + ' 已完成');
  if (failed) parts.push(failed + ' 个失败');
  el.innerHTML = progRunning(parts.join(' · '));
}

// 把「一键运行」页里各平台 textarea 的内容回填到 importedUrls（切走时不丢失输入）
function saveAllUrls() {
  ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].forEach(function (p) {
    const ta = document.getElementById('all-urls-' + p);
    if (ta) {
      importedUrls[p] = ta.value.trim().split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    }
  });
}

// 开始一键运行（评论全部 → 检测全部；开了多平台并行则按并发数同时跑）
async function startAll() {
  saveAllUrls();
  const tasks = [];
  ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'].forEach(function (p) {
    if ((importedUrls[p] || []).length > 0) tasks.push({ platform: p, urls: importedUrls[p].slice() });
  });
  if (tasks.length === 0) { alert('请至少为一个平台填入文章链接'); return; }

  const commentCount = parseInt(document.getElementById('all-comment-count').value, 10);
  if (!Number.isFinite(commentCount) || commentCount < 1 || commentCount > 10) {
    alert('请填写每篇文章评论数（1~10）');
    return;
  }
  const enableDetection = document.getElementById('all-enable-detect').checked;

  // 多平台并行：开启时按所选并发数同时跑（上限不超过实际平台数）
  const parallelCb = document.getElementById('all-parallel');
  const lanesSel = document.getElementById('all-parallel-lanes');
  const parallelOn = !!(parallelCb && parallelCb.checked);
  const concurrency = parallelOn ? Math.min(Number((lanesSel && lanesSel.value) || 3), tasks.length) : 1;
  allRunMode = concurrency > 1 ? ('并行 · 并发 ' + concurrency) : '串行';

  // 重置界面
  clearLogPanel('agg');
  const res = document.getElementById('detect-results');
  if (res) res.innerHTML = '';
  resetAllRows();
  const prog = document.getElementById('all-progress');
  if (prog) prog.innerHTML = progRunning(allRunMode + ' · 准备启动');

  setRunState('all', 'running');

  try {
    const r = await fetch('/api/start-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks, commentCount: commentCount, enableDetection: enableDetection, concurrency: concurrency })
    });
    const data = await r.json();
    if (data.success) {
      addLog('success', '[系统] ' + data.message);
    } else {
      addLog('error', '[错误] ' + data.error);
      setRunState('all', 'idle');
    }
  } catch (e) {
    addLog('error', '[错误] 启动失败: ' + e.message);
    setRunState('all', 'idle');
  }
}

// 停止一键运行
async function stopAll() {
  try {
    const r = await fetch('/api/stop-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await r.json();
    if (data.success) { setRunState('all', 'idle'); addLog('info', '[系统] ' + data.message); }
    else addLog('error', '[错误] ' + data.error);
  } catch (e) {
    addLog('error', '[错误] 停止失败: ' + e.message);
  }
}

// 渲染检测结果表（汇总所有已返回的平台）+ 达标汇总 + 按钮 state
function renderDetectionTable() {
  const root = document.getElementById('detect-results');
  if (!root) return;
  const platforms = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];
  let rows = '';
  let total = 0, passN = 0, failN = 0, unknownN = 0, invalidN = 0, fixableN = 0, refailN = 0;
  let evidenceCompleteN = 0, evidenceIncompleteN = 0;
  let any = false;

  platforms.forEach(function (p) {
    const list = detectionData[p];
    if (!list || list.length === 0) return;
    any = true;
    list.forEach(function (r) {
      any = true;
      total++;
      const st = rowStatus(r, p);
      const ev = evidenceStatus(r);
      if (st.status === 'pass') passN++;
      else if (st.status === 'fail') failN++;
      else if (st.status === 'invalid') invalidN++;
      else unknownN++;
      if (ev.status === 'complete') evidenceCompleteN++;
      else if (st.status === 'pass') evidenceIncompleteN++;
      const retries = retryCounts[r.url] || 0;
      if (st.status === 'fail' && retries < MAX_FIX_RETRY) fixableN++;
      // 重测只针对 fail/unknown，已失效(pass/invalid)不参与
      if (st.status === 'fail' || st.status === 'unknown') refailN++;

      const cmt = (r.commentCount === null || r.commentCount === undefined) ? '<span class="detect-unk">未知</span>' : (r.commentCount + ' 条');
      const plat = PLATFORM_LABELS[p] || p;
      const err = r.error ? '<div class="detect-err">' + escapeHtml(r.error) + '</div>' : '';
      const warning = r.warning ? '<div class="detect-missing">' + escapeHtml(r.warning) + '</div>' : '';

      // 文章列：可点击 URL（系统浏览器打开），CSS 截断 + 悬停看全
      const url = r.url || '';
      const link = url
        ? '<a class="detect-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener" title="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a>'
        : '<span class="detect-unk">无</span>';

      // 达标列
      let badge;
      if (st.status === 'invalid') {
        badge = '<span class="badge badge-invalid">' + ic('link-2-off') + '已失效</span><div class="detect-missing">404/被删，已排除补跑补测</div>';
      } else if (st.status === 'pass') {
        badge = '<span class="badge badge-pass">' + ic('circle-check') + '达标</span>';
      } else if (st.status === 'fail') {
        const cap = retries >= MAX_FIX_RETRY ? ' <span class="badge badge-cap">已达上限·人工</span>' : '';
        badge = '<span class="badge badge-fail">' + ic('circle-alert') + '不达标</span>' + cap + '<div class="detect-missing">' + st.missing.join(' · ') + '</div>';
      } else {
        badge = '<span class="badge badge-unknown">' + ic('info') + '待核对</span><div class="detect-missing">' + st.missing.join(' · ') + '</div>';
      }

      let evidenceBadge;
      if (ev.status === 'complete') {
        evidenceBadge = '<span class="badge badge-evidence-ok">' + ev.label + '</span>';
      } else if (ev.status === 'partial' || ev.status === 'failed') {
        evidenceBadge = '<span class="badge badge-evidence-warn">' + ev.label + '</span>'
          + (ev.detail ? '<div class="detect-missing">' + escapeHtml(ev.detail) + '</div>' : '');
      } else if (ev.status === 'skipped') {
        evidenceBadge = '<span class="badge badge-evidence-skip">' + ev.label + '</span>';
      } else {
        evidenceBadge = '<span class="detect-unk">' + ev.label + '</span>';
      }
      const evidencePath = r.evidence && r.evidence.directory ? r.evidence.directory : '';
      if (evidencePath) {
        evidenceBadge += '<button class="btn-mini" title="打开留痕目录" onclick=\'openEvidenceDir(' + JSON.stringify(evidencePath) + ')\'>打开目录</button>';
      }

      // 操作列（已失效的文章也能手动重新检测，确认是否真的没了）
      let action;
      if (redetectingUrls[r.url] || redetectingEvidence[r.url]) {
        action = '<span class="detect-unk">检测中…</span>';
      } else {
        action = "<button class=\"btn-mini\" onclick='redetect(" + JSON.stringify(p) + ", " + JSON.stringify(r.url) + ")'>重新检测</button>";
        if (st.status === 'pass') {
          action += " <button class=\"btn-mini\" onclick='redetectEvidence(" + JSON.stringify(p) + ", " + JSON.stringify(r.url) + ")'>重新留痕</button>";
        }
      }

      const rowCls = st.status === 'invalid' ? ' class="row-invalid"'
        : st.status === 'fail' ? ' class="row-fail"'
        : st.status === 'unknown' ? ' class="row-unknown"' : '';
      rows += '<tr' + rowCls + '><td>' + plat + '</td>'
        + '<td class="detect-url">' + link + err + warning + '</td>'
        + '<td>' + cmt + '</td>'
        + '<td>' + fmtFlag(r.liked, p) + '</td>'
        + '<td>' + fmtFlag(r.collected, p) + '</td>'
        + '<td class="detect-status">' + badge + '</td>'
        + '<td class="detect-evidence">' + evidenceBadge + '</td>'
        + '<td class="detect-actions">' + action + '</td></tr>';
    });
  });

  // 更新达标操作条（即使没在检测页也安全：元素不存在就跳过）
  const fixBtn = document.getElementById('fix-btn');
  const refailBtn = document.getElementById('refail-btn');
  const fixTitle = document.getElementById('fix-bar-title');
  if (fixBtn) {
    fixBtn.innerHTML = ic('wrench') + '补跑不达标项' + (fixableN ? ' (' + fixableN + ')' : '');
    fixBtn.disabled = detectBusy || fixableN === 0;
  }
  if (refailBtn) {
    refailBtn.innerHTML = ic('refresh-cw') + '重测未达标项' + (refailN ? ' (' + refailN + ')' : '');
    refailBtn.disabled = detectBusy || refailN === 0;
  }
  if (fixTitle) {
    fixTitle.textContent = !any ? '达标操作'
      : fixableN ? fixableN + ' 篇不达标可补跑'
      : failN ? failN + ' 篇不达标已达补跑上限，请人工处理'
      : refailN ? refailN + ' 篇待核对，可重测'
      : '全部已达标';
  }

  const summaryEl = document.getElementById('detect-summary');
  if (!any) {
    if (summaryEl) summaryEl.innerHTML = '';
    root.innerHTML = '<div class="empty-state">' + ic('inbox') + '<div>暂无检测结果。粘贴链接后点「一键检测」，或在一键运行完成后查看自动检测结果。</div></div>';
    return;
  }

  const summary = '<span class="badge-total">共 ' + total + ' 篇</span>'
    + '<span class="badge-pass">达标 ' + passN + '</span>'
    + '<span class="badge-fail">不达标 ' + failN + '</span>'
    + '<span class="badge-unknown">待核对 ' + unknownN + '</span>'
    + (invalidN ? '<span class="badge-invalid">已失效 ' + invalidN + '</span>' : '')
    + '<span class="badge-evidence-ok">留痕完成 ' + evidenceCompleteN + '</span>'
    + (evidenceIncompleteN ? '<span class="badge-evidence-warn">达标但留痕未完整 ' + evidenceIncompleteN + '</span>' : '');
  if (summaryEl) summaryEl.innerHTML = summary;

  root.innerHTML = '<div class="table-wrap"><table class="detect-table"><thead><tr><th>平台</th><th>文章链接</th><th>我的评论</th><th>点赞</th><th>收藏</th><th>达标</th><th>留痕</th><th>操作</th></tr></thead><tbody>'
    + rows + '</tbody></table></div>';
}

function fmtFlag(v, platform) {
  if (platform === 'netease') return '<span class="detect-unk" title="不适用">' + ic('minus') + '</span>';
  if (v === null || v === undefined) return '<span class="detect-unk" title="未知">' + ic('minus') + '</span>';
  return v ? '<span class="detect-ok" title="是">' + ic('check') + '</span>' : '<span class="detect-no" title="否">' + ic('x') + '</span>';
}

function shortUrl(u) {
  try { const x = new URL(u); return x.hostname + x.pathname; } catch (e) { return u || ''; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ===== 检测中心相关 =====

// 实时分类粘贴的链接（有效 / 各平台数 / 去重 / 无效）
function updateDetectClassify() {
  const ta = document.getElementById('detect-textarea');
  const box = document.getElementById('detect-classify');
  if (!ta || !box) return;
  const urls = extractUrls(ta.value);
  const counts = { zhihu: 0, toutiao: 0, csdn: 0, sohu: 0, baidu: 0, netease: 0, unknown: 0 };
  const seen = {};
  let dup = 0, valid = 0;
  urls.forEach(function (u) {
    const p = classifyUrl(u);
    if (p === 'unknown') { counts.unknown++; return; }
    if (seen[u]) { dup++; return; }
    seen[u] = 1; counts[p]++; valid++;
  });
  let html = '<span class="ctag ctag-ok">有效 ' + valid + '</span>';
  DETECTION_PLATFORMS.forEach(function (p) {
    if (counts[p]) html += '<span class="ctag">' + PLATFORM_LABELS[p] + ' ' + counts[p] + '</span>';
  });
  if (dup) html += '<span class="ctag ctag-warn">已去重 ' + dup + '</span>';
  if (counts.unknown) html += '<span class="ctag ctag-err">无效 ' + counts.unknown + '</span>';
  box.innerHTML = html;
}

// 把粘贴的链接按平台分组（排除 unknown / 重复）
function groupDetectUrls() {
  const ta = document.getElementById('detect-textarea');
  if (!ta) return [];
  const urls = extractUrls(ta.value);
  const groups = {};
  const seen = {};
  urls.forEach(function (u) {
    const p = classifyUrl(u);
    if (p === 'unknown' || seen[u]) return;
    seen[u] = 1;
    if (!groups[p]) groups[p] = [];
    groups[p].push(u);
  });
  return Object.keys(groups).map(function (p) { return { platform: p, urls: groups[p] }; });
}

// 一键检测
// 一键检测
async function startDetect() {
  const tasks = groupDetectUrls();
  if (tasks.length === 0) { alert('没有可检测的有效链接（仅支持知乎 / 头条 / CSDN / 搜狐 / 百度 / 网易）'); return; }

  clearLogPanel('agg');
  const prog = document.getElementById('detect-progress');
  if (prog) prog.innerHTML = progRunning('准备启动');
  redetectingUrls = {};
  retryCounts = {};
  saveRetryCounts();
  renderDetectionTable();
  updateStatus('running', '检测中');

  try {
    const r = await fetch('/api/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks })
    });
    const data = await r.json();
    if (data.success) { addLog('success', '[系统] ' + data.message); setDetectBusy(true); }
    else { addLog('error', '[错误] ' + data.error); updateStatus('idle', '就绪'); }
  } catch (e) {
    addLog('error', '[错误] 启动失败: ' + e.message);
    updateStatus('idle', '就绪');
  }
}

// 停止（一键检测 / 补跑 一起发停止，服务端各自按需 no-op）
async function stopDetect() {
  try {
    await fetch('/api/fix-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const r = await fetch('/api/detect-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (data.success) addLog('info', '[系统] ' + data.message);
  } catch (e) { addLog('error', '[错误] 停止失败: ' + e.message); }
}

// 检测中心操作在跑/结束 → 切换按钮
function setDetectBusy(busy) {
  detectBusy = busy;
  runStates.detect = busy ? 'running' : 'idle';
  if (currentPlatform !== 'detect') return; // 不在检测页时只记状态，不动 UI
  applyDetectButtons(busy);
  renderDetectionTable(); // fix/refail 按 detectBusy + 计数重算
  updateStatus(busy ? 'running' : 'idle', busy ? '运行中' : '就绪');
}

// 补跑不达标项：把"不达标且重试<2"的文章按 (平台, 缺口) 分组发给 /api/fix
async function startFix() {
  if (detectBusy) return;
  const groups = {}; // key = platform|deficit
  const sentUrls = [];
  DETECTION_PLATFORMS.forEach(function (p) {
    (detectionData[p] || []).forEach(function (r) {
      if (rowStatus(r, p).status !== 'fail') return;
      if ((retryCounts[r.url] || 0) >= MAX_FIX_RETRY) return;
      const cc = (r.commentCount === null || r.commentCount === undefined) ? COMPLIANCE_MIN : r.commentCount;
      const deficit = Math.max(0, COMPLIANCE_MIN - cc);
      const key = p + '|' + deficit;
      if (!groups[key]) groups[key] = { platform: p, count: deficit, urls: [] };
      groups[key].urls.push(r.url);
      sentUrls.push(r.url);
    });
  });
  if (sentUrls.length === 0) { alert('没有可补跑的不达标文章（可能都已达到重试上限，请人工处理）'); return; }
  const tasks = Object.keys(groups).map(function (k) { return groups[k]; });

  // 立即计入重试次数（避免补跑期间重复提交）
  sentUrls.forEach(function (u) { retryCounts[u] = (retryCounts[u] || 0) + 1; });
  saveRetryCounts();
  addLog('info', '[系统] 补跑 ' + sentUrls.length + ' 篇不达标文章（' + tasks.length + ' 个任务）');
  setDetectBusy(true);
  updateStatus('running', '补跑中');

  try {
    const r = await fetch('/api/fix', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks })
    });
    const data = await r.json();
    if (!data.success) {
      sentUrls.forEach(function (u) { retryCounts[u] = Math.max(0, (retryCounts[u] || 0) - 1); }); // 回退
      saveRetryCounts();
      addLog('error', '[错误] ' + data.error);
      setDetectBusy(false);
    }
  } catch (e) {
    sentUrls.forEach(function (u) { retryCounts[u] = Math.max(0, (retryCounts[u] || 0) - 1); });
    saveRetryCounts();
    addLog('error', '[错误] 补跑启动失败: ' + e.message);
    setDetectBusy(false);
  }
}

// 重测未达标项：重新检测所有"非达标"行（fail + unknown），merge 保留已达标行
async function redetectFailed() {
  if (detectBusy) return;
  const groups = {};
  DETECTION_PLATFORMS.forEach(function (p) {
    (detectionData[p] || []).forEach(function (r) {
      const st = rowStatus(r, p).status;
      if (st === 'pass' || st === 'invalid') return; // 达标 / 已失效 都不重测
      if (!groups[p]) groups[p] = { platform: p, urls: [] };
      groups[p].urls.push(r.url);
    });
  });
  const tasks = Object.keys(groups).map(function (k) { return groups[k]; });
  if (tasks.length === 0) { alert('没有需要重测的未达标文章（已失效的文章已排除）'); return; }

  addLog('info', '[系统] 重测未达标项');
  setDetectBusy(true);
  updateStatus('running', '重测中');

  try {
    const r = await fetch('/api/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks, merge: true })
    });
    const data = await r.json();
    if (!data.success) { addLog('error', '[错误] ' + data.error); setDetectBusy(false); }
  } catch (e) {
    addLog('error', '[错误] 重测启动失败: ' + e.message);
    setDetectBusy(false);
  }
}

// 单链接重新检测（结果表里的「重新检测」按钮）
async function redetect(platform, url) {
  if (redetectingUrls[url]) return;
  try {
    const r = await fetch('/api/detect-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: platform, url: url })
    });
    const data = await r.json();
    if (data.success) {
      redetectingUrls[url] = true;
      renderDetectionTable();
      addLog('info', '[系统] 重新检测：' + url);
    } else {
      addLog('error', '[错误] ' + data.error);
    }
  } catch (e) {
    addLog('error', '[错误] 重新检测失败: ' + e.message);
  }
}

// 达标文章重新截图：服务端会先重新检测，仍达标后才原子替换旧截图。
async function redetectEvidence(platform, url) {
  if (redetectingEvidence[url]) return;
  try {
    const r = await fetch('/api/detect-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: platform, url: url, forceEvidence: true })
    });
    const data = await r.json();
    if (data.success) {
      redetectingEvidence[url] = true;
      renderDetectionTable();
      addLog('info', '[系统] 重新检测并留痕：' + url);
    } else {
      addLog('error', '[错误] ' + data.error);
    }
  } catch (e) { addLog('error', '[错误] 重新留痕失败: ' + e.message); }
}

async function openEvidenceDir(dir) {
  try {
    const r = await fetch('/api/evidence/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: dir || '' })
    });
    const data = await r.json();
    if (!data.success) { addLog('error', '[错误] ' + data.error); return; }
    // 纯浏览器模式不启动资源管理器，直接显示完整路径
    if (!window.electronAPI || data.browserMode) addLog('success', '[系统] 留痕目录：' + data.path);
  } catch (e) { addLog('error', '[错误] 打开留痕目录失败: ' + e.message); }
}

// 导出检测结果为 CSV
function exportDetectCsv() {
  const platforms = DETECTION_PLATFORMS;
  const rows = [['平台', '链接', '标题', '我的评论', '点赞', '收藏', '状态', '留痕状态', '留痕目录', '点赞收藏截图', '评论1截图', '评论2截图', '评论3截图', '留痕错误']];
  let any = false;
  platforms.forEach(function (p) {
    (detectionData[p] || []).forEach(function (r) {
      any = true;
      const cmt = (r.commentCount === null || r.commentCount === undefined) ? '未知' : r.commentCount;
      const like = p === 'netease' ? '不适用' : ((r.liked === null || r.liked === undefined) ? '未知' : (r.liked ? '是' : '否'));
      const col = p === 'netease' ? '不适用' : ((r.collected === null || r.collected === undefined) ? '未知' : (r.collected ? '是' : '否'));
      const st = r.error ? ('失败: ' + r.error) : '成功';
      const ev = evidenceStatus(r);
      const e = r.evidence || {};
      const shots = e.screenshots || {};
      const commentShots = Array.isArray(shots.comments) ? shots.comments : [];
      rows.push([
        PLATFORM_LABELS[p] || p,
        r.url,
        r.title || '',
        cmt,
        like,
        col,
        st,
        ev.label,
        e.directory || '',
        shots.likeCollect?.path || '',
        commentShots[0]?.path || '',
        commentShots[1]?.path || '',
        commentShots[2]?.path || '',
        ev.detail || e.error || '',
      ]);
    });
  });
  if (!any) { alert('暂无检测结果可导出'); return; }
  const csv = rows.map(function (row) {
    return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '检测结果_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function openClearDetectModal() {
  if (detectBusy) return;
  const modal = document.getElementById('clear-detect-modal');
  if (modal) modal.style.display = 'flex';
}

function closeClearDetectModal() {
  const modal = document.getElementById('clear-detect-modal');
  if (modal) modal.style.display = 'none';
}

// 只清除检测历史，不删除已经生成的留痕截图。
function confirmClearDetect() {
  detectionData = {};
  redetectingUrls = {};
  redetectingEvidence = {};
  retryCounts = {};
  try { localStorage.removeItem(DETECTION_HISTORY_KEY); localStorage.removeItem(RETRY_COUNTS_KEY); } catch (e) { /* ignore */ }
  renderDetectionTable();
  const prog = document.getElementById('detect-progress');
  if (prog) prog.textContent = '';
  closeClearDetectModal();
}

// ===== 批量导入相关 =====

// 从文本中提取所有 http(s) 链接
function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s,，;；)）\]]+/gi) || [];
  return matches.map(u => u.trim());
}

// 按文章 URL 路径分类（只认文章页，过滤平台首页/后台等）
function classifyUrl(url) {
  const u = url.toLowerCase();
  if (/zhuanlan\.zhihu\.com\/p\//.test(u) || /zhihu\.com\/p\//.test(u)) return 'zhihu';
  // 头条有两种文章路径：/article/<id>/（网页端）与 /item/<id>/（App / 头条号后台分享出来的）
  if (/toutiao\.com\/(?:article|item)\//.test(u)) return 'toutiao';
  if (/csdn\.net\/[^/]*\/article\/details\//.test(u)) return 'csdn';
  if (/sohu\.com\/a\//.test(u)) return 'sohu';
  if (/baijiahao\.baidu\.com\/s\?id=/.test(u)) return 'baidu';
  if (/(?:^|\.)163\.com\/.*\/article\/[a-z0-9_-]+\.html(?:[?#]|$)/.test(u)) return 'netease';
  return 'unknown';
}

// 分类并回填（从 textarea 读取）
function classifyAndFill() {
  const text = (document.getElementById('import-textarea') || {}).value || '';
  if (!text.trim()) {
    alert('请先粘贴链接或上传文件');
    return;
  }
  const urls = extractUrls(text);
  if (urls.length === 0) {
    alert('未找到有效链接（需以 http 开头）');
    return;
  }
  doClassify(urls);
}

// 处理 Excel/CSV 文件上传
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const allText = [];
      workbook.SheetNames.forEach(function(sheetName) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        allText.push(csv);
      });
      const combined = allText.join('\n');
      const ta = document.getElementById('import-textarea');
      const existing = ta.value.trim();
      ta.value = existing ? (existing + '\n' + combined) : combined;
      const count = extractUrls(ta.value).length;
      document.getElementById('file-name-display').textContent = '已加载 ' + file.name + '（共 ' + count + ' 条链接）';
    } catch (err) {
      alert('读取文件失败: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// 执行分类并回填
function doClassify(urls) {
  Object.keys(importedUrls).forEach(function(k) { importedUrls[k] = []; });
  const seen = {};
  urls.forEach(function(url) {
    if (seen[url]) return;
    seen[url] = true;
    const p = classifyUrl(url);
    importedUrls[p].push(url);
  });
  renderImportResult();
  applyImportedUrls();
}

// 渲染分类结果
function renderImportResult() {
  const card = document.getElementById('import-result-card');
  if (!card) return;
  const content = document.getElementById('import-result-content');

  const platforms = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease', 'unknown'];
  const total = platforms.reduce(function(s, p) { return s + (importedUrls[p] || []).length; }, 0);

  const totalEl = document.getElementById('import-result-total');
  if (totalEl) totalEl.textContent = '共 ' + total + ' 条链接';

  let html = '<div class="import-result-grid">';
  platforms.forEach(function(p) {
    const list = importedUrls[p] || [];
    let cls = 'import-stat';
    if (list.length === 0) cls += ' empty';
    if (p === 'unknown') cls += ' unknown';
    const click = p === 'unknown' ? '' : ('onclick="switchPlatform(\'' + p + '\')"');
    html += '<div class="' + cls + '" ' + click + '><div class="count">' + list.length + '</div><div class="label">' + PLATFORM_LABELS[p] + '</div></div>';
  });
  html += '</div>';
  html += '<div class="hint-text">点击任意平台卡片可跳转到该平台页查看已回填的链接</div>';

  if ((importedUrls.unknown || []).length > 0) {
    html += '<div class="detect-err" style="margin-top:16px;font-weight:500;">未识别链接：</div>';
    html += '<div style="font-size:12px;color:var(--ink-3);margin-top:8px;max-height:120px;overflow-y:auto;background:var(--surface-2);padding:10px;border-radius:8px;">';
    importedUrls.unknown.forEach(function(u) { html += '<div style="margin-bottom:2px;word-break:break-all;">' + u + '</div>'; });
    html += '</div>';
  }

  card.style.display = 'block';
  content.innerHTML = html;
  renderSidebar(); // 刷新侧栏平台徽标（链接条数）
}

// 点击结果卡片跳转到对应平台
function switchPlatform(platform) {
  const item = document.querySelector('.platform-item[data-platform="' + platform + '"]');
  if (item) item.click();
}

// 清空导入内容
function clearImported() {
  Object.keys(importedUrls).forEach(function(k) { importedUrls[k] = []; });
  const ta = document.getElementById('import-textarea');
  if (ta) ta.value = '';
  const fn = document.getElementById('file-name-display');
  if (fn) fn.textContent = '未选择任何文件';
  const fi = document.getElementById('import-file');
  if (fi) fi.value = '';
  const card = document.getElementById('import-result-card');
  if (card) card.style.display = 'none';
  // 已缓存的页面节点不会自己重读 importedUrls，这里显式清空它们的链接框
  applyImportedUrls();
}

// 导入完成后，把链接回填到「已经建好并缓存」的页面节点里。
// 页面是建一次就缓存的，不会因为切页重新读 importedUrls，所以导入后必须显式回填；
// 否则用户先访问过某平台页、再导入链接，那个页面不会更新。
function applyImportedUrls() {
  const platforms = ['zhihu', 'toutiao', 'csdn', 'sohu', 'baidu', 'netease'];
  platforms.forEach(function (p) {
    const list = (importedUrls[p] || []).join('\n');
    const own = pageCache[p];
    if (own) { const ta = own.querySelector('#article-urls'); if (ta) ta.value = list; }
    const allNode = pageCache.all;
    if (allNode) { const ta = allNode.querySelector('#all-urls-' + p); if (ta) ta.value = list; }
  });
}

// 页面加载时先恢复检测历史，再渲染导航和首页。
loadDetectionHistory();
loadRetryCounts();
const brandMark = document.getElementById('brand-mark');
if (brandMark) brandMark.innerHTML = ic('message-square-text');
const engineIcon = document.getElementById('engine-icon');
if (engineIcon) engineIcon.innerHTML = ic('server');
updateEngineStatus(!!socket.connected);
socket.on('connect', () => updateEngineStatus(true));
socket.on('disconnect', () => updateEngineStatus(false));
renderSidebar();
document.getElementById('page-subtitle').textContent = platformSubtitles.config;
renderContent('config');
// 拉一次服务端状态：覆盖「浏览器刷新后 runStates 被清空」的情况
// （Electron 里是 Ctrl+R / F5；任务仍在后台跑，按钮应显示为运行中）
loadRunStates();
// 侧栏版本号同样从服务端取，避免 HTML 里硬编码的版本号与 package.json 漂移
loadAppVersion();

// ===== 无边框窗口：自绘标题栏按钮 =====
(function initTitlebar() {
  const api = window.electronAPI;
  if (!api) {
    // 浏览器模式（非 Electron）：隐藏自绘标题栏，用系统标签页的边框
    document.body.classList.add('browser-mode');
    return;
  }
  const min = document.getElementById('tb-min');
  const max = document.getElementById('tb-max');
  const closeBtn = document.getElementById('tb-close');
  if (min) min.addEventListener('click', () => api.minimize());
  if (max) max.addEventListener('click', () => api.toggleMaximize());
  if (closeBtn) closeBtn.addEventListener('click', () => api.close());
})();
