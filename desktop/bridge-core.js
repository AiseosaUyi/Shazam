/**
 * Arcwork Bridge client core (shared by the desktop app and the `shazam-bridge` CLI).
 *
 * The bridge connects OUT to the Arcwork server (long-poll), so cloud agents can use this
 * computer without opening any inbound port. It only acts inside folders the user allowed,
 * refuses secret files, and asks before risky commands (push, delete, sudo, publish…).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const VERSION = '1.1.0';
const CONFIG_DIR = path.join(os.homedir(), '.shazam');
const CONFIG_PATH = path.join(CONFIG_DIR, 'bridge.json');
const DEFAULT_SERVER = process.env.SHAZAM_SERVER || 'https://arcwork-ai.vercel.app';

const SECRET_PATTERNS = [/(^|\/)\.env(\.|$)/i, /\.pem$/i, /\.key$/i, /(^|\/)id_(rsa|ed25519|ecdsa)/i, /(^|\/)\.ssh(\/|$)/, /(^|\/)\.aws(\/|$)/, /credentials\.json$/i, /(^|\/)\.git\/config$/];
const RISKY_COMMAND = /\b(git\s+push|git\s+reset\s+--hard|git\s+clean|rm\s+-[a-z]*[rf]|sudo|npm\s+publish|pnpm\s+publish|yarn\s+publish|gh\s+(pr\s+merge|repo\s+delete|release)|docker\s+(rm|rmi|system\s+prune)|kubectl\s+(delete|apply)|terraform\s+(apply|destroy)|vercel\s+(deploy|--prod)|curl[^|]*\|\s*(ba|z)?sh|chmod\s+-R|chown|mkfs|dd\s+if=|shutdown|reboot)\b/i;
// Commands that never exit on their own: they must go through `spawn` (start_preview).
const LONG_RUNNING = /(&\s*$)|\b(http\.server|npm\s+(run\s+)?(dev|start)|pnpm\s+(run\s+)?(dev|start)|yarn\s+(dev|start)|next\s+(dev|start)|vite(\s|$)|npx\s+serve|serve\s+-|nodemon|webpack\s+serve|tail\s+-f|watch\b)/i;

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.vercel', '.cache', 'coverage', '__pycache__', '.venv']);

function loadConfig() {
  try {
    return { server: DEFAULT_SERVER, workspaces: [], ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { server: DEFAULT_SERVER, workspaces: [], token: null, deviceName: os.hostname() };
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

async function pair(server, code, deviceName) {
  const res = await fetch(`${server.replace(/\/$/, '')}/api/v1/bridge/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, kind: 'desktop', name: deviceName || os.hostname(), capabilities: { platform: process.platform, version: VERSION } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pairing failed (HTTP ${res.status})`);
  const cfg = loadConfig();
  cfg.server = server.replace(/\/$/, '');
  cfg.token = data.token;
  cfg.deviceName = deviceName || os.hostname();
  saveConfig(cfg);
  return data.device;
}

/**
 * Browser sign-in (like `gh auth login`): asks Arcwork for a request, calls onCode with the
 * approval URL and short code (open it in the browser), then polls until the person approves.
 * Saves the device token like pair() does.
 */
async function deviceAuth(server, { name, onCode, signal } = {}) {
  const base = server.replace(/\/$/, '');
  const deviceName = name || os.hostname();
  const res = await fetch(`${base}/api/v1/bridge/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'desktop', name: deviceName, capabilities: { platform: process.platform, version: VERSION } }),
    signal,
  });
  const start = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(start.error || `Could not reach Arcwork (HTTP ${res.status})`);
  await onCode?.({ url: start.verification_uri_complete, code: start.user_code, expiresIn: start.expires_in });

  let interval = Math.max(2, Number(start.interval) || 3) * 1000;
  const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    if (signal?.aborted) throw new Error('Cancelled.');
    let data = {};
    let status = 0;
    try {
      const r = await fetch(`${base}/api/v1/bridge/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_code: start.device_code }), signal });
      status = r.status;
      data = await r.json().catch(() => ({}));
    } catch (err) {
      if (signal?.aborted) throw new Error('Cancelled.');
      continue; // network blip: keep waiting
    }
    if (status === 200 && data.token) {
      const cfg = loadConfig();
      cfg.server = base;
      cfg.token = data.token;
      cfg.deviceName = deviceName;
      cfg.account = data.account?.email || null;
      saveConfig(cfg);
      return { device: data.device, account: cfg.account };
    }
    if (data.error === 'slow_down' || status === 429) interval += 2000;
    else if (data.error === 'access_denied') throw new Error('The connection was declined in the browser.');
    else if (data.error === 'expired_token') throw new Error('The connection request expired. Try again.');
  }
  throw new Error('The connection request expired. Try again.');
}

