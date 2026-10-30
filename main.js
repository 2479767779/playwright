// Electron 主进程：启动内置 server（fork，用 Electron 自身当 node），开独立窗口加载页面。
// 用户看到的是独立桌面客户端窗口，不碰系统浏览器、不输入 localhost。
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;

// 内置服务端口。
// 原来固定 3000，这个端口太常见（各种本地 dev server 默认都是它），
// 用户机器上只要别的程序占着，本应用就会「启动超时」打不开。
// 现在改成不常用的 27188，并且被占用时自动往后顺延（27188–27197）。
// 想固定成别的端口：设环境变量 AI_COMMENT_PORT 即可。
const BASE_PORT = Number(process.env.AI_COMMENT_PORT) || 27188;
const PORT_SCAN_COUNT = 10;
let activePort = BASE_PORT;

// chromium 路径：必须在 fork 任何子进程之前设到环境变量
// patchright 会在该路径下自动补 chromium-<revision>/ 子目录，所以这里只给到 resources
// （打包后 chromium 随包在 resources/chromium-1228/，由 extraResources 放置）
if (app.isPackaged) {
  process.env.PATCHRIGHT_BROWSERS_PATH = process.resourcesPath;
} else {
  process.env.PATCHRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(__dirname, 'pw-browsers');
}

// 单实例锁：避免重复打开多个实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 探测端口是否可绑：先真的绑一次再释放，比「看有没有进程连得上」可靠
// （有些程序绑的是 0.0.0.0 或 ::1，单纯 connect 127.0.0.1 测不出来）
const { pickPort } = require('./port-utils');

// fork 启动内置 server（Electron 自身当 node，无需用户装 Node）
function startServer(port) {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'server.js')
    : path.join(__dirname, 'server.js');

  serverProcess = fork(serverPath, [], {
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      APP_USER_DATA: app.getPath('userData'),
      APP_INSTALL_DIR: app.isPackaged ? path.dirname(process.execPath) : __dirname,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PATCHRIGHT_BROWSERS_PATH,
      PORT: String(port)
    },
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });

  serverProcess.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', (d) => console.error('[server:err]', d.toString().trim()));
  serverProcess.on('exit', (code) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('服务异常', `内置服务已停止（退出码 ${code}）。请重启应用。`);
    }
  });
}

// 轮询端口，真正 listen 后再开窗（替代固定 setTimeout）
function waitForServer(port, cb, tries) {
  tries = tries || 0;
  const sock = net.connect({ port, host: '127.0.0.1' }, () => {
    sock.end();
    cb(true);
  });
  sock.on('error', () => {
    if (tries > 120) return cb(false); // ~60s 超时
    setTimeout(() => waitForServer(port, cb, tries + 1), 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'AI评论助手',
    icon: path.join(__dirname, 'public', 'icon.ico'),
    frame: false,            // 无边框：去掉系统标题栏，前端自绘顶栏
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 自绘标题栏的窗口控制（来自 preload 注入的 ipcRenderer）
  const winControls = (cmd) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (cmd === 'min') mainWindow.minimize();
    else if (cmd === 'max') { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); }
    else if (cmd === 'close') mainWindow.close();
  };
  ipcMain.on('win-control', (e, cmd) => winControls(cmd));

  Menu.setApplicationMenu(null); // 去掉默认菜单栏
  mainWindow.loadURL(`http://127.0.0.1:${activePort}`);

  // 文章链接（target=_blank）等外部链接 → 用系统默认浏览器打开（在那儿手动登录操作），
  // 而不是在 app 内部开新窗口。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const port = await pickPort(BASE_PORT, PORT_SCAN_COUNT);
  if (!port) {
    dialog.showErrorBox('启动失败', `端口 ${BASE_PORT}–${BASE_PORT + PORT_SCAN_COUNT - 1} 全部被占用，无法启动内置服务。\n\n请关掉占用这些端口的程序后重试，或设置环境变量 AI_COMMENT_PORT 指定别的端口。`);
    app.quit();
    return;
  }
  activePort = port;
  if (port !== BASE_PORT) console.log(`[main] 端口 ${BASE_PORT} 被占用，改用 ${port}`);
  startServer(port);
  waitForServer(port, (ok) => {
    if (ok) {
      createWindow();
    } else {
      dialog.showErrorBox('启动失败', `内置服务启动超时（端口 ${port}）。请重启应用；若反复出现，请检查安全软件是否拦截了本程序。`);
      app.quit();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) { try { serverProcess.kill(); } catch (e) { /* ignore */ } }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) { try { serverProcess.kill(); } catch (e) { /* ignore */ } }
});
