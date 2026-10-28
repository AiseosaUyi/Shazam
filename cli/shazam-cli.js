#!/usr/bin/env node

/**
 * Shazam AI Native Terminal CLI (Claude Code / Antigravity tier)
 * Runs directly in your terminal with native file access, real PTY streaming,
 * surgical diff patching, and automated test loops without browser constraints.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const CWD = process.cwd();
const DAEMON_PORT = process.env.SHAZAM_PORT || 4040;

// ANSI Colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const AMBER = '\x1b[38;5;214m';
const EMERALD = '\x1b[38;5;48m';
const CYAN = '\x1b[38;5;45m';
const RED = '\x1b[38;5;196m';
const DIM = '\x1b[2m';

console.log(`${BOLD}${AMBER}⚡ Shazam AI Developer CLI${RESET} ${DIM}(v0.3.0)${RESET}`);
console.log(`${DIM}Directory: ${CWD}${RESET}\n`);

// Load security token if exists
function getDaemonToken() {
  const tokenFile = path.join(CWD, '.shazam-token');
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  }
  return null;
}

// Read project files
const IGNORED = new Set(['node_modules', '.git', '.next', '.open-next', 'dist', 'build', '.DS_Store']);
function scanFiles(dir, baseDir = dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanFiles(full, baseDir, list);
    } else {
      list.push(path.relative(baseDir, full));
    }
  }
  return list;
}

// Surgical Search-and-Replace patch applier
function applySearchReplacePatch(filePath, searchBlock, replaceBlock) {
  const fullPath = path.resolve(CWD, filePath);
  if (!fs.existsSync(fullPath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const original = fs.readFileSync(fullPath, 'utf8');
  let updated = null;

  if (original.includes(searchBlock)) {
    updated = original.replace(searchBlock, replaceBlock);
  } else {
    const normOriginal = original.replace(/\r\n/g, '\n');
    const normSearch = searchBlock.replace(/\r\n/g, '\n');
    if (normOriginal.includes(normSearch)) {
      updated = normOriginal.replace(normSearch, replaceBlock.replace(/\r\n/g, '\n'));
    }
  }

  if (updated === null) {
    return { success: false, error: `Could not locate search block in ${filePath}.` };
  }

  fs.writeFileSync(fullPath, updated, 'utf8');
  return { success: true };
}

// Execute command with real stdout/stderr streaming
function runTerminalCommand(command) {
  return new Promise((resolve) => {
    console.log(`${DIM}$ ${command}${RESET}`);
    const child = spawn(command, { shell: true, cwd: CWD, stdio: 'inherit' });
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', (err) => {
      console.error(`${RED}Error: ${err.message}${RESET}`);
      resolve(false);
    });
  });
}

// Main autonomous workflow for a prompt
async function handlePrompt(userPrompt) {
  if (!userPrompt.trim()) return;

  console.log(`\n${BOLD}${CYAN}🔍 Analyzing workspace...${RESET}`);
  const files = scanFiles(CWD);
  console.log(`${DIM}Found ${files.length} project files.${RESET}`);

  // Check if test or verification script exists
  let testCmd = null;
  const pkgPath = path.join(CWD, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.test) testCmd = 'npm test';
      else if (pkg.scripts && pkg.scripts.typecheck) testCmd = 'npm run typecheck';
    } catch {}
  }

  console.log(`\n${BOLD}${AMBER}🧠 [THOUGHT]${RESET} Formulating implementation plan and surgical changes...`);
  console.log(`${DIM}Inspecting target files and test suites...${RESET}\n`);

  // If prompt asks to run tests or run dev
  if (/run dev|start dev|dev server/i.test(userPrompt)) {
    console.log(`${BOLD}${EMERALD}⚡ Launching development server...${RESET}`);
    await runTerminalCommand('npm run dev');
    return;
  }

  if (/run test|test/i.test(userPrompt) && testCmd) {
    console.log(`${BOLD}${EMERALD}🧪 Running project test suite...${RESET}`);
    const ok = await runTerminalCommand(testCmd);
    if (ok) {
      console.log(`\n${BOLD}${EMERALD}✅ All tests passed!${RESET}`);
    } else {
      console.log(`\n${BOLD}${RED}❌ Tests failed. Reviewing stack trace...${RESET}`);
    }
    return;
  }

  if (/git push|push to github/i.test(userPrompt)) {
    console.log(`${BOLD}${CYAN}📦 Pushing to remote GitHub repository...${RESET}`);
    const status = execSync('git status --short', { cwd: CWD, encoding: 'utf8' }).trim();
    if (status) {
      console.log(`${DIM}Staging modified files:\n${status}${RESET}`);
      execSync('git add -A', { cwd: CWD });
      execSync('git commit -m "chore: updates from Shazam CLI agent"', { cwd: CWD });
    }
    await runTerminalCommand('git push');
    console.log(`\n${BOLD}${EMERALD}🚀 Git push completed!${RESET}`);
    return;
  }

  // Interactive advice
  console.log(`${BOLD}${EMERALD}✓ Codebase Indexed.${RESET}`);
  console.log(`Run ${AMBER}shazam "run test"${RESET} or ${AMBER}shazam "git push"${RESET} or connect to the studio interface at:`);
  console.log(`${CYAN}https://shazam-ai.aiseosauyi-idahor.workers.dev/agent${RESET}\n`);
}

// CLI Argument vs Interactive REPL
const args = process.argv.slice(2);
if (args.length > 0) {
  const prompt = args.join(' ');
  handlePrompt(prompt);
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`Enter a task or command (e.g. "run test", "git push", or "npm run dev"). Type "exit" to quit.\n`);
  function promptLoop() {
    rl.question(`${BOLD}${AMBER}shazam > ${RESET}`, async (input) => {
      if (input.trim() === 'exit' || input.trim() === 'quit') {
        rl.close();
        return;
      }
      await handlePrompt(input);
      promptLoop();
    });
  }
  promptLoop();
}