/**
 * Whether a folder may be offered for on-demand consent: it must exist, be a directory and
 * not be a whole disk, the home folder itself, a system folder or a credentials folder.
 * Returns the real path, or throws with a reason the agent can relay.
 */
function checkConsentFolder(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p.replace(/^~(?=$|\/)/, os.homedir()))) throw new Error('The folder must be an absolute path.');
  let real;
  try {
    real = fs.realpathSync(path.resolve(p.replace(/^~(?=$|\/)/, os.homedir())));
  } catch {
    throw new Error(`"${p}" does not exist on this computer.`);
  }
  if (!fs.statSync(real).isDirectory()) throw new Error(`"${p}" is not a folder.`);
  const home = fs.realpathSync(os.homedir());
  const tooBroad = [path.parse(real).root, home, path.dirname(home), '/Users', '/home', '/System', '/Library', '/Applications', '/usr', '/bin', '/etc', '/var', '/tmp', '/private', '/private/tmp', '/private/var', '/opt', 'C:\\Windows', 'C:\\Program Files'];
  if (tooBroad.some((b) => real.toLowerCase() === b.toLowerCase())) throw new Error(`"${real}" is too broad to share. Ask for a project folder instead.`);
  const system = ['/System/', '/Library/', '/usr/', '/bin/', '/sbin/', '/etc/', '/private/etc/', '/private/var/db/', 'C:\\Windows\\'];
  if (system.some((b) => real.startsWith(b))) throw new Error(`"${real}" is a system folder; Arcwork can't work there.`);
  if (SECRET_PATTERNS.some((rx) => rx.test(real + '/')) || /(^|\/)\.(gnupg|config\/gcloud|kube|docker)(\/|$)/.test(real)) throw new Error(`"${real}" holds credentials; Arcwork can't work there.`);
  return real;
}

/** Resolves a path and checks it is inside an allowed workspace and not a secret. */
function guardPath(p, workspaces) {
  if (typeof p !== 'string' || !p) throw new Error('A path is required.');
  const abs = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  // Resolve symlinks via the nearest existing ancestor, so new files in new folders work
  // and symlinks cannot be used to escape the workspace.
  let existing = abs;
  const rest = [];
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  let real;
  try {
    real = path.join(fs.realpathSync(existing), ...rest);
  } catch {
    real = abs;
  }
  const roots = workspaces.map((w) => {
    try {
      return fs.realpathSync(w);
    } catch {
      return path.resolve(w);
    }
  });
  if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) {
    throw new Error(`"${p}" is outside the folders you allowed (${workspaces.join(', ') || 'none'}). Add the folder in the Arcwork desktop app first.`);
  }
  if (SECRET_PATTERNS.some((rx) => rx.test(real))) throw new Error(`Refusing to touch secret file "${p}".`);
  return real;
}

function guardPathSafe(p, workspaces) {
  try {
    guardPath(p, workspaces);
    return true;
  } catch {
    return false;
  }
}

function listFiles(root, max) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= max) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else {
        out.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return out;
}

function execCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/bash';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    let output = '';
    const append = (d) => {
      output += d.toString();
      if (output.length > 400_000) output = output.slice(-200_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      output += `\n[timed out after ${Math.round(timeoutMs / 1000)}s]`;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output: output.slice(-60_000) });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: String(err.message) });
    });
  });
}

