const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell, powerMonitor, Notification } = require('electron');
const { BridgeClient, loadConfig, saveConfig, pair, deviceAuth, DEFAULT_SERVER } = require('./bridge-core');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let bridgeWindow = null;
let tray = null;
let bridgeClient = null;
let bridgeStatus = 'not paired';
const bridgeLog = [];
let pendingConnect = null; // { code, url, controller } while waiting for browser approval
// Opened at login: stay in the menu bar, no window.
function launchedAtLogin() {
  if (process.argv.includes('--hidden')) return true;
  if (process.platform !== 'darwin') return false;
  const s = app.getLoginItemSettings();
  return Boolean(s.wasOpenedAtLogin || s.wasOpenedAsHidden);
}
let daemonProcess = null;
const DAEMON_PORT = process.env.SHAZAM_PORT || 4040;
const CWD = process.cwd();

// Auto-generate or read desktop session token
function getOrCreateToken() {
  const tokenFile = path.join(CWD, '.shazam-token');
  if (fs.existsSync(tokenFile)) {
    try {
      const saved = fs.readFileSync(tokenFile, 'utf8').trim();
      if (saved.length >= 16) return saved;
    } catch {}
  }
  const crypto = require('crypto');
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  } catch {}
  return token;
}

const DAEMON_TOKEN = getOrCreateToken();

// Start the companion daemon automatically in the background
function startBackgroundDaemon() {
  const daemonScript = path.join(__dirname, '..', 'cli', 'index.js');
  if (!fs.existsSync(daemonScript)) {
    console.error('Companion daemon script not found at:', daemonScript);
    return;
  }

  daemonProcess = spawn(process.execPath, [daemonScript], {
    cwd: CWD,
    env: {
      ...process.env,
      SHAZAM_PORT: String(DAEMON_PORT),
      SHAZAM_TOKEN: DAEMON_TOKEN,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'pipe',
  });

  daemonProcess.stdout.on('data', (d) => {
    // optional debug logging
  });

  daemonProcess.stderr.on('data', (d) => {
    console.error('[Daemon Error]', d.toString());
  });

  daemonProcess.on('exit', (code) => {
    console.log('[Daemon Exited]', code);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    title: 'Arcwork Studio',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0a0c10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Target URL: Local dev server if active, otherwise production worker
  const targetUrl = process.env.SHAZAM_DESKTOP_URL || `${loadConfig().server || DEFAULT_SERVER}/agent`;

  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-daemon-config', () => {
  return {
    port: DAEMON_PORT,
    token: DAEMON_TOKEN,
    cwd: CWD,
  };
});

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Directory to Bind with Arcwork',
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});


// ---------------------------------------------------------------------------
// Arcwork Bridge: outbound connection that lets cloud agents act on this computer
// ---------------------------------------------------------------------------

function pushBridgeState() {
  const cfg = loadConfig();
  const state = {
    status: bridgeStatus,
    server: cfg.server,
    paired: Boolean(cfg.token),
    account: cfg.account || null,
    deviceName: cfg.deviceName,
    workspaces: cfg.workspaces || [],
    connecting: pendingConnect ? { code: pendingConnect.code, url: pendingConnect.url } : null,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    log: bridgeLog.slice(-80),
  };
  if (bridgeWindow && !bridgeWindow.isDestroyed()) bridgeWindow.webContents.send('bridge-state', state);
  updateTray(state);
  return state;
}

function logBridge(line) {
  bridgeLog.push(`${new Date().toLocaleTimeString()}  ${line}`);
  if (bridgeLog.length > 300) bridgeLog.shift();
  pushBridgeState();
}

/** Shows a native dialog in front of everything, even when no window is open. */
async function nativeAsk(options) {
  if (process.platform === 'darwin') app.focus({ steal: true });
  const parent = bridgeWindow && !bridgeWindow.isDestroyed() ? bridgeWindow : mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return response;
}

async function approveRisky(summary, detail, opts = {}) {
  const buttons = opts.canRemember ? ['Deny', 'Allow once', opts.rememberLabel || 'Always allow in this folder'] : ['Deny', 'Allow once'];
  const response = await nativeAsk({ type: 'warning', buttons, defaultId: 0, cancelId: 0, title: 'Arcwork wants to run a command', message: summary, detail });
  logBridge(response === 2 ? `approved and remembered: ${detail.split('\n')[0]}` : response === 1 ? `approved: ${detail.split('\n')[0]}` : `denied: ${detail.split('\n')[0]}`);
  return response === 2 ? 'always' : response === 1;
}

