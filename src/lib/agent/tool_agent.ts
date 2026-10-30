import { tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { streamAgent } from './stream';
import { z } from 'zod';
import { validateFilePath } from './policy';
import { buildProjectIndex } from './indexer';
import type { ProjectSandbox } from './sandbox';

/**
 * Native tool-calling coding agent (Claude Code / OpenCode style) on the AI SDK.
 *
 * The model receives real JSON-schema tools and the provider's function-calling API,
 * instead of the old THOUGHT/ACTION text protocol that free models kept breaking.
 */

export interface AgentFile {
  path: string;
  content: string;
}

export type CommandRunner = (command: string, signal?: AbortSignal) => Promise<{ exitCode: number; output: string }>;

export interface ToolAgentOptions {
  model: LanguageModel;
  prompt: string;
  history?: ModelMessage[];
  projectName: string;
  files: AgentFile[];
  /** Real execution backend (Vercel Sandbox or local bridge). Absent → commands are reported NOT RUN. */
  sandbox?: ProjectSandbox | null;
  runCommand?: CommandRunner;
  /** Extra tools, e.g. connected MCP servers and skills. */
  extraTools?: ToolSet;
  extraInstructions?: string;
  /** Work directly in a folder on the user's computer through the desktop bridge. */
  local?: { root: string; deviceName: string; call: (command: string, payload: Record<string, unknown>, timeoutMs?: number) => Promise<string> };
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (event: string, data: unknown) => void;
}

export interface ToolAgentResult {
  text: string;
  filesModified: string[];
  filesDeleted: string[];
  steps: number;
  commandsRun: Array<{ command: string; exitCode: number }>;
}

const MAX_READ_LINES = 400;

/** Exact match first, then a whitespace-insensitive line match (models often re-indent). */
export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): { ok: true; content: string; count: number } | { ok: false; error: string } {
  if (oldString === '') return { ok: false, error: 'old_string is empty. Use write_file to create a file.' };
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 1 || (occurrences > 1 && replaceAll)) {
    return { ok: true, content: content.split(oldString).join(newString), count: occurrences };
  }
  if (occurrences > 1) {
    return { ok: false, error: `old_string matches ${occurrences} places. Add surrounding lines to make it unique, or set replace_all.` };
  }

  const lines = content.split('\n');
  const target = oldString.split('\n').map((l) => l.trim());
  while (target.length && target[target.length - 1] === '') target.pop();
  const matches: number[] = [];
  for (let i = 0; i + target.length <= lines.length; i++) {
    if (target.every((t, j) => lines[i + j].trim() === t)) matches.push(i);
  }
  if (matches.length === 1) {
    const i = matches[0];
    const updated = [...lines.slice(0, i), ...newString.split('\n'), ...lines.slice(i + target.length)];
    return { ok: true, content: updated.join('\n'), count: 1 };
  }
  return {
    ok: false,
    error: matches.length > 1
      ? 'old_string matches several places (ignoring indentation). Include more context.'
      : 'old_string not found. Call read_file and copy the exact current text.',
  };
}

function buildInstructions(projectName: string, files: AgentFile[], hasExecution: boolean, extra?: string): string {
  const index = buildProjectIndex(files);
  return `You are Shazam Code, an autonomous senior software engineer working in the project "${projectName}".
You work by calling tools. Do not paste whole files into chat: write them with tools. Never ask the user to copy code.
Do not ask clarifying questions for normal requests: pick sensible defaults (e.g. Next.js + Tailwind, or plain HTML/CSS for a simple page), build it, and mention the choices in your summary.

Workflow:
1. Explore first: list_files, grep, read_file. Never guess what a file contains.
2. Make changes with edit_file (exact old_string → new_string) for existing files and write_file for new files.
3. ${hasExecution
    ? 'Verify with run_command (install deps, typecheck, run tests). If something fails, read the error, fix it, and re-run until it passes.'
    : 'No execution environment is connected, so run_command will report NOT RUN. Say clearly in your final message that the code was not executed.'}
4. Keep a todo list with todo_write for multi-step tasks.
5. For web UIs, install dependencies, then call start_preview so the user can see it live.
6. Finish with a short summary: what changed (file list), how it was verified, the preview URL, and anything left to do.

Rules:
- Never claim a command, test or build succeeded unless a run_command result in this conversation shows it.
- Never touch secrets (.env, keys) or paths outside the project.
- Prefer small, focused edits. Match the project's existing style.

Project index:
${index.summaryPrompt}
${extra ? `\n${extra}` : ''}`;
}

