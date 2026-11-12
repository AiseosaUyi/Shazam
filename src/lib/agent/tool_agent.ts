import { tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { streamAgent, startMessages, type ResumableRun } from './stream';
import { z } from 'zod';
import { validateFilePath } from './policy';
import { buildProjectIndex } from './indexer';
import type { ProjectSandbox } from './sandbox';
import { errMessage } from '@/lib/errors';
import { webFetchText, webSearch } from './web';
import { EditFailureTracker, failureAdvice, nearestLines, replaceLineRange, stripLineNumbers } from './edit-hints';
import { createHash } from 'node:crypto';
import { composeFixPrompt, formatFixResults, splitBrief, type FixItem, type FixResult, type SubtaskState } from './multi-fix';
import { StallGuard, type StallGuardOptions } from './stall-guard';
import { countLines, parseCommitHash, promptAsksForChanges, type CommandRecord, type EditRecord } from '@/lib/runs/report';

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

export interface ToolAgentOptions extends ResumableRun {
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
  /** Plan mode: only read-only tools are offered, and the run ends with a written plan. */
  planMode?: boolean;
  /** Multi-fix continuation: set on a resumed segment of a run that was split into sub-tasks. */
  subtasks?: SubtaskState;
  /** Stall guard settings. On by default for runs that ask for changes (never in plan mode). */
  stallGuard?: StallGuardOptions;
  signal?: AbortSignal;
  onEvent?: (event: string, data: unknown) => void;
}

export interface ToolAgentResult {
  text: string;
  filesModified: string[];
  filesDeleted: string[];
  steps: number;
  commandsRun: CommandRecord[];
  /** Every successful edit/write/delete, recorded from tool results (not from model prose). */
  edits: EditRecord[];
  /** Stopped at the time limit before finishing; resume from the saved checkpoint. */
  paused: boolean;
  /** Ended early because too many steps passed with no edit. */
  stalled: boolean;
  /** Tool calls since the last successful edit (carries across resumed segments). */
  stepsSinceLastEdit: number;
  /** Files the run read, for the stalled message and the director. */
  filesRead: string[];
  /** Files someone else changed between this run reading them and editing them. */
  externalChanges: string[];
  /** Set when a multi-fix run paused: what is still to do, so the next segment continues it. */
  subtasks?: SubtaskState;
}

/** Tools that never change files or run commands. Plan mode and subagents are limited to these. */
export const READ_ONLY_TOOLS = ['list_files', 'grep', 'read_file', 'web_fetch', 'web_search'] as const;
/** Plan mode also keeps the planning helpers and the read-only subagent tool. */
export const PLAN_MODE_TOOLS = [...READ_ONLY_TOOLS, 'todo_write', 'ask_user', 'task'] as const;
/** Commands that start a server and never exit. They hang the step; servers go through start_preview. */
export function startsServer(command: string): boolean {
  return /\b(http\.server|live-server|nodemon|next (dev|start)|vite(?=\s|$)|webpack serve|npm (run )?(dev|start)(?=\s|$)|pnpm (run )?(dev|start)(?=\s|$)|yarn (dev|start)(?=\s|$)|npx (serve|http-server))\b/i.test(command);
}

const SERVER_IN_RUN_COMMAND = 'Error: that command starts a long-running server, which cannot run here. Use start_preview for dev servers. Do not retry it with another port.';
const PREVIEW_GIVE_UP = 'Preview is not available after several attempts. Stop trying: the files are written and checked, so finish by summarizing what was built and say the live preview could not be started.';

export const MAX_SUBAGENTS = 4;
export const SUBAGENT_MAX_STEPS = 12;
export const SUBAGENT_TIME_MS = 120_000;
export const SUBAGENT_SUMMARY_CHARS = 2000;

const PLAN_MODE_NOTE = `PLAN MODE (overrides the workflow above): you can only read and research. You cannot edit files or run commands, and those tools are not available.
Explore with list_files, grep, read_file, web_search, web_fetch (or the task tool for a focused read-only investigation), then finish with a written plan as your final message: goal, the files you would change and how, the steps in order, how to verify, and risks or open questions. Do not claim any change was made.`;

const SUBAGENT_INSTRUCTIONS = `You are a read-only research subagent. Investigate the question you are given using list_files, grep, read_file, web_search and web_fetch. You cannot edit files or run commands.
Be efficient: you have a small step budget. Finish with a concise summary (under ${SUBAGENT_SUMMARY_CHARS} characters) that names exact file paths and line numbers and states what you found. If you could not find something, say so plainly. Never guess.`;

export function pickTools(tools: ToolSet, names: readonly string[]): ToolSet {
  const out: ToolSet = {};
  for (const n of names) if (tools[n]) out[n] = tools[n];
  return out;
}

const MAX_READ_LINES = 400;
/** Smaller default for local runs: every line read is resent on every later step. */
const LOCAL_READ_LINES = 200;

/** Cuts a line-numbered file listing ("1\tcode") to a range, with a hint when more remains. */
export function sliceNumbered(path: string, numbered: string, offset: number, limit: number): string {
  if (/^Error/.test(numbered)) return numbered;
  const lines = numbered.split('\n');
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const rest = lines.length - (offset - 1 + limit);
  return `${path} (${lines.length} lines)\n${slice.join('\n')}${rest > 0 ? `\n… ${rest} more lines (read again with offset=${offset + limit}).` : ''}`;
}

/** Syntax-only parse of one file with the project's typescript. No single quotes: it is wrapped in them for the shell. */
const TS_PARSE_SCRIPT = [
  'let ts;try{ts=require("typescript")}catch(e){process.exit(0)}',
  'const f=process.argv[1];',
  'const r=ts.transpileModule(require("fs").readFileSync(f,"utf8"),{reportDiagnostics:true,fileName:f,compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ESNext}});',
  'const d=r.diagnostics||[];',
  'for(const x of d){const p=x.file&&x.start!==undefined?x.file.getLineAndCharacterOfPosition(x.start):null;console.error(f+(p?":"+(p.line+1)+":"+(p.character+1):"")+" "+ts.flattenDiagnosticMessageText(x.messageText," "))}',
  'process.exit(d.length?1:0)',
].join('');

/** A fast syntax check for files that can be checked without a build (null = none). */
export function syntaxCheckCommand(absPath: string): string | null {
  const q = JSON.stringify(absPath);
  if (/\.(c|m)?js$/i.test(absPath)) return `node --check ${q}`;
  if (/\.json$/i.test(absPath)) return `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" ${q}`;
  // TS/TSX/JSX: parse with the project's own typescript (syntax only, no type check). Silent when typescript is not installed.
  if (/\.(c|m)?tsx?$|\.jsx$/i.test(absPath)) return `node -e '${TS_PARSE_SCRIPT}' ${q}`;
  return null;
}

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
  return `You are Arcwork Code, an autonomous senior software engineer working in the project "${projectName}".
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
  return `You are Arcwork Code, an autonomous senior software engineer working directly in the user's folder ${root} on their computer "${deviceName}".
Work like Claude Code: do the task end to end with tools. Never ask the user to copy code, and never paste whole files into chat.
Do not ask clarifying questions for normal requests: choose sensible defaults (e.g. Next.js + Tailwind, or plain HTML/CSS for a simple page) and state them in your summary.

Workflow: explore (list_files, grep, read_file) → change files (edit_file / write_file) → verify with run_command (install, build, test) → fix until it works → for web UIs call start_preview → summarize what changed, how it was verified and the preview URL.
Never claim something passed unless run_command output shows it. Risky commands (git push, deletes) are confirmed by the user on their computer.

Files in the folder (partial):
${index.slice(0, 6000)}
${extra ? `\n${extra}` : ''}`;
}

/** A successful `git commit` run by the agent: keep its hash so the result can say which commits are the run's own. */
function commitField(command: string, exitCode: number, output: string): { commit?: string } {
  if (exitCode !== 0 || !/\bgit\b[^|;&]*\bcommit\b/.test(command)) return {};
  const commit = parseCommitHash(output);
  return commit ? { commit } : {};
}

/**
 * Wraps every tool so the stall guard sees each call: repeat reads of an unchanged range get a
 * short note, edits reset the counter, and results carry a firm instruction once the run has gone
 * too long without editing.
 */
export function guardTools(tools: ToolSet, guard: StallGuard, editCount: () => number): ToolSet {
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const exec = (t as any).execute;
    if (!exec) { out[name] = t; continue; }
    out[name] = {
      ...(t as any),
      execute: async (args: any, ctx: any) => {
        guard.begin();
        const before = editCount();
        let result = await exec(args, ctx);
        if (typeof result === 'string' && name === 'read_file') result = guard.checkRead(String(args?.path || ''), args?.offset, args?.limit, result) ?? result;
        if (editCount() > before) guard.onEdit();
        else if (typeof result === 'string') result = guard.annotate(result);
        return result;
      },
    } as any;
  }
  return out;
}

/**
 * A brief with 3+ labelled fixes (or 6+ files) runs as sequential sub-tasks, each with its own step
 * budget and a fresh context; everything else is one run. Plan mode and plain resumes are never split.
 */
export async function runToolAgent(options: ToolAgentOptions): Promise<ToolAgentResult> {
  const resuming = Boolean(options.resumeMessages?.length);
  const state = options.subtasks;
  if (options.planMode || (!state && resuming)) return runToolAgentOnce(options);
  const plan = state ? null : splitBrief(options.prompt);
  if (!state && !plan) return runToolAgentOnce(options);
  const st: SubtaskState = state ?? { total: plan!.items.length, preamble: plan!.preamble, postamble: plan!.postamble, pending: plan!.items, done: [], kind: plan!.kind };
  options.onEvent?.('multi_fix', { total: st.total, kind: st.kind });

  const agg: ToolAgentResult = { text: '', filesModified: [], filesDeleted: [], steps: 0, commandsRun: [], edits: [], paused: false, stalled: false, stepsSinceLastEdit: 0, filesRead: [], externalChanges: [] };
  const done: FixResult[] = [...st.done];
  let stepsLeft = options.maxSteps ?? 40;
  const fold = (r: ToolAgentResult, item: FixItem): FixResult => {
    agg.filesModified = [...new Set([...agg.filesModified, ...r.filesModified])];
    agg.filesDeleted = [...new Set([...agg.filesDeleted, ...r.filesDeleted])];
    agg.commandsRun.push(...r.commandsRun);
    agg.edits.push(...r.edits);
    agg.steps += r.steps;
    agg.filesRead = [...new Set([...agg.filesRead, ...r.filesRead])];
    agg.externalChanges = [...new Set([...agg.externalChanges, ...r.externalChanges])];
    agg.stepsSinceLastEdit = r.stepsSinceLastEdit;
    stepsLeft -= r.steps;
    return { label: item.label, status: r.edits.length ? 'done' : r.stalled ? 'stalled' : 'no_edits', summary: (r.text || '').replace(/\s+/g, ' ').slice(0, 240), steps: r.steps, files: [...new Set(r.edits.map((e) => e.path))] };
  };
  const finish = (paused: boolean, current?: FixItem, pending: FixItem[] = []): ToolAgentResult => {
    agg.text = formatFixResults(done);
    agg.paused = paused;
    agg.stalled = !paused && done.length > 0 && done.every((d) => d.status === 'stalled');
    if (paused) agg.subtasks = { ...st, done, pending, current };
    return agg;
  };

  let pending = [...st.pending];
  // Continue the fix that was in progress when the last segment paused.
  if (state && resuming && state.current) {
    const item = state.current;
    const r = await runToolAgentOnce({ ...options, subtasks: undefined, maxSteps: Math.max(10, stepsLeft) });
    done.push(fold(r, item));
    if (r.paused) return finish(true, item, pending);
  }
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const index = st.total - pending.length + i;
    const budget = Math.max(10, Math.floor(stepsLeft / (pending.length - i)));
    options.onEvent?.('fix_start', { label: item.label, index: index + 1, total: st.total });
    const r = await runToolAgentOnce({
      ...options,
      subtasks: undefined,
      prompt: composeFixPrompt(st, item, index),
      history: i === 0 && !state ? options.history : [],
      resumeMessages: undefined,
      maxSteps: budget,
      stallGuard: { ...options.stallGuard, sinceEdit: 0 },
    });
    done.push(fold(r, item));
    if (r.paused) return finish(true, item, pending.slice(i + 1));
  }
  return finish(false);
}

async function runToolAgentOnce(options: ToolAgentOptions): Promise<ToolAgentResult> {
  const { model, prompt, history = [], projectName, files, sandbox, runCommand, extraTools = {}, extraInstructions, local, maxSteps = 40, planMode = false, signal, onEvent } = options;

  const filesModified = new Set<string>();
  let previewAttempts = 0;
  const filesDeleted = new Set<string>();
  const commandsRun: CommandRecord[] = [];
  const edits: EditRecord[] = [];
  const editFailures = new EditFailureTracker();
  const externalChanges = new Set<string>();
  /** A failed edit: the nearest real lines, and after 2 failures on a file, the better tool to use. */
  const failedEdit = (path: string, base: string, content: string, oldString: string): string => {
    if (!/not found/i.test(base)) return base;
    const advice = failureAdvice(path, editFailures.record(path), true);
    return `${base}\n\nNearest matching lines:\n${nearestLines(content, oldString)}${advice ? `\n\n${advice}` : ''}`;
  };
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
      inputSchema: z.object({ path: z.string(), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(2000).optional() }),
      execute: async ({ path, offset = 1, limit = MAX_READ_LINES }) => {
        const f = findFile(path);
        if (!f) return `Error: ${path} does not exist.`;
        const lines = f.content.split('\n');
        const start = Math.max(1, offset ?? 1);
        const slice = lines.slice(start - 1, start - 1 + limit);
        const body = slice.map((l, i) => `${start + i}\t${l}`).join('\n');
        const more = start - 1 + limit < lines.length ? `\n… ${lines.length - (start - 1 + limit)} more lines (use offset).` : '';
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
        if (!result.ok) return failedEdit(f.path, `Edit failed: ${result.error}`, f.content, old_string);
        editFailures.reset(f.path);
        edits.push({ path: f.path, action: 'edit', added: countLines(new_string) * result.count, removed: countLines(old_string) * result.count });
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
        edits.push({ path: clean, action: existing ? 'write' : 'write', added: countLines(content), removed: existing ? countLines(existing.content) : 0 });
        if (existing) existing.content = content;
        else files.push({ path: clean, content });
        filesModified.add(clean);
        filesDeleted.delete(clean);
        onEvent?.('file_changed', { path: clean, action: existing ? 'overwrite' : 'create' });
        return `${existing ? 'Overwrote' : 'Created'} ${clean} (${content.split('\n').length} lines).`;
      },
    }),
    replace_lines: tool({
      description: 'Replace lines start..end (1-based, inclusive) of an existing file with new_text. Use line numbers from read_file. Safer than edit_file when old_string keeps failing.',
      inputSchema: z.object({ path: z.string(), start: z.coerce.number().int().min(1), end: z.coerce.number().int().min(1), new_text: z.string() }),
      execute: async ({ path, start, end, new_text }) => {
        const blocked = guardPath(path);
        if (blocked) return blocked;
        const f = findFile(path);
        if (!f) return `Error: ${path} does not exist. Use write_file to create it.`;
        const r = replaceLineRange(f.content, start, end, new_text);
        if (!r.ok) return r.error;
        f.content = r.content;
        edits.push({ path: f.path, action: 'edit', added: r.added, removed: r.removed });
        filesModified.add(f.path);
        editFailures.reset(f.path);
        onEvent?.('file_changed', { path: f.path, action: 'edit' });
        return `Replaced lines ${start}-${end} of ${f.path} with ${r.added} line${r.added === 1 ? '' : 's'}.`;
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
        edits.push({ path: removed.path, action: 'delete', added: 0, removed: countLines(removed.content) });
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
        if (startsServer(command)) return SERVER_IN_RUN_COMMAND;
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
          commandsRun.push({ command, exitCode: result.exitCode, ...commitField(command, result.exitCode, result.output) });
          const out = result.output.length > 8000 ? `…(truncated)\n${result.output.slice(-8000)}` : result.output;
          return `$ ${command}\nexit code: ${result.exitCode}\n${out || '(no output)'}`;
        } catch (err) {
          return `Command could not run: ${errMessage(err) || err}`;
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
      execute: async ({ url }, { abortSignal }) => webFetchText(url, { signal: abortSignal }),
    }),
    web_search: tool({
      description: 'Search the web and return the top results (title, url, snippet). Use web_fetch on a result URL to read it. If search is unavailable it says so: never invent results.',
      inputSchema: z.object({ query: z.string().min(2).max(300) }),
      execute: async ({ query }, { abortSignal }) => webSearch(query, { signal: abortSignal }),
    }),
    ...extraTools,
  };

  if (sandbox && !local) {
    tools.start_preview = tool({
      description: 'Start the dev server in the background and get a public preview URL to show the user (e.g. command "npm run dev -- --port 3000 --hostname 0.0.0.0", port 3000). Install dependencies first.',
      inputSchema: z.object({ command: z.string(), port: z.union([z.literal(3000), z.literal(5173)]) }),
      execute: async ({ command, port }) => {
        if (++previewAttempts > 3) return PREVIEW_GIVE_UP;
        try {
          await sandbox.sync(files);
          const r = await sandbox.startPreview(command, port);
          onEvent?.('preview', { url: r.url });
          return `Preview running at ${r.url}\n${r.output.slice(-2000)}`;
        } catch (err) {
          return `Error: preview failed: ${errMessage(err) || err}`;
        }
      },
    });
  }

  let localIndex = '';
  if (local) {
    // Same tool names, backed by the user's real folder via the desktop bridge.
    const abs = (p: string) => (p.startsWith('/') ? p : `${local.root.replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`);
    const mark = (p: string, action: string, delta: { added: number; removed: number } = { added: 0, removed: 0 }) => {
      filesModified.add(p);
      edits.push({ path: p.replace(/^\.\//, ''), action: action === 'edit' ? 'edit' : 'write', ...delta });
      onEvent?.('file_changed', { path: p, action });
    };
    // Weak models often break syntax; check JS/JSON right after each edit so the model fixes it
    // in the next step instead of leaving a file that crashes on load.
    // Hash of each file as last read. If it differs just before this run edits it, the user or another
    // process changed it: show the fresh view and let the model re-apply its edit instead of overwriting.
    const sha = (t: string) => createHash('sha1').update(t).digest('hex');
    const known = new Map<string, string>();
    const checkExternal = async (path: string): Promise<string | null> => {
      const before = known.get(abs(path));
      if (!before) return null;
      const cur = await local.call('read_file', { path: abs(path) });
      if (/^Error/.test(cur) || sha(cur) === before) return null;
      known.set(abs(path), sha(cur));
      externalChanges.add(path.replace(/^\.\//, ''));
      onEvent?.('external_change', { path });
      return `EXTERNAL CHANGE: ${path} was modified by someone else (the user or another process) after you read it, so this edit was NOT applied. Current file, refreshed:\n${sliceNumbered(path, cur, 1, LOCAL_READ_LINES)}\n\nRe-apply your change against this version. Do not undo their changes.`;
    };
    const syntaxNote = async (p: string): Promise<string> => {
      const cmd = syntaxCheckCommand(abs(p));
      if (!cmd) return '';
      const out = await local.call('exec', { cwd: local.root, command: cmd, timeoutMs: 20_000 }, 30_000).catch(() => '');
      return /exit code: 0\b/.test(out) || !/exit code: \d+/.test(out) ? '' : `\n\nSYNTAX ERROR after this edit — fix it before continuing:\n${out.slice(0, 1500)}`;
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
        description: `Read a file (with line numbers) from the user's folder. Reads up to ${LOCAL_READ_LINES} lines; use offset/limit (or grep first) to read only the part you need.`,
        inputSchema: z.object({ path: z.string(), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(2000).optional() }),
        execute: async ({ path, offset = 1, limit = LOCAL_READ_LINES }) => {
          const start = Math.max(1, offset ?? 1);
          const raw = await local.call('read_file', { path: abs(path) });
          if (!/^Error/.test(raw)) known.set(abs(path), sha(raw));
          return sliceNumbered(path, raw, start, limit);
        },
      }),
      edit_file: tool({
        description: 'Replace an exact old_string with new_string in a file in the user\'s folder.',
        inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
        execute: async ({ path, old_string, new_string }) => {
          const ext = await checkExternal(path);
          if (ext) return ext;
          const out = await local.call('edit_file', { path: abs(path), old_string, new_string });
          if (/^Error/.test(out)) {
            if (!/not found/i.test(out)) return out;
            const current = await local.call('read_file', { path: abs(path) });
            return failedEdit(path, out, /^Error/.test(current) ? '' : stripLineNumbers(current), old_string);
          }
          editFailures.reset(path);
          known.delete(abs(path));
          mark(path, 'edit', { added: countLines(new_string), removed: countLines(old_string) });
          return out + (await syntaxNote(path));
        },
      }),
      write_file: tool({
        description: 'Create or overwrite a file in the user\'s folder.',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => {
          const ext = await checkExternal(path);
          if (ext) return ext;
          const out = await local.call('write_file', { path: abs(path), content });
          if (/^Error/.test(out)) return out;
          known.delete(abs(path));
          mark(path, 'write', { added: countLines(content), removed: 0 });
          return out + (await syntaxNote(path));
        },
      }),
      replace_lines: tool({
        description: 'Replace lines start..end (1-based, inclusive) of a file in the user\'s folder with new_text. Use line numbers from read_file. Safer than edit_file when old_string keeps failing.',
        inputSchema: z.object({ path: z.string(), start: z.coerce.number().int().min(1), end: z.coerce.number().int().min(1), new_text: z.string() }),
        execute: async ({ path, start, end, new_text }) => {
          const blocked = guardPath(path);
          if (blocked) return blocked;
          const ext = await checkExternal(path);
          if (ext) return ext;
          const current = await local.call('read_file', { path: abs(path) });
          if (/^Error/.test(current)) return current;
          const r = replaceLineRange(stripLineNumbers(current), start, end, new_text);
          if (!r.ok) return r.error;
          const out = await local.call('write_file', { path: abs(path), content: r.content });
          if (/^Error/.test(out)) return out;
          editFailures.reset(path);
          known.delete(abs(path));
          mark(path, 'edit', { added: r.added, removed: r.removed });
          return `Replaced lines ${start}-${end} of ${path} with ${r.added} line${r.added === 1 ? '' : 's'}.${await syntaxNote(path)}`;
        },
      }),
      delete_file: tool({
        description: 'Delete a file in the user\'s folder.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          const out = await local.call('exec', { cwd: local.root, command: `rm -- ${JSON.stringify(abs(path))}` });
          if (/exit code: 0\b/.test(out)) edits.push({ path: path.replace(/^\.\//, ''), action: 'delete', added: 0, removed: 0 });
          return out;
        },
      }),
      run_command: tool({
        description: `Run a shell command in ${local.root} on the user's computer (installs, tests, builds, git). Must finish on its own: never start servers here, use start_preview. Returns exit code and output.`,
        inputSchema: z.object({ command: z.string() }),
        execute: async ({ command }) => {
          if (startsServer(command)) return SERVER_IN_RUN_COMMAND;
          const out = await local.call('exec', { cwd: local.root, command, timeoutMs: 300_000 }, 330_000);
          const code = Number(out.match(/exit code: (\d+)/)?.[1] ?? 1);
          commandsRun.push({ command, exitCode: code, ...commitField(command, code, out) });
          return out;
        },
      }),
      start_preview: tool({
        description: 'Start the dev server on the user\'s computer in the background (e.g. "npm run dev"). Returns the localhost URL to share with the user.',
        inputSchema: z.object({ command: z.string(), port: z.number().int().min(1024).max(65535) }),
        execute: async ({ command, port }) => {
          if (++previewAttempts > 3) return PREVIEW_GIVE_UP;
          const out = await local.call('spawn', { cwd: local.root, command, waitMs: 9000 }, 40_000);
          onEvent?.('preview', { url: `http://localhost:${port}` });
          return `${out}\nPreview: http://localhost:${port} (on ${local.deviceName})`;
        },
      }),
    });
    localIndex = await local.call('list_files', { path: local.root, max: 400 }).catch(() => '');
  }

  // Subagents: a fresh, read-only nested loop that returns a short summary (max MAX_SUBAGENTS per run).
  let subagentsStarted = 0;
  const subagentTools = pickTools(tools, READ_ONLY_TOOLS);
  tools.task = tool({
    description: `Delegate a focused, read-only investigation (e.g. "find where auth is handled") to a subagent with a fresh context. It can search and read code and the web but cannot edit or run commands, and returns a short summary. Max ${MAX_SUBAGENTS} per run.`,
    inputSchema: z.object({
      description: z.string().min(3).max(100).describe('Short label, e.g. "Find where auth is handled"'),
      prompt: z.string().min(10).max(4000).describe('Everything the subagent needs: what to find and what to report back'),
    }),
    execute: async ({ description, prompt: subPrompt }, { abortSignal }) => {
      if (subagentsStarted >= MAX_SUBAGENTS) return `Error: subagent limit reached (${MAX_SUBAGENTS} per run). Continue with your own tools.`;
      subagentsStarted++;
      const sub = abortSignal ?? signal;
      const deadline = Math.min(Date.now() + SUBAGENT_TIME_MS, options.deadline ?? Infinity);
      onEvent?.('subagent_start', { description });
      try {
        const r = await streamAgent({
          model,
          instructions: SUBAGENT_INSTRUCTIONS,
          messages: [{ role: 'user', content: subPrompt }],
          tools: subagentTools,
          maxSteps: SUBAGENT_MAX_STEPS,
          signal: sub,
          deadline,
          onEvent: (event, data) => {
            if (event === 'react_step' || event === 'react_observation') onEvent?.(`subagent_${event === 'react_step' ? 'step' : 'observation'}`, { description, ...(data as object) });
          },
        });
        let summary = r.text || 'The subagent finished without a summary.';
        if (r.paused) summary = `(Subagent hit its time limit; partial findings)\n${summary}`;
        if (summary.length > SUBAGENT_SUMMARY_CHARS) summary = `${summary.slice(0, SUBAGENT_SUMMARY_CHARS - 1)}…`;
        return summary;
      } catch (err) {
        if (sub?.aborted) throw err;
        return `Error: subagent failed: ${errMessage(err) || err}`;
      } finally {
        onEvent?.('subagent_done', { description });
      }
    },
  });

  // Plan mode: write/edit/command tools are not even offered to the model.
  const guard = new StallGuard({ enabled: !planMode && promptAsksForChanges(prompt), ...options.stallGuard });
  const offered = guardTools(planMode ? pickTools(tools, PLAN_MODE_TOOLS) : tools, guard, () => edits.length);
  const extra = [extraInstructions, planMode ? PLAN_MODE_NOTE : ''].filter(Boolean).join('\n\n') || undefined;

  const { text, steps, paused } = await streamAgent({
    model,
    instructions: local
      ? buildLocalInstructions(local.root, local.deviceName, localIndex, extra)
      : buildInstructions(projectName, files, hasExecution, extra),
    messages: startMessages(prompt, history, options.resumeMessages),
    tools: offered,
    maxSteps,
    signal,
    onEvent,
    deadline: options.deadline,
    onCheckpoint: options.onCheckpoint,
    shouldStop: () => guard.stalled,
  });

  return {
    text,
    filesModified: Array.from(filesModified),
    filesDeleted: Array.from(filesDeleted),
    steps,
    commandsRun,
    edits,
    paused,
    stalled: guard.stalled,
    stepsSinceLastEdit: guard.sinceEdit,
    filesRead: guard.filesRead,
    externalChanges: [...externalChanges],
  };
}
