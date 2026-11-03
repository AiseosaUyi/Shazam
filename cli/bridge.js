#!/usr/bin/env node
/**
 * shazam-bridge — connect this computer to Arcwork so cloud agents can run commands,
 * edit files and use git (with your own credentials) inside folders you allow.
 *
 *   shazam-bridge connect [--folder <dir>] [--foreground]   # browser sign-in + allow this folder + run in the background
 *   shazam-bridge stop                    # stop the background bridge
 *   shazam-bridge pair <CODE> [--server https://arcwork-ai.vercel.app] [--name "My Mac"]
 *   shazam-bridge allow <folder>          # add a workspace folder
 *   shazam-bridge disallow <folder>
 *   shazam-bridge status
 *   shazam-bridge start [--yes-risky]     # run; risky commands are confirmed in this terminal
 *   shazam-bridge autostart on|off|status # manage autostart (enabled after first connect)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { BridgeClient, loadConfig, saveConfig, pair, deviceAuth, checkConsentFolder, CONFIG_PATH, DEFAULT_SERVER, launchAgentPlist, systemdUnit, windowsTaskArgs } = require('../desktop/bridge-core');

const execFileP = promisify(execFile);

const [, , cmd, ...rest] = process.argv;
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const PID_PATH = path.join(path.dirname(CONFIG_PATH), 'bridge.pid');
const LOG_PATH = path.join(path.dirname(CONFIG_PATH), 'bridge.log');

function ask(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}

/** Native yes/no prompt for the background bridge (no terminal to ask in). Denies if none is available. */
function nativeConfirm(title, message, allowLabel) {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      // Text goes in as argv, never into the script, so it can't inject AppleScript.
      const script = ['on run argv', `display dialog (item 2 of argv) with title (item 1 of argv) buttons {"Don't allow", (item 3 of argv)} default button "Don't allow" cancel button "Don't allow" with icon caution giving up after 110`, 'end run'];
      execFile('osascript', [...script.flatMap((l) => ['-e', l]), title, message, allowLabel], (err, stdout) => resolve(!err && String(stdout).includes(`button returned:${allowLabel}`)));
    } else if (process.platform === 'linux') {
      execFile('zenity', ['--question', `--title=${title}`, `--text=${message}`, `--ok-label=${allowLabel}`, "--cancel-label=Don't allow", '--timeout=110'], (err) => resolve(!err));
    } else {
      resolve(false);
    }
  });
}

function openBrowser(url) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(bin, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // The URL is printed too.
  }
}