function buildLocalInstructions(root: string, deviceName: string, index: string, extra?: string): string {
  return `You are Shazam Code, an autonomous senior software engineer working directly in the user's folder ${root} on their computer "${deviceName}".
Work like Claude Code: do the task end to end with tools. Never ask the user to copy code, and never paste whole files into chat.
Do not ask clarifying questions for normal requests: choose sensible defaults (e.g. Next.js + Tailwind, or plain HTML/CSS for a simple page) and state them in your summary.

Workflow: explore (list_files, grep, read_file) → change files (edit_file / write_file) → verify with run_command (install, build, test) → fix until it works → for web UIs call start_preview → summarize what changed, how it was verified and the preview URL.
Never claim something passed unless run_command output shows it. Risky commands (git push, deletes) are confirmed by the user on their computer.

Files in the folder (partial):
${index.slice(0, 6000)}
${extra ? `\n${extra}` : ''}`;
}

export async function runToolAgent(options: ToolAgentOptions): Promise<ToolAgentResult> {
  const { model, prompt, history = [], projectName, files, sandbox, runCommand, extraTools = {}, extraInstructions, local, maxSteps = 40, signal, onEvent } = options;

  const filesModified = new Set<string>();
  const filesDeleted = new Set<string>();
  const commandsRun: Array<{ command: string; exitCode: number }> = [];
  /** Models often send "/app/x.tsx", "./x" or sandbox-absolute paths; map them all to project paths. */
  const norm = (p: string) => (p || '').replace(/^\/vercel\/sandbox\//, '').replace(/^\.?\//, '').replace(/^\/+/, '');
  const findFile = (p: string) => files.find((f) => f.path === norm(p));
  const hasExecution = Boolean(sandbox || runCommand || local);

  const guardPath = (p: string): string | null => {
    const check = validateFilePath(p);
    return check.valid ? null : `Blocked by safety policy: ${check.error}`;
  };

  const tools: ToolSet = {
    list_files: tool({
      description: 'List project file paths, optionally filtered by a path prefix or glob-like substring.',
      inputSchema: z.object({ prefix: z.string().optional().describe('e.g. "src/" or "test"') }),
      execute: async ({ prefix }) => {
        const p = (prefix || '').replace(/^\.\//, '').replace(/\*+/g, '').toLowerCase();
        const paths = files.map((f) => f.path).filter((x) => x.toLowerCase().includes(p));
        return paths.length ? paths.slice(0, 500).join('\n') : 'No files match. The project may be empty; use write_file.';
      },
    }),
    grep: tool({
      description: 'Search all project files for a regular expression (case-insensitive). Returns path:line: text.',
      inputSchema: z.object({ pattern: z.string(), path_prefix: z.string().optional() }),
      execute: async ({ pattern, path_prefix }) => {
        let rx: RegExp;
        try {
          rx = new RegExp(pattern, 'i');
        } catch {
          rx = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }
        const hits: string[] = [];
        for (const f of files) {
          if (path_prefix && !f.path.startsWith(path_prefix)) continue;
          const lines = f.content.split('\n');
          for (let i = 0; i < lines.length && hits.length < 100; i++) {
            if (rx.test(lines[i])) hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
        }
        return hits.length ? hits.join('\n') : `No matches for /${pattern}/.`;
      },
    }),
    read_file: tool({
      description: `Read a file with line numbers. Reads up to ${MAX_READ_LINES} lines; use offset for more.`,
      inputSchema: z.object({ path: z.string(), offset: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(2000).optional() }),
      execute: async ({ path, offset = 1, limit = MAX_READ_LINES }) => {
        const f = findFile(path);
        if (!f) return `Error: ${path} does not exist.`;
        const lines = f.content.split('\n');
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const body = slice.map((l, i) => `${offset + i}\t${l}`).join('\n');
        const more = offset - 1 + limit < lines.length ? `\n… ${lines.length - (offset - 1 + limit)} more lines (use offset).` : '';
        return `${path} (${lines.length} lines)\n${body}${more}`;
      },
    }),
    edit_file: tool({
      description: 'Replace old_string with new_string in an existing file. old_string must match the current file text (copy it from read_file).',
      inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const blocked = guardPath(path);
        if (blocked) return blocked;
        const f = findFile(path);
        if (!f) return `Error: ${path} does not exist. Use write_file to create it.`;
        const result = applyEdit(f.content, old_string, new_string, replace_all);
        if (!result.ok) return `Edit failed: ${result.error}`;
        f.content = result.content;
        filesModified.add(f.path);
        onEvent?.('file_changed', { path: f.path, action: 'edit' });
        return `Edited ${f.path} (${result.count} replacement${result.count > 1 ? 's' : ''}).`;
      },
    }),
    write_file: tool({
      description: 'Create a new file or fully replace a small file with the given content.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const blocked = guardPath(path);
        if (blocked) return blocked;
        const clean = norm(path);
        const existing = findFile(clean);
        if (existing) existing.content = content;
        else files.push({ path: clean, content });
        filesModified.add(clean);
        filesDeleted.delete(clean);
        onEvent?.('file_changed', { path: clean, action: existing ? 'overwrite' : 'create' });
        return `${existing ? 'Overwrote' : 'Created'} ${clean} (${content.split('\n').length} lines).`;
      },
    }),
    delete_file: tool({
      description: 'Delete a project file.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const blocked = guardPath(path);
        if (blocked) return blocked;
        const idx = files.findIndex((f) => f.path === norm(path));
        if (idx === -1) return `Error: ${path} does not exist.`;
        const [removed] = files.splice(idx, 1);
        filesModified.delete(removed.path);
        filesDeleted.add(removed.path);
        onEvent?.('file_changed', { path: removed.path, action: 'delete' });
        return `Deleted ${removed.path}.`;
      },
    }),
    run_command: tool({
      description: 'Run a shell command in the project root (e.g. "npm install", "npx tsc --noEmit", "npm test"). Must finish on its own: never start dev servers here, use start_preview. Returns exit code and output.',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }, { abortSignal }) => {
        if (!sandbox && !runCommand) {
          return `NOT RUN: no sandbox or local bridge is connected, so "${command}" was not executed. Do not claim it passed.`;
        }
        try {
          let result;
          if (sandbox) {
            await sandbox.sync(files);
            result = await sandbox.run(command, 180_000, abortSignal);
          } else {
            result = await runCommand!(command, abortSignal);
          }
          commandsRun.push({ command, exitCode: result.exitCode });
          const out = result.output.length > 8000 ? `…(truncated)\n${result.output.slice(-8000)}` : result.output;
          return `$ ${command}\nexit code: ${result.exitCode}\n${out || '(no output)'}`;
        } catch (err: any) {
          return `Command could not run: ${err.message || err}`;
        }
      },
    }),
    todo_write: tool({
      description: 'Record the current task plan. Pass the full list each time with statuses.',
      inputSchema: z.object({
        todos: z.array(z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) })),
      }),
      execute: async ({ todos }) => {
        onEvent?.('todos', { todos });
        return 'Todo list updated.';
      },
    }),
    web_fetch: tool({
      description: 'Fetch a public https URL (docs, API references) and return its text.',
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const u = new URL(url);
        if (u.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) {
          return 'Error: only public https URLs are allowed.';
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ShazamAgent/1.0' } });
        const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        return `HTTP ${res.status}\n${text.slice(0, 12000)}`;
      },
    }),
    ...extraTools,
  };

  if (sandbox && !local) {
    tools.start_preview = tool({
      description: 'Start the dev server in the background and get a public preview URL to show the user (e.g. command "npm run dev -- --port 3000 --hostname 0.0.0.0", port 3000). Install dependencies first.',
      inputSchema: z.object({ command: z.string(), port: z.union([z.literal(3000), z.literal(5173)]) }),
      execute: async ({ command, port }) => {
        try {
          await sandbox.sync(files);
          const r = await sandbox.startPreview(command, port);
          onEvent?.('preview', { url: r.url });
          return `Preview running at ${r.url}\n${r.output.slice(-2000)}`;
        } catch (err: any) {
          return `Error: preview failed: ${err.message || err}`;
        }
      },
    });
  }

  let localIndex = '';
  if (local) {
    // Same tool names, backed by the user's real folder via the desktop bridge.
    const abs = (p: string) => (p.startsWith('/') ? p : `${local.root.replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`);
    const mark = (p: string, action: string) => {
      filesModified.add(p);
      onEvent?.('file_changed', { path: p, action });
    };
    Object.assign(tools, {
      list_files: tool({
        description: `List files in the user's folder ${local.root} (skips node_modules, .git).`,
        inputSchema: z.object({ prefix: z.string().optional() }),
        execute: async ({ prefix }) => local.call('list_files', { path: abs(prefix || '.'), max: 800 }),
      }),
      grep: tool({
        description: 'Search the folder for a regular expression. Returns path:line: text.',
        inputSchema: z.object({ pattern: z.string() }),
        execute: async ({ pattern }) => local.call('grep', { path: local.root, pattern }),
      }),
      read_file: tool({
        description: 'Read a file (with line numbers) from the user\'s folder.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => local.call('read_file', { path: abs(path) }),
      }),
      edit_file: tool({
        description: 'Replace an exact old_string with new_string in a file in the user\'s folder.',
        inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
        execute: async ({ path, old_string, new_string }) => {
          const out = await local.call('edit_file', { path: abs(path), old_string, new_string });
          if (!/^Error/.test(out)) mark(path, 'edit');
          return out;
        },
      }),
      write_file: tool({
        description: 'Create or overwrite a file in the user\'s folder.',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => {
          const out = await local.call('write_file', { path: abs(path), content });
          if (!/^Error/.test(out)) mark(path, 'write');
          return out;
        },
      }),
      delete_file: tool({
        description: 'Delete a file in the user\'s folder.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => local.call('exec', { cwd: local.root, command: `rm -- ${JSON.stringify(abs(path))}` }),
      }),
      run_command: tool({
        description: `Run a shell command in ${local.root} on the user's computer (installs, tests, builds, git). Must finish on its own: never start servers here, use start_preview. Returns exit code and output.`,
        inputSchema: z.object({ command: z.string() }),
        execute: async ({ command }) => {
          const out = await local.call('exec', { cwd: local.root, command, timeoutMs: 300_000 }, 330_000);
          const code = Number(out.match(/exit code: (\d+)/)?.[1] ?? 1);
          commandsRun.push({ command, exitCode: code });
          return out;
        },
      }),
      start_preview: tool({
        description: 'Start the dev server on the user\'s computer in the background (e.g. "npm run dev"). Returns the localhost URL to share with the user.',
        inputSchema: z.object({ command: z.string(), port: z.number().int().min(1024).max(65535) }),
        execute: async ({ command, port }) => {
          const out = await local.call('spawn', { cwd: local.root, command, waitMs: 9000 }, 40_000);
          onEvent?.('preview', { url: `http://localhost:${port}` });
          return `${out}\nPreview: http://localhost:${port} (on ${local.deviceName})`;
        },
      }),
    });
    localIndex = await local.call('list_files', { path: local.root, max: 400 }).catch(() => '');
  }

  const { text, steps } = await streamAgent({
    model,
    instructions: local
      ? buildLocalInstructions(local.root, local.deviceName, localIndex, extraInstructions)
      : buildInstructions(projectName, files, hasExecution, extraInstructions),
    messages: [...history, { role: 'user', content: prompt }],
    tools,
    maxSteps,
    signal,
    onEvent,
  });

  return {
    text,
    filesModified: Array.from(filesModified),
    filesDeleted: Array.from(filesDeleted),
    steps,
    commandsRun,
  };
}