/** On-demand consent: a task needs a folder that isn't allowed yet. */
async function approveFolder(folder, reason) {
  const response = await nativeAsk({
    type: 'question',
    buttons: ["Don't allow", 'Allow'],
    defaultId: 0,
    cancelId: 0,
    title: 'Arcwork',
    message: `Allow Arcwork to work in “${path.basename(folder)}”?`,
    detail: `${folder}\n\n${reason || 'An Arcwork task wants to work in this folder.'}\n\nAgents can run commands and edit files there. Risky commands still ask you first. You can remove it any time in Arcwork Bridge.`,
  });
  return response === 1;
}

function startBridge() {
  const cfg = loadConfig();
  if (!cfg.token) {
    bridgeStatus = 'not paired';
    pushBridgeState();
    return;
  }
  if (bridgeClient) bridgeClient.stop();
  bridgeClient = new BridgeClient({
    config: cfg,
    approve: approveRisky,
    approveFolder,
    log: logBridge,
    onStatus: (s) => {
      if (s === 'revoked' && Notification.isSupported()) new Notification({ title: 'Arcwork', body: 'This computer was disconnected from Arcwork. Click Connect to link it again.' }).show();
      bridgeStatus = s;
      pushBridgeState();
    },
  });
  bridgeClient.start().catch((err) => logBridge(`bridge stopped: ${err.message}`));
}

/** Browser sign-in: opens Arcwork to approve this computer; no code to copy. */
async function connectWithBrowser() {
  if (pendingConnect) {
    shell.openExternal(pendingConnect.url);
    return pushBridgeState();
  }
  const controller = new AbortController();
  pendingConnect = { code: null, url: null, controller };
  pushBridgeState();
  try {
    const { account } = await deviceAuth(loadConfig().server || DEFAULT_SERVER, {
      signal: controller.signal,
      onCode: ({ url, code }) => {
        pendingConnect = { code, url, controller };
        shell.openExternal(url);
        pushBridgeState();
      },
    });
    pendingConnect = null;
    logBridge(`connected${account ? ` to ${account}` : ''}`);
    // Keep the connection up without anyone opening the app again.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ['--hidden'] });
    startBridge();
  } catch (err) {
    pendingConnect = null;
    logBridge(`connect failed: ${err.message}`);
    throw err;
  }
  return pushBridgeState();
}

async function addFolder() {
  if (process.platform === 'darwin') app.focus({ steal: true });
  const parent = bridgeWindow && !bridgeWindow.isDestroyed() ? bridgeWindow : null;
  const opts = { properties: ['openDirectory', 'createDirectory'], title: 'Allow Arcwork to work in this folder', buttonLabel: 'Allow' };
  const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || !result.filePaths[0]) return pushBridgeState();
  const cfg = loadConfig();
  cfg.workspaces = Array.from(new Set([...(cfg.workspaces || []), result.filePaths[0]]));
  saveConfig(cfg);
  logBridge(`allowed folder ${result.filePaths[0]}`);
  startBridge();
  return pushBridgeState();
}

function openBridgeWindow() {
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  if (bridgeWindow && !bridgeWindow.isDestroyed()) {
    bridgeWindow.show();
    bridgeWindow.focus();
    return;
  }
  bridgeWindow = new BrowserWindow({
    width: 560,
    height: 680,
    title: 'Arcwork Bridge',
    backgroundColor: '#0a0c10',
    webPreferences: { preload: path.join(__dirname, 'bridge-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  bridgeWindow.loadFile(path.join(__dirname, 'bridge.html'));
  bridgeWindow.on('closed', () => (bridgeWindow = null));
}

ipcMain.handle('bridge-get-state', () => pushBridgeState());
ipcMain.handle('bridge-connect', () => connectWithBrowser());
ipcMain.handle('bridge-cancel-connect', () => {
  pendingConnect?.controller.abort();
  pendingConnect = null;
  return pushBridgeState();
});
ipcMain.handle('bridge-pair', async (_e, { code, server, name }) => {
  await pair(server || DEFAULT_SERVER, code, name);
  logBridge('paired with Arcwork');
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ['--hidden'] });
  startBridge();
  return pushBridgeState();
});
ipcMain.handle('bridge-add-folder', () => addFolder());
ipcMain.handle('bridge-remove-folder', (_e, folder) => {
  const cfg = loadConfig();
  cfg.workspaces = (cfg.workspaces || []).filter((w) => w !== folder);
  saveConfig(cfg);
  logBridge(`removed folder ${folder}`);
  startBridge();
  return pushBridgeState();
});
ipcMain.handle('bridge-set-open-at-login', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(on), openAsHidden: true, args: ['--hidden'] });
  return pushBridgeState();
});
ipcMain.handle('bridge-unpair', () => {
  if (bridgeClient) bridgeClient.stop();
  const cfg = loadConfig();
  delete cfg.token;
  delete cfg.account;
  saveConfig(cfg);
  bridgeStatus = 'not paired';
  logBridge('unpaired this computer');
  return pushBridgeState();
});
ipcMain.handle('bridge-open-pairing-page', () => shell.openExternal(`${loadConfig().server || DEFAULT_SERVER}/connections#devices`));

