const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
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
    title: 'Shazam AI Studio',
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
  const targetUrl = process.env.SHAZAM_DESKTOP_URL || 'https://shazam-ai.aiseosauyi-idahor.workers.dev/agent';

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
    title: 'Select Project Directory to Bind with Shazam AI',
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('exec-command', async (_, command) => {
  const { execSync } = require('child_process');
  try {
    const stdout = execSync(command, { cwd: CWD, encoding: 'utf8' });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message, stderr: err.stderr ? err.stderr.toString() : '' };
  }
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

app.whenReady().then(() => {
  startBackgroundDaemon();
  createWindow();

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
  if (daemonProcess) {
    daemonProcess.kill();
  }
});