function runningPid() {
  try {
    const pid = Number(fs.readFileSync(PID_PATH, 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Start the CLI as a background daemon and return its pid. */
function startBackground() {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true, mode: 0o700 });
  const out = fs.openSync(LOG_PATH, 'a', 0o600);
  const child = spawn(process.execPath, [__filename, 'start', '--background'], { detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  return child.pid;
}

/** Check if autostart is enabled (sync file-based check). */
function autostartFileExists() {
  if (process.platform === 'darwin') {
    return fs.existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.arcwork.bridge.plist'));
  } else if (process.platform === 'linux') {
    return fs.existsSync(path.join(os.homedir(), '.config', 'systemd', 'user', 'arcwork-bridge.service'));
  } else if (process.platform === 'win32') {
    try {
      execFileSync('schtasks', ['/Query', '/TN', 'ArcworkBridge'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Enable autostart for this bridge. */
async function enableAutostart() {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__filename);
  const logDir = path.dirname(LOG_PATH);

  if (process.platform === 'darwin') {
    try {
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.arcwork.bridge.plist');
      const plistContent = launchAgentPlist(nodePath, scriptPath, logDir);
      fs.mkdirSync(path.dirname(plistPath), { recursive: true });
      fs.writeFileSync(plistPath, plistContent, { mode: 0o644 });
      // Try bootout (ignore errors — it may not be loaded yet)
      try {
        await execFileP('launchctl', ['bootout', 'gui/' + os.userInfo().uid, plistPath]);
      } catch { /* ignore */ }
      await execFileP('launchctl', ['bootstrap', 'gui/' + os.userInfo().uid, plistPath]);
    } catch (err) {
      console.log(`! Warning: could not enable autostart — ${err.message}`);
      return false;
    }
  } else if (process.platform === 'linux') {
    try {
      const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'arcwork-bridge.service');
      const unitContent = systemdUnit(nodePath, scriptPath);
      fs.mkdirSync(path.dirname(servicePath), { recursive: true });
      fs.writeFileSync(servicePath, unitContent, { mode: 0o644 });
      await execFileP('systemctl', ['--user', 'daemon-reload']);
      await execFileP('systemctl', ['--user', 'enable', '--now', 'arcwork-bridge.service']);
    } catch (err) {
      console.log(`! Warning: could not enable autostart — ${err.message}`);
      return false;
    }
  } else if (process.platform === 'win32') {
    try {
      const args = windowsTaskArgs(nodePath, scriptPath);
      await execFileP('schtasks', args);
      // Run it now so the bridge starts immediately (ONLOGON alone waits for next login).
      await execFileP('schtasks', ['/Run', '/TN', 'ArcworkBridge']).catch(() => {});
    } catch (err) {
      console.log(`! Warning: could not enable autostart — ${err.message}`);
      return false;
    }
  } else {
    console.log('! Autostart is not supported on this platform.');
    return false;
  }
  return true;
}

/** Disable autostart for this bridge. */
async function disableAutostart() {
  if (process.platform === 'darwin') {
    try {
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.arcwork.bridge.plist');
      try {
        await execFileP('launchctl', ['bootout', 'gui/' + os.userInfo().uid, plistPath]);
      } catch { /* ignore */ }
      fs.rmSync(plistPath, { force: true });
    } catch (err) {
      console.log(`! Warning: could not disable autostart — ${err.message}`);
      return false;
    }
  } else if (process.platform === 'linux') {
    try {
      const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'arcwork-bridge.service');
      await execFileP('systemctl', ['--user', 'disable', '--now', 'arcwork-bridge.service']);
      fs.rmSync(servicePath, { force: true });
    } catch (err) {
      console.log(`! Warning: could not disable autostart — ${err.message}`);
      return false;
    }
  } else if (process.platform === 'win32') {
    try {
      await execFileP('schtasks', ['/Delete', '/TN', 'ArcworkBridge', '/F']);
    } catch (err) {
      console.log(`! Warning: could not disable autostart — ${err.message}`);
      return false;
    }
  } else {
    console.log('! Autostart is not supported on this platform.');
    return false;
  }
  return true;
}

/** Show autostart status. */
function autostartStatus() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.arcwork.bridge.plist');
    console.log(fs.existsSync(plistPath) ? 'on' : 'off');
  } else if (process.platform === 'linux') {
    execFile('systemctl', ['--user', 'is-enabled', 'arcwork-bridge.service'], { stdio: 'ignore' }, (err) => {
      console.log(err ? 'off' : 'on');
    });
  } else if (process.platform === 'win32') {
    execFile('schtasks', ['/Query', '/TN', 'ArcworkBridge'], { stdio: 'ignore' }, (err) => {
      console.log(err ? 'off' : 'on');
    });
  } else {
    console.log('unknown');
  }
}

async function connect(cfg) {
  if (!cfg.token) {
    console.log('Connecting this computer to Arcwork…');
    const { account } = await deviceAuth(flag('--server') || cfg.server || DEFAULT_SERVER, {
      name: flag('--name'),
      onCode: ({ url, code }) => {
        console.log(`\n  Approve it in your browser: ${url}\n  Check the page shows this code: ${code}\n`);
        openBrowser(url);
        console.log('Waiting for you to click Approve…');
      },
    });
    console.log(`✓ Connected${account ? ` to ${account}` : ''}.`);

    // After successful first connect, enable autostart (but do NOT startBackground if a service will start it)
    try {
      const enabled = await enableAutostart();
      if (enabled) {
        console.log('✓ Arcwork will start automatically when you log in (turn off: autostart off).');
      } else {
        console.log('! Autostart could not be enabled, but the bridge is connected.');
      }
    } catch (err) {
      console.log(`! Warning: autostart setup failed — ${err.message}`);
    }
  } else {
    console.log(`✓ Already connected${cfg.account ? ` to ${cfg.account}` : ''} as "${cfg.deviceName}".`);
  }

  const dir = path.resolve(flag('--folder') || process.cwd());
  try {
    const real = checkConsentFolder(dir);
    const fresh = loadConfig();
    fresh.workspaces = Array.from(new Set([...(fresh.workspaces || []), real]));
    saveConfig(fresh);
    console.log(`✓ Arcwork can work in ${real}`);
  } catch (err) {
    console.log(`! Didn't allow ${dir}: ${err.message}\n  Run this inside a project folder to allow it. Arcwork will ask before using any other folder.`);
  }

  // If autostart is enabled, let the OS service start the bridge — don't call startBackground.
  if (autostartFileExists()) {
    console.log('✓ The OS service will start the bridge automatically.');
  } else if (rest.includes('--foreground')) {
    return start(loadConfig());
  } else {
    const pid = runningPid();
    if (pid) console.log(`✓ Already running in the background (pid ${pid}); it picks up the new folder by itself.`);
    else console.log(`✓ Running in the background (pid ${startBackground()}). Log: ${LOG_PATH}`);
  }
  console.log('Stop it any time with: shazam-bridge stop');
}

async function start(cfg) {
  const background = rest.includes('--background');
  const yesRisky = rest.includes('--yes-risky');
  let lastStatus = '';
  if (background) fs.writeFileSync(PID_PATH, String(process.pid), { mode: 0o600 });
  const cleanup = () => {
    if (background && runningPid() === process.pid) fs.rmSync(PID_PATH, { force: true });
  };
  const client = new BridgeClient({
    config: cfg,
    approve: async (summary, detail) =>
      yesRisky || (background ? nativeConfirm('Arcwork wants to run a command', `${summary}:\n\n${detail}`, 'Allow once') : ask(`\n⚠ ${summary}:\n  ${detail.replace(/\n/g, '\n  ')}\nAllow? [y/N] `)),
    approveFolder: async (folder, reason) =>
      background
        ? nativeConfirm('Arcwork', `Allow Arcwork to work in this folder?\n\n${folder}\n\n${reason}`, 'Allow')
        : ask(`\n? ${reason}\n  Allow Arcwork to work in ${folder}? [y/N] `),
    log: (l) => console.log(`${new Date().toISOString()} ${l}`),
    // Print only changes; the long-poll reconnects every ~20s and would repeat "connected".
    onStatus: (s) => { if (s !== lastStatus) console.log(`[bridge] ${s}`); lastStatus = s; },
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { client.stop(); cleanup(); process.exit(0); });
  console.log(`Arcwork bridge → ${cfg.server}  (folders: ${(cfg.workspaces || []).join(', ') || 'none yet; Arcwork asks when a task needs one'})`);
  await client.start();
  cleanup();
}

(async () => {
  const cfg = loadConfig();
  switch (cmd) {
    case 'connect':
      await connect(cfg);
      break;
    case 'stop': {
      const pid = runningPid();
      if (!pid) console.log('The background bridge is not running.');
      else {
        process.kill(pid, 'SIGTERM');
        console.log(`✓ Stopped (pid ${pid}).`);
        // If autostart is still on, it will restart — tell the user.
        if (autostartFileExists()) {
          console.log('  It will start again at your next login. To turn that off: shazam-bridge autostart off');
        }
      }
      break;
    }
    case 'pair': {
      const code = rest[0];
      if (!code) throw new Error('Usage: shazam-bridge pair <CODE>  (or just: shazam-bridge connect)');
      const device = await pair(flag('--server') || cfg.server || DEFAULT_SERVER, code, flag('--name'));
      console.log(`✓ Paired as "${device.name}". Config saved to ${CONFIG_PATH}`);
      console.log('Next: shazam-bridge allow <project folder>  then  shazam-bridge start');
      break;
    }
    case 'allow': {
      const dir = path.resolve(rest[0] || process.cwd());
      cfg.workspaces = Array.from(new Set([...(cfg.workspaces || []), dir]));
      saveConfig(cfg);
      console.log(`✓ Allowed ${dir}`);
      break;
    }
    case 'disallow': {
      const dir = path.resolve(rest[0] || process.cwd());
      cfg.workspaces = (cfg.workspaces || []).filter((w) => w !== dir);
      saveConfig(cfg);
      console.log(`✓ Removed ${dir}`);
      break;
    }
    case 'status':
      console.log(JSON.stringify({ server: cfg.server, paired: Boolean(cfg.token), account: cfg.account || null, device: cfg.deviceName, running: runningPid(), workspaces: cfg.workspaces }, null, 2));
      break;
    case 'start': {
      if (!cfg.token) throw new Error('Not connected yet. Run: shazam-bridge connect');
      // Guard: if already running (started by launchd/service), don't start another.
      const existingPid = runningPid();
      if (existingPid !== null) {
        console.log(`Arcwork bridge is already running (pid ${existingPid}).`);
        process.exit(0);
      }
      // If launched via autostart service (--background flag), start directly.
      if (rest.includes('--background')) {
        await start(cfg);
        break;
      }
      // Manual launch: if autostart service will manage this, wait for it instead of starting directly.
      if (autostartFileExists()) {
        console.log('Waiting for the Arcwork bridge to start via autostart…');
        let waited = 0;
        while (waited < 15000) {
          await new Promise((r) => setTimeout(r, 500));
          if (runningPid() !== null) break;
          waited += 500;
        }
        if (runningPid()) console.log('✓ Bridge started via autostart.');
        else await start(cfg); // fallback: start manually after timeout
      } else {
        await start(cfg);
      }
      break;
    }
    case 'autostart': {
      const action = rest[0];
      if (action === 'on') {
        try {
          const enabled = await enableAutostart();
          if (enabled) console.log('✓ Autostart enabled. The bridge will start when you log in.');
          else console.log('! Could not enable autostart — check platform support.');
        } catch (err) {
          console.log(`✗ ${err.message}`);
        }
      } else if (action === 'off') {
        try {
          await disableAutostart();
        } catch { /* ignore */ }
        console.log('✓ Autostart disabled.');
      } else if (action === 'status') {
        autostartStatus();
      } else {
        console.log('Usage: shazam-bridge autostart on|off|status');
      }
      break;
    }
    default:
      console.log(`Usage: shazam-bridge <connect|stop|status|pair|allow|disallow|start|autostart>\n  connect  sign in with your browser, allow this folder (${os.homedir() === process.cwd() ? 'run it in a project folder' : process.cwd()}) and run in the background`);
  }
})().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