// Local LLM servers the bridge can tunnel to (OpenAI-compatible endpoints only).
const LOCAL_LLM_SERVERS = [
  { name: 'ollama', base: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434' },
  { name: 'lmstudio', base: process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234' },
];

async function probeLocalModels() {
  const found = [];
  for (const srv of LOCAL_LLM_SERVERS) {
    try {
      const res = await fetch(`${srv.base}/v1/models`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const m of data.data || []) found.push({ server: srv.name, id: m.id });
    } catch {
      // server not running
    }
  }
  return found;
}

function isAllowedLocalUrl(url) {
  try {
    const u = new URL(url);
    return LOCAL_LLM_SERVERS.some((s) => new URL(s.base).origin === u.origin) && u.pathname.startsWith('/v1/');
  } catch {
    return false;
  }
}

class BridgeClient {
  /**
   * @param {{ config: any, approve?: (summary: string, detail: string) => Promise<boolean>, log?: (line: string) => void, onStatus?: (s: string) => void }} opts
   */
  constructor(opts) {
    this.cfg = opts.config;
    this.approve = opts.approve || (async () => false);
    // Asks the person whether Arcwork may work in a folder it isn't allowed in yet.
    this.approveFolder = opts.approveFolder || (async () => false);
    this.declined = new Map(); // folder → time declined, so a run can't spam prompts
    this.log = opts.log || ((l) => console.log(l));
    this.onStatus = opts.onStatus || (() => {});
    this.running = false;
    this.controller = null;
  }

  async handle(cmd) {
    const p = cmd.payload || {};
    const workspaces = this.cfg.workspaces || [];
    switch (cmd.command) {
      case 'exec': {
        const cwd = guardPath(p.cwd, workspaces);
        if (LONG_RUNNING.test(String(p.command))) {
          return { ok: false, result: 'This command keeps running (server/watch mode). Use start_preview to run it in the background instead of run_command.' };
        }
        if (RISKY_COMMAND.test(p.command)) {
          const ok = await this.approve('Arcwork wants to run a command that changes things outside the editor', `${p.command}\n\nin ${cwd}`);
          if (!ok) return { ok: false, result: 'The user declined this command on their computer.' };
        }
        this.log(`$ ${p.command}   (${cwd})`);
        const r = await execCommand(p.command, cwd, Math.min(600_000, Number(p.timeoutMs) || 120_000));
        return { ok: true, result: `exit code: ${r.exitCode}\n${r.output || '(no output)'}` };
      }
      case 'read_file': {
        const file = guardPath(p.path, workspaces);
        const stat = fs.statSync(file);
        if (stat.size > 1_000_000) return { ok: false, result: 'File is larger than 1 MB.' };
        const text = fs.readFileSync(file, 'utf8');
        return { ok: true, result: text.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n') };
      }
      case 'write_file': {
        const file = guardPath(p.path, workspaces);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(p.content ?? ''));
        this.log(`wrote ${file}`);
        return { ok: true, result: `Wrote ${file} (${String(p.content ?? '').split('\n').length} lines).` };
      }
      case 'edit_file': {
        const file = guardPath(p.path, workspaces);
        const text = fs.readFileSync(file, 'utf8');
        const count = text.split(p.old_string).length - 1;
        if (count !== 1) return { ok: false, result: count === 0 ? 'old_string not found; read the file and copy the exact text.' : `old_string matches ${count} places; include more context.` };
        fs.writeFileSync(file, text.replace(p.old_string, p.new_string));
        this.log(`edited ${file}`);
        return { ok: true, result: `Edited ${file}.` };
      }
      case 'llm_http': {
        // Tunnel an OpenAI-compatible request to a local LLM server (Ollama / LM Studio) only.
        if (!isAllowedLocalUrl(p.url)) return { ok: false, result: 'Only local LLM endpoints (Ollama/LM Studio /v1/*) can be reached.' };
        // The server sets a per-step budget; giving up here also stops the model on this computer.
        const timeoutMs = Math.min(Math.max(Number(p.timeoutMs) || 280_000, 5_000), 280_000);
        const res = await fetch(p.url, { method: p.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: p.body, signal: AbortSignal.timeout(timeoutMs) });
        const body = await res.text();
        this.log(`local LLM ${new URL(p.url).pathname} → ${res.status}`);
        return { ok: true, result: { status: res.status, contentType: res.headers.get('content-type') || 'application/json', body } };
      }
      case 'grep': {
        const root = guardPath(p.path, workspaces);
        const pattern = String(p.pattern || '').slice(0, 200);
        if (!pattern) return { ok: false, result: 'pattern is required' };
        const isGit = fs.existsSync(path.join(root, '.git'));
        const cmd = isGit
          ? `git grep -n -I -i -E ${JSON.stringify(pattern)} -- . ':!*.lock' | head -n 120`
          : `grep -rnIiE ${JSON.stringify(pattern)} . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist | head -n 120`;
        const r = await execCommand(cmd, root, 30_000);
        return { ok: true, result: r.output.trim() || `No matches for /${pattern}/.` };
      }
      case 'spawn': {
        // Start a long-running process (dev server) and return its first output.
        const cwd = guardPath(p.cwd, workspaces);
        const shell = process.env.SHELL || '/bin/bash';
        const child = spawn(shell, ['-lc', p.command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
        let out = '';
        let exitCode = null;
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('exit', (code) => (exitCode = code ?? 1));
        child.unref();
        await new Promise((r) => setTimeout(r, Math.min(20_000, Number(p.waitMs) || 8000)));
        if (exitCode !== null) {
          return { ok: false, result: `The process exited immediately (code ${exitCode}), so nothing is running:\n${out.slice(-3000)}` };
        }
        // Stop holding the pipes so the server keeps running after we return.
        child.stdout.destroy();
        child.stderr.destroy();
        this.log(`started ${p.command} (pid ${child.pid}) in ${cwd}`);
        return { ok: true, result: `Running (pid ${child.pid}). Output so far:\n${out.slice(-4000)}` };
      }
      case 'request_folder': {
        // On-demand consent: a task targets a folder that isn't allowed yet.
        const real = checkConsentFolder(p.path);
        if (guardPathSafe(real, workspaces)) return { ok: true, result: { allowed: true, folder: real, workspaces } };
        const last = this.declined.get(real);
        if (last && Date.now() - last < 10 * 60_000) return { ok: true, result: { allowed: false, folder: real, reason: 'declined recently' } };
        const allowed = await this.approveFolder(real, String(p.reason || '').slice(0, 300));
        if (!allowed) {
          this.declined.set(real, Date.now());
          this.log(`declined folder ${real}`);
          return { ok: true, result: { allowed: false, folder: real } };
        }
        const cfg = loadConfig();
        cfg.workspaces = Array.from(new Set([...(cfg.workspaces || []), real]));
        saveConfig(cfg);
        this.cfg.workspaces = cfg.workspaces;
        this.log(`allowed folder ${real}`);
        return { ok: true, result: { allowed: true, folder: real, workspaces: cfg.workspaces } };
      }
      case 'list_files': {
        const root = guardPath(p.path, workspaces);
        const files = listFiles(root, Math.min(2000, Number(p.max) || 500));
        return { ok: true, result: files.join('\n') || '(empty folder)' };
      }
      default:
        return { ok: false, result: `Unknown command "${cmd.command}".` };
    }
  }

  async post(pathname, body, signal) {
    const res = await fetch(`${this.cfg.server}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.token}` },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401) {
      const err = new Error('This device was revoked or the token is invalid. Pair again.');
      err.fatal = true;
      throw err;
    }
    return res.json().catch(() => ({}));
  }

  async start() {
    if (!this.cfg.token) throw new Error('Not paired yet.');
    this.running = true;
    let backoff = 1000;
    let localModels = [];
    let lastProbe = 0;
    this.onStatus('connected');
    while (this.running) {
      this.controller = new AbortController();
      try {
        // Pick up folders allowed or removed elsewhere (desktop window, `allow` in a terminal).
        if (fs.existsSync(CONFIG_PATH)) this.cfg.workspaces = loadConfig().workspaces || [];
        if (Date.now() - lastProbe > 60_000) {
          localModels = await probeLocalModels();
          lastProbe = Date.now();
        }
        const data = await this.post(
          '/api/v1/bridge/poll',
          { waitMs: 20_000, capabilities: { workspaces: this.cfg.workspaces || [], platform: process.platform, version: VERSION, hostname: os.hostname(), localModels, localServers: LOCAL_LLM_SERVERS } },
          this.controller.signal
        );
        backoff = 1000;
        this.onStatus('connected');
        // Run commands in the background and keep polling: a local model step can take minutes,
        // and the server treats a computer that stops polling for ~75s as offline.
        for (const cmd of data.commands || []) {
          this.handle(cmd)
            .catch((err) => ({ ok: false, result: err.message || String(err) }))
            .then((outcome) => this.post('/api/v1/bridge/result', { id: cmd.id, ok: outcome.ok, result: outcome.result }))
            .catch(() => {});
        }
      } catch (err) {
        if (!this.running) break;
        if (err.fatal) {
          this.onStatus('revoked');
          this.log(err.message);
          this.running = false;
          break;
        }
        this.onStatus('reconnecting');
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(30_000, backoff * 2);
      }
    }
  }

  stop() {
    this.running = false;
    this.controller?.abort();
    this.onStatus('stopped');
  }
}

module.exports = { deviceAuth, checkConsentFolder, LONG_RUNNING, probeLocalModels, isAllowedLocalUrl, BridgeClient, loadConfig, saveConfig, pair, guardPath, RISKY_COMMAND, DEFAULT_SERVER, CONFIG_PATH, VERSION };
