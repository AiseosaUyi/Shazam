const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell } = require('electron');
const { BridgeClient, loadConfig, saveConfig, pair, DEFAULT_SERVER } = require('./bridge-core');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let bridgeWindow = null;
let tray = null;
let bridgeClient = null;
let bridgeStatus = 'not paired';
const bridgeLog = [];
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
  const state = { status: bridgeStatus, server: cfg.server, paired: Boolean(cfg.token), deviceName: cfg.deviceName, workspaces: cfg.workspaces || [], log: bridgeLog.slice(-80) };
  if (bridgeWindow && !bridgeWindow.isDestroyed()) bridgeWindow.webContents.send('bridge-state', state);
  if (tray) tray.setToolTip(`Arcwork Bridge: ${bridgeStatus}`);
  return state;
}

function logBridge(line) {
  bridgeLog.push(`${new Date().toLocaleTimeString()}  ${line}`);
  if (bridgeLog.length > 300) bridgeLog.shift();
  pushBridgeState();
}

async function approveRisky(summary, detail) {
  const parent = bridgeWindow && !bridgeWindow.isDestroyed() ? bridgeWindow : mainWindow;
  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Deny', 'Allow once'],
    defaultId: 0,
    cancelId: 0,
    title: 'Arcwork wants to run a command',
    message: summary,
    detail,
  });
  logBridge(response === 1 ? `approved: ${detail.split('\n')[0]}` : `denied: ${detail.split('\n')[0]}`);
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
    log: logBridge,
    onStatus: (s) => {
      bridgeStatus = s;
      pushBridgeState();
    },
  });
  bridgeClient.start().catch((err) => logBridge(`bridge stopped: ${err.message}`));
}

function openBridgeWindow() {
  if (bridgeWindow && !bridgeWindow.isDestroyed()) {
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
ipcMain.handle('bridge-pair', async (_e, { code, server, name }) => {
  await pair(server || DEFAULT_SERVER, code, name);
  logBridge('paired with Arcwork');
  startBridge();
  return pushBridgeState();
});
ipcMain.handle('bridge-add-folder', async () => {
  const result = await dialog.showOpenDialog(bridgeWindow || mainWindow, { properties: ['openDirectory'], title: 'Allow Arcwork to work in this folder' });
  if (result.canceled || !result.filePaths[0]) return pushBridgeState();
  const cfg = loadConfig();
  cfg.workspaces = Array.from(new Set([...(cfg.workspaces || []), result.filePaths[0]]));
  saveConfig(cfg);
  logBridge(`allowed folder ${result.filePaths[0]}`);
  startBridge();
  return pushBridgeState();
});
ipcMain.handle('bridge-remove-folder', (_e, folder) => {
  const cfg = loadConfig();
  cfg.workspaces = (cfg.workspaces || []).filter((w) => w !== folder);
  saveConfig(cfg);
  logBridge(`removed folder ${folder}`);
  startBridge();
  return pushBridgeState();
});
ipcMain.handle('bridge-unpair', () => {
  if (bridgeClient) bridgeClient.stop();
  const cfg = loadConfig();
  delete cfg.token;
  saveConfig(cfg);
  bridgeStatus = 'not paired';
  logBridge('unpaired this computer');
  return pushBridgeState();
});
ipcMain.handle('bridge-open-pairing-page', () => shell.openExternal(`${loadConfig().server || DEFAULT_SERVER}/connections#devices`));

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
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Arcwork', click: () => (mainWindow ? mainWindow.show() : createWindow()) },
      { label: 'Arcwork Bridge…', click: openBridgeWindow },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]));
  } catch {
    // Tray is optional
  }
}

app.whenReady().then(() => {
  startBackgroundDaemon();
  createWindow();
  buildMenuAndTray();
  startBridge();
  if (!loadConfig().token) openBridgeWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (daemonProcess) {
    daemonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (bridgeClient) bridgeClient.stop();
  if (daemonProcess) {
    daemonProcess.kill();
  }
});
