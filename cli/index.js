#!/usr/bin/env node

/**
 * Shazam AI Local Companion Daemon (Hardened)
 * Provides secure local execution capabilities (File I/O, Search-Replace Patching, Shell execution, Git operations)
 * to authorized Shazam AI web & desktop interfaces via loopback (localhost:4040).
 *
 * Security:
 * - Origin validation (Strictly allows Shazam origins and local development; blocks arbitrary websites)
 * - Private Network Access (PNA) preflight support for modern browsers
 * - Mandatory session token authentication on all mutating and executing endpoints
 * - Strict path traversal protections
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const PORT = process.env.SHAZAM_PORT || 4040;
const CWD = process.cwd();

// Manage persistent token in ~/.shazam/token or .shazam-token
function resolveSecurityToken() {
  if (process.env.SHAZAM_TOKEN) return process.env.SHAZAM_TOKEN;

  const localTokenPath = path.join(CWD, '.shazam-token');
  if (fs.existsSync(localTokenPath)) {
    try {
      const saved = fs.readFileSync(localTokenPath, 'utf8').trim();
      if (saved.length >= 16) return saved;
    } catch {}
  }

  // Generate a cryptographically strong random token
  const crypto = require('crypto');
  const generated = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(localTokenPath, generated, { mode: 0o600 });
  } catch {}
  return generated;
}

const DAEMON_TOKEN = resolveSecurityToken();

console.log('\n======================================================');
console.log('⚡ Shazam AI Local Execution Companion Daemon (Hardened)');
console.log('======================================================');
console.log(`📂 Working Directory: ${CWD}`);
console.log(`🔌 Listening on:       http://localhost:${PORT}`);
console.log(`🔑 Security Token:     ${DAEMON_TOKEN}`);
console.log('======================================================');
console.log('Security: CORS restricted & Token validation enforced.\n');

// Allowed origins
const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/shazam-ai\.[a-z0-9_-]+\.workers\.dev$/,
  /^https:\/\/shazam(-[a-z0-9]+)?\.vercel\.app$/,
];

function isOriginAllowed(origin) {
  if (!origin) return true; // Direct non-browser calls (curl, scripts)
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-shazam-token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Support Chrome Private Network Access (PNA)
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function verifyAuth(req, res, parsedUrl) {
  const tokenHeader = req.headers['x-shazam-token'];
  const tokenQuery = parsedUrl.searchParams.get('token');
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const candidate = tokenHeader || tokenQuery || bearerToken;
  if (!candidate || candidate !== DAEMON_TOKEN) {
    sendJson(res, 401, {
      error: 'Unauthorized: Invalid or missing x-shazam-token.',
      hint: 'Provide the security token displayed in your companion daemon terminal.',
    });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin)) {
    return sendJson(res, 403, { error: 'Forbidden origin.' });
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // 1. Health check & status (public, allows checking daemon liveness)
  if (pathname === '/api/health' || pathname === '/') {
    sendJson(res, 200, {
      status: 'active',
      daemon: 'shazam-local-bridge',
      version: '0.3.0',
      cwd: CWD,
      projectName: path.basename(CWD),
      authRequired: true,
      hasSavedToken: fs.existsSync(path.join(CWD, '.shazam-token')),
    });
    return;
  }

  // 2. Token handoff for authorized local origin
  if (pathname === '/api/auth/token' && req.method === 'GET') {
    // Only allow localhost origins to auto-retrieve token without entering it
    const isLocal = !origin || origin.includes('localhost') || origin.includes('127.0.0.1');
    if (!isLocal) {
      return sendJson(res, 403, { error: 'Token handoff restricted to local clients.' });
    }
    return sendJson(res, 200, { token: DAEMON_TOKEN });
  }

  // All endpoints below REQUIRE valid authentication token
  if (!verifyAuth(req, res, parsedUrl)) {
    return;
  }

  // 3. List project directory files recursively
  if (pathname === '/api/files' && req.method === 'GET') {
    try {
      const files = listProjectFiles(CWD, CWD);
      sendJson(res, 200, { files });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 4. Read specific file from disk
  if (pathname === '/api/files/read' && req.method === 'POST') {
    try {
      const { filePath, startLine, endLine } = await parseJsonBody(req);
      if (!filePath) return sendJson(res, 400, { error: 'filePath is required.' });

      const resolved = path.resolve(CWD, filePath);
      if (!resolved.startsWith(CWD)) {
        return sendJson(res, 403, { error: 'Path traversal forbidden.' });
      }

      if (!fs.existsSync(resolved)) {
        return sendJson(res, 404, { error: `File "${filePath}" not found.` });
      }

      const content = fs.readFileSync(resolved, 'utf8');
      if (typeof startLine === 'number' && typeof endLine === 'number') {
        const lines = content.split('\n');
        const sliced = lines.slice(Math.max(0, startLine - 1), endLine).join('\n');
        return sendJson(res, 200, { path: filePath, content: sliced, totalLines: lines.length });
      }

      sendJson(res, 200, { path: filePath, content });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 5. Targeted Search & Replace Surgical Patch (Claude / Antigravity standard)
  if (pathname === '/api/files/patch' && req.method === 'POST') {
    try {
      const { filePath, searchBlock, replaceBlock } = await parseJsonBody(req);
      if (!filePath || typeof searchBlock !== 'string' || typeof replaceBlock !== 'string') {
        return sendJson(res, 400, { error: 'filePath, searchBlock, and replaceBlock are required.' });
      }

      const resolved = path.resolve(CWD, filePath);
      if (!resolved.startsWith(CWD)) {
        return sendJson(res, 403, { error: 'Path traversal forbidden.' });
      }

      if (!fs.existsSync(resolved)) {
        return sendJson(res, 404, { error: `File "${filePath}" not found.` });
      }

      const original = fs.readFileSync(resolved, 'utf8');
      
      // Attempt exact match
      let updated = null;
      if (original.includes(searchBlock)) {
        updated = original.replace(searchBlock, replaceBlock);
      } else {
        // Attempt line-trimmed normalization match
        const normOriginal = original.replace(/\r\n/g, '\n');
        const normSearch = searchBlock.replace(/\r\n/g, '\n');
        if (normOriginal.includes(normSearch)) {
          updated = normOriginal.replace(normSearch, replaceBlock.replace(/\r\n/g, '\n'));
        }
      }

      if (updated === null) {
        return sendJson(res, 422, {
          error: 'Search block not found in target file.',
          filePath,
        });
      }

      fs.writeFileSync(resolved, updated, 'utf8');
      console.log(`🎯 [SURGICAL PATCH APPLIED] ${filePath}`);
      sendJson(res, 200, { success: true, filePath, bytesWritten: updated.length });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 6. Write / Create whole files on disk
  if (pathname === '/api/files/write' && req.method === 'POST') {
    try {
      const { filePath, content } = await parseJsonBody(req);
      if (!filePath || typeof content !== 'string') {
        return sendJson(res, 400, { error: 'filePath and content are required.' });
      }

      const resolved = path.resolve(CWD, filePath);
      if (!resolved.startsWith(CWD)) {
        return sendJson(res, 403, { error: 'Path traversal forbidden.' });
      }

      const parentDir = path.dirname(resolved);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, 'utf8');
      console.log(`📝 [FILE WRITTEN] ${filePath} (${content.length} bytes)`);

      sendJson(res, 200, { success: true, path: filePath, bytesWritten: content.length });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 7. Run terminal / shell execution with streaming SSE
  if (pathname === '/api/exec' && req.method === 'POST') {
    try {
      const { command } = await parseJsonBody(req);
      if (!command) return sendJson(res, 400, { error: 'command is required.' });

      console.log(`\n💻 [RUNNING EXEC] $ ${command}`);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const child = spawn(command, {
        shell: true,
        cwd: CWD,
        env: process.env,
      });

      child.stdout.on('data', data => {
        const text = data.toString();
        process.stdout.write(text);
        res.write(`data: ${JSON.stringify({ type: 'stdout', text })}\n\n`);
      });

      child.stderr.on('data', data => {
        const text = data.toString();
        process.stderr.write(text);
        res.write(`data: ${JSON.stringify({ type: 'stderr', text })}\n\n`);
      });

      child.on('close', code => {
        console.log(`🏁 [COMMAND FINISHED] Exit code: ${code}\n`);
        res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
        res.end();
      });

      child.on('error', err => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      });

      req.on('close', () => {
        child.kill();
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 8. Native Git Status & Push
  if (pathname === '/api/git/status' && req.method === 'GET') {
    try {
      const statusOutput = execSync('git status --short', { cwd: CWD, encoding: 'utf8' });
      const branchOutput = execSync('git rev-parse --abbrev-ref HEAD', { cwd: CWD, encoding: 'utf8' }).trim();
      sendJson(res, 200, { branch: branchOutput, status: statusOutput });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/git/push' && req.method === 'POST') {
    try {
      const { message = 'chore: update files from Shazam AI agent' } = await parseJsonBody(req);
      execSync('git add -A', { cwd: CWD });
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: CWD });
      const pushOutput = execSync('git push', { cwd: CWD, encoding: 'utf8' });
      console.log(`🚀 [GIT PUSH SUCCESS] ${pushOutput}`);
      sendJson(res, 200, { success: true, output: pushOutput });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Endpoint not found.' });
});

// Helper to list files excluding node_modules, .git, etc.
const IGNORED = new Set(['node_modules', '.git', '.next', '.open-next', 'dist', 'build', '.DS_Store']);

function listProjectFiles(dir, baseDir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      listProjectFiles(fullPath, baseDir, fileList);
    } else {
      fileList.push({
        path: relativePath,
        size: fs.statSync(fullPath).size,
      });
    }
  }

  return fileList;
}

server.listen(PORT, '127.0.0.1', () => {
  // ready
});
