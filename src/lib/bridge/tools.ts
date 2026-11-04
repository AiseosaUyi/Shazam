import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { put } from '@vercel/blob';
import { BridgeRepo, callDevice, BridgeOfflineError } from './repo';

/**
 * Agent tools backed by the user's own devices:
 *  - Desktop app: shell, files and git inside folders the user explicitly allowed.
 *  - Browser extension: drive the user's real Chrome (their sessions), with approval
 *    prompts for clicks/typing shown by the extension itself.
 * Tools are only offered while the device is online, so the model never names a tool
 * that cannot run.
 */

function fmt(out: { ok: boolean; result: any }): string {
  const r = out.result;
  const text = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  return out.ok ? text : `Error: ${text}`;
}

async function run(userId: string, kind: 'desktop' | 'browser', command: string, payload: unknown, timeoutMs = 120_000, signal?: AbortSignal): Promise<string> {
  try {
    return fmt(await callDevice(userId, kind, command, payload, { timeoutMs, signal }));
  } catch (err: any) {
    return err instanceof BridgeOfflineError ? err.message : `Error: ${err.message || err}`;
  }
}

export async function buildBridgeTools(userId: string): Promise<{ tools: ToolSet; inventory: string }> {
  const repo = new BridgeRepo();
  const [desktop, browser] = await Promise.all([repo.onlineDevice(userId, 'desktop'), repo.onlineDevice(userId, 'browser')]);
  const tools: ToolSet = {};
  const lines: string[] = [];

  if (desktop) {
    const workspaces = (desktop.capabilities.workspaces as string[] | undefined) || [];
    lines.push(`Desktop app "${desktop.name}" is connected. Allowed folders: ${workspaces.length ? workspaces.join(', ') : '(none yet — ask the user to add one in the desktop app)'}.
Use local_* tools to work in those folders with the user's own git credentials (e.g. git push, gh pr create). Risky commands are confirmed by the user on their computer.`);

    tools.local_run_command = tool({
      description: 'Run a shell command on the user\'s computer inside an allowed folder (git, npm, tests, gh). Returns exit code and output.',
      inputSchema: z.object({ cwd: z.string().describe('Absolute path inside an allowed folder'), command: z.string(), timeout_seconds: z.number().int().min(5).max(600).optional() }),
      execute: async ({ cwd, command, timeout_seconds }, { abortSignal }) =>
        run(userId, 'desktop', 'exec', { cwd, command, timeoutMs: (timeout_seconds || 120) * 1000 }, ((timeout_seconds || 120) + 30) * 1000, abortSignal),
    });
    tools.local_read_file = tool({
      description: 'Read a text file on the user\'s computer (inside an allowed folder).',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => run(userId, 'desktop', 'read_file', { path }),
    });
    tools.local_write_file = tool({
      description: 'Create or overwrite a text file on the user\'s computer (inside an allowed folder).',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => run(userId, 'desktop', 'write_file', { path, content }),
    });
    tools.local_edit_file = tool({
      description: 'Replace an exact old_string with new_string in a file on the user\'s computer.',
      inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
      execute: async (input) => run(userId, 'desktop', 'edit_file', input),
    });
    tools.local_list_files = tool({
      description: 'List files under a folder on the user\'s computer (respects .gitignore, skips node_modules).',
      inputSchema: z.object({ path: z.string(), max: z.number().int().min(1).max(2000).optional() }),
      execute: async ({ path, max }) => run(userId, 'desktop', 'list_files', { path, max: max || 500 }),
    });
  }

  if (browser) {
    lines.push(`Browser extension "${browser.name}" is connected: you can browse in the user's real Chrome (their logged-in sessions). Read pages with browser_read before clicking. Clicks and typing may require the user to approve on their screen. Never enter passwords or payment details.`);

    tools.browser_open = tool({
      description: 'Open a URL in the agent\'s Chrome tab (reuses one tab per session). Returns the page title and URL.',
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => run(userId, 'browser', 'open', { url }, 60_000),
    });
    tools.browser_read = tool({
      description: 'Read the current page: visible text plus numbered interactive elements ([12] button "Sign in"). Use the numbers with browser_click/browser_type.',
      inputSchema: z.object({ max_chars: z.number().int().min(1000).max(40000).optional() }),
      execute: async ({ max_chars }) => run(userId, 'browser', 'read', { maxChars: max_chars || 15000 }, 60_000),
    });
    tools.browser_click = tool({
      description: 'Click an element by its number from browser_read.',
      inputSchema: z.object({ element: z.number().int().min(0), reason: z.string().describe('Shown to the user if approval is required') }),
      execute: async (input) => run(userId, 'browser', 'click', input, 180_000),
    });
    tools.browser_type = tool({
      description: 'Type text into an input by its number from browser_read. Optionally press Enter.',
      inputSchema: z.object({ element: z.number().int().min(0), text: z.string(), submit: z.boolean().optional(), reason: z.string() }),
      execute: async (input) => run(userId, 'browser', 'type', input, 180_000),
    });
    tools.browser_scroll = tool({
      description: 'Scroll the page up or down.',
      inputSchema: z.object({ direction: z.enum(['up', 'down']) }),
      execute: async (input) => run(userId, 'browser', 'scroll', input, 30_000),
    });
    tools.browser_screenshot = tool({
      description: 'Take a screenshot of the agent tab. Returns an image URL (show it to the user); use browser_read for the page content.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const out = await callDevice(userId, 'browser', 'screenshot', {}, { timeoutMs: 60_000 });
          const dataUrl: string | undefined = out.result?.dataUrl;
          if (!out.ok || !dataUrl?.startsWith('data:image/')) return fmt(out);
          const blob = await put(`screens/${userId}/${Date.now()}.jpg`, Buffer.from(dataUrl.split(',')[1], 'base64'), { access: 'public', addRandomSuffix: true, contentType: 'image/jpeg' });
          return `Screenshot: ![screenshot](${blob.url})`;
        } catch (err: any) {
          return err instanceof BridgeOfflineError ? err.message : `Error: ${err.message || err}`;
        }
      },
    });
    tools.browser_back = tool({
      description: 'Go back in the agent tab history.',
      inputSchema: z.object({}),
      execute: async () => run(userId, 'browser', 'back', {}, 30_000),
    });
    tools.browser_tabs = tool({
      description: 'List all tabs in the current Chrome window with their IDs. Use browser_switch_tab to switch.',
      inputSchema: z.object({}),
      execute: async () => run(userId, 'browser', 'tabs', {}, 30_000),
    });
    tools.browser_switch_tab = tool({
      description: 'Switch to a different tab by ID (from browser_tabs). Changes the active agent tab.',
      inputSchema: z.object({ tab_id: z.number().int() }),
      execute: async ({ tab_id }) => run(userId, 'browser', 'switch_tab', { tab_id }, 30_000),
    });
    tools.browser_close_tab = tool({
      description: 'Close a tab by ID. Cannot close the only tab; asks user approval if enabled.',
      inputSchema: z.object({ tab_id: z.number().int() }),
      execute: async ({ tab_id }) => run(userId, 'browser', 'close_tab', { tab_id }, 180_000),
    });
    tools.browser_key = tool({
      description: 'Press a key (Enter, Tab, Escape, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Backspace, Space). Optionally target a numbered element.',
      inputSchema: z.object({ key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Space']), element: z.number().int().min(0).optional(), reason: z.string() }),
      execute: async (input) => run(userId, 'browser', 'key', input, 180_000),
    });
    tools.browser_select = tool({
      description: 'Select an option in a <select> dropdown by value or matching text. Element must be a select from browser_read.',
      inputSchema: z.object({ element: z.number().int(), value: z.string(), reason: z.string() }),
      execute: async (input) => run(userId, 'browser', 'select', input, 180_000),
    });
    tools.browser_hover = tool({
      description: 'Hover the mouse over an element by its number from browser_read (opens menus/tooltips). Then browser_read again.',
      inputSchema: z.object({ element: z.number().int().min(0) }),
      execute: async (input) => run(userId, 'browser', 'hover', input, 30_000),
    });
    tools.browser_eval = tool({
      description: 'Run JavaScript in the agent tab (page context) and return the JSON result. Code is limited to 400 characters. ALWAYS asks the user to approve. Prefer browser_read/click; use this only for reading data the other tools cannot reach. Never read or send cookies, tokens or passwords.',
      inputSchema: z.object({ code: z.string().max(400), reason: z.string() }),
      execute: async (input) => run(userId, 'browser', 'eval', input, 180_000),
    });
    tools.browser_upload = tool({
      description: 'Attach a file (downloaded from an https URL, max 8 MB) to a file input by its number from browser_read. ALWAYS asks the user to approve. Use it for CVs/resumes the user provided. Never upload anything the user did not ask you to.',
      inputSchema: z.object({ element: z.number().int().min(0), url: z.string().url(), filename: z.string().optional(), reason: z.string() }),
      execute: async (input) => run(userId, 'browser', 'upload', input, 180_000),
    });
    tools.browser_drag = tool({
      description: 'Drag one element (by number from browser_read) onto another. Asks the user to approve.',
      inputSchema: z.object({ from_element: z.number().int().min(0), to_element: z.number().int().min(0), reason: z.string() }),
      execute: async (input) => run(userId, 'browser', 'drag', input, 180_000),
    });
    tools.browser_wait_for = tool({
      description: 'Wait for text to appear or disappear in the page body. Polls every 400ms up to timeout_seconds (default 10, max 30).',
      inputSchema: z.object({ text: z.string().optional(), gone: z.boolean().optional(), timeout_seconds: z.number().int().min(1).max(30).optional() }),
      execute: async (input) => run(userId, 'browser', 'wait_for', input, 45_000),
    });
    tools.browser_find = tool({
      description: 'Search interactive elements on the current page (from browser_read output). Returns up to 20 matching lines case-insensitive.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => run(userId, 'browser', 'find', { query }, 60_000),
    });
  }

  if (!desktop && !browser) {
    lines.push('No desktop app or browser extension is connected. For work on the user\'s computer (local folders, git push with their credentials) or their logged-in browser, tell them to connect one in Connections.');
  }
  return { tools, inventory: lines.join('\n') };
}
