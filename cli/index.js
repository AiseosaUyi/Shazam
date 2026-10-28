#!/usr/bin/env node

/**
 * Shazam AI Local Companion Daemon
 * Provides secure local execution capabilities (File I/O, Shell execution, Git operations)
 * to the Shazam AI web & desktop interfaces via a local loopback server (localhost:4040).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = process.env.SHAZAM_PORT || 4040;
const CWD = process.cwd();

// Auto-generated one-time session token for local bridge security
const DAEMON_TOKEN = process.env.SHAZAM_TOKEN || Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

console.log('\n======================================================');
console.log('⚡ Shazam AI Local Execution Companion Daemon');
console.log('======================================================');
console.log(`📂 Working Directory: ${CWD}`);
console.log(`🔌 Listening on:       http://localhost:${PORT}`);
console.log(`🔑 Security Token:     ${DAEMON_TOKEN}`);
console.log('======================================================');
console.log('Keep this terminal open while using Shazam AI.\n');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-shazam-token');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
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

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // 1. Health check & status
  if (pathname === '/api/health' || pathname === '/') {
    sendJson(res, 200, {
      status: 'active',
      daemon: 'shazam-local-bridge',
      version: '0.1.0',
      cwd: CWD,
      projectName: path.basename(CWD),
    });
    return;
  }

  // 2. List project directory files recursively
  if (pathname === '/api/files' && req.method === 'GET') {
    try {
      const files = listProjectFiles(CWD, CWD);
      sendJson(res, 200, { files });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 3. Read specific file from disk
  if (pathname === '/api/files/read' && req.method === 'POST') {
    try {
      const { filePath } = await parseJsonBody(req);
      if (!filePath) return sendJson(res, 400, { error: 'filePath is required.' });

      const resolved = path.resolve(CWD, filePath);
      if (!resolved.startsWith(CWD)) {
        return sendJson(res, 403, { error: 'Path traversal forbidden.' });
      }

      if (!fs.existsSync(resolved)) {
        return sendJson(res, 404, { error: `File "${filePath}" not found.` });
      }

      const content = fs.readFileSync(resolved, 'utf8');
      sendJson(res, 200, { path: filePath, content });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 4. Write / Update real files on disk
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

  // 5. Run terminal / shell execution (e.g. npm run dev, test, git push) with streaming SSE
  if (pathname === '/api/exec' && req.method === 'POST') {
    try {
      const { command } = await parseJsonBody(req);
      if (!command) return sendJson(res, 400, { error: 'command is required.' });

      console.log(`\n💻 [RUNNING EXEC] $ ${command}`);

      // Set up SSE streaming
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

  // 6. Native Git Status & Push
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