const STATUS_LABEL = { connected: 'Connected', reconnecting: 'Reconnecting…', revoked: 'Disconnected', stopped: 'Stopped', 'not paired': 'Not connected' };

function updateTray(state) {
  if (!tray) return;
  tray.setToolTip(`Arcwork: ${STATUS_LABEL[state.status] || state.status}`);
  const folders = state.workspaces.map((w) => ({ label: w.replace(require('os').homedir(), '~'), enabled: false }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Arcwork: ${STATUS_LABEL[state.status] || state.status}${state.account ? ` (${state.account})` : ''}`, enabled: false },
    ...(state.paired
      ? [{ label: 'Add folder…', click: () => addFolder().catch(() => {}) }, ...(folders.length ? [{ type: 'separator' }, { label: 'Allowed folders', enabled: false }, ...folders] : [])]
      : [{ label: state.connecting ? 'Waiting for approval in your browser…' : 'Connect this computer…', click: () => connectWithBrowser().catch(() => openBridgeWindow()) }]),
    { type: 'separator' },
    { label: 'Open Arcwork', click: () => (mainWindow ? mainWindow.show() : createWindow()) },
    { label: 'Bridge settings…', click: openBridgeWindow },
    { type: 'separator' },
    { label: 'Quit Arcwork', role: 'quit' },
  ]));
}

function buildMenuAndTray() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Bridge', submenu: [{ label: 'Arcwork Bridge…', accelerator: 'CmdOrCtrl+Shift+B', click: openBridgeWindow }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 18, height: 18 });
    tray = new Tray(icon);
    pushBridgeState();
  } catch {
    // Tray is optional
  }
}

/** arcwork://connect (from the /connect page or a task's "not connected" message). */
function handleDeepLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== 'arcwork:') return;
  // Only actions that end in the person's own click; a link never grants anything by itself.
  if (u.hostname === 'connect') {
    openBridgeWindow();
    if (!loadConfig().token) connectWithBrowser().catch(() => {});
  } else {
    openBridgeWindow();
  }
}

// One running copy: a second launch (or a deep link on Windows/Linux) goes to this one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith('arcwork://'));
    if (link) handleDeepLink(link);
    else openBridgeWindow();
  });
}
app.on('open-url', (e, url) => {
  e.preventDefault();
  if (app.isReady()) handleDeepLink(url);
  else app.once('ready', () => handleDeepLink(url));
});
if (process.defaultApp) app.setAsDefaultProtocolClient('arcwork', process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient('arcwork');

app.whenReady().then(() => {
  startBackgroundDaemon();
  buildMenuAndTray();
  startBridge();
  if (launchedAtLogin()) {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
  } else {
    createWindow();
    if (!loadConfig().token) openBridgeWindow();
  }
  const link = process.argv.find((a) => a.startsWith('arcwork://'));
  if (link) handleDeepLink(link);

  // Waking from sleep or a network change: reconnect now instead of waiting out the backoff.
  powerMonitor.on('resume', () => startBridge());
  powerMonitor.on('unlock-screen', () => bridgeStatus !== 'connected' && startBridge());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (daemonProcess) {
    daemonProcess.kill();
  }
  // Connected computers keep working from the menu bar / tray after the windows close.
  if (process.platform === 'darwin' && app.dock && loadConfig().token) app.dock.hide();
  if (process.platform !== 'darwin' && !loadConfig().token) {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (bridgeClient) bridgeClient.stop();
  if (daemonProcess) {
    daemonProcess.kill();
  }
});
