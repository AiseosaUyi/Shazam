import { after } from 'next/server';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { RunsRepo } from '@/lib/runs/repo';
import { executeRun, buildFeedbackHistory } from '@/lib/runs/background';
import { suggestAgent } from '@/lib/agents/suggest';
import { loadSuggestContext } from '@/lib/agents/context';
import { generateAndStoreImage } from '@/lib/media/image';
import { executeApprovedAction } from '@/lib/cowork/actions';
import { decryptSecret } from '@/lib/crypto/vault';
import { QuestionsRepo } from '@/lib/agents/ask';
import { ACTIVE, MAX_WAIT_S, summarizeRun } from '@/lib/runs/mcp-summary';

/**
 * Arcwork as an MCP server: lets Claude Code / Claude Desktop, Codex, Antigravity, Cursor…
 * hand work to Arcwork's free agents, then review and send feedback. Long work is async:
 * start_task returns immediately; get_task_status polls; send_feedback continues the task.
 */

export const maxDuration = 800;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const APP_URL = process.env.APP_URL || 'https://arcwork-ai.vercel.app';

async function userFrom(ctx: any) {
  const userId = ctx?.http?.authInfo?.extra?.userId as string | undefined;
  if (!userId) throw new Error('Unauthenticated');
  const user = await new DbRepo().getUserById(userId);
  if (!user) throw new Error('User not found');
  return user;
}

/** Waits until the task finishes, asks a question or needs an approval, or the time is up. */
async function waitForNews(userId: string, taskId: string, waitS: number) {
  const runs = new RunsRepo();
  const questions = new QuestionsRepo();
  const deadline = Date.now() + Math.min(Math.max(waitS, 0), MAX_WAIT_S) * 1000;
  let run = await runs.get(userId, taskId);
  const startEvents = run?.events.length || 0;
  for (;;) {
    if (!run || !ACTIVE.has(run.status)) return { run, q: run ? await questions.pendingForRun(userId, taskId) : null };
    const q = await questions.pendingForRun(userId, taskId);
    if (q) return { run, q };
    if (run.events.slice(startEvents).some((e: any) => e.type === 'approval')) return { run, q: null };
    if (Date.now() >= deadline) return { run, q: null };
    await new Promise((r) => setTimeout(r, 2500));
    run = await runs.get(userId, taskId);
  }
}

const INSTRUCTIONS = `Arcwork runs coding, email, calendar, image and video work on free models, so the user saves their own AI plan's usage.
To save the user's usage:
- Delegate real work with start_task instead of doing it yourself. Write one complete, self-contained prompt.
- Then call get_task_status repeatedly; each call waits up to ${MAX_WAIT_S}s on Arcwork's side, so call it again immediately when it says still working.
- Review the short summary it returns. Only call read_project_file for specific files if something looks wrong, and only use detail="full" if you truly need it.
- Send corrections with send_feedback rather than fixing the work yourself.
- Never approve an action (decide_approval) unless the human approved that exact action.`;

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'suggest_agent',
      {
        title: 'Suggest the best Arcwork agent',
        description: 'Before starting work, ask which Arcwork agent fits a request (code, cowork, image, video, chat), which free model it will use, and what connection is missing.',
        inputSchema: z.object({ prompt: z.string() }),
      },
      async ({ prompt }, ctx) => {
        const user = await userFrom(ctx);
        const s = suggestAgent(prompt, await loadSuggestContext(user.id));
        return text(JSON.stringify(s, null, 2));
      }
    );

    server.registerTool(
      'start_task',
      {
        title: 'Start an Arcwork task',
        description:
          'Delegate work to Arcwork\'s free-model agents. agent="code" writes/edits code in a project, runs tests in a real sandbox and can push to GitHub; agent="cowork" handles email, calendar, schedules, MCP tools, browser and media. Returns a task_id immediately; then call get_task_status until done. Use this instead of doing the work yourself: it runs on free models, so it saves the user\'s usage. Review the summary, then send_feedback if needed.',
        inputSchema: z.object({
          prompt: z.string().describe('Complete, self-contained instructions (Arcwork does not see your conversation).'),
          agent: z.enum(['auto', 'code', 'cowork']).default('auto'),
          project_id: z.string().optional().describe('Continue in an existing Arcwork project (from a previous task).'),
          local_folder: z.string().optional().describe('Absolute path of a folder on the user\'s computer. The agent edits and runs code there; if the folder is new, the user is asked on their computer to allow it.'),
        }),
      },
      async ({ prompt, agent, project_id, local_folder }, ctx) => {
        const user = await userFrom(ctx);
        let chosen = agent;
        if (chosen === 'auto') {
          const s = suggestAgent(prompt, await loadSuggestContext(user.id));
          chosen = s.agent === 'code' ? 'code' : 'cowork';
        }
        if (local_folder) {
          const { BridgeRepo } = await import('@/lib/bridge/repo');
          const { offlineMessage } = await import('@/lib/bridge/folders');
          if (!(await new BridgeRepo().onlineDevice(user.id, 'desktop'))) return text(offlineMessage(local_folder));
        }
        const run = await new RunsRepo().create(user.id, { agent: chosen as 'code' | 'cowork', prompt, projectId: local_folder ? `local:${local_folder}` : project_id, source: 'mcp' });
        after(() => executeRun(user, run));
        return text(`Started ${chosen} task.\ntask_id: ${run.id}\nCall get_task_status(task_id) now; it waits for progress on our side, so keep calling it until the task is done. Watch it live: ${APP_URL}/runs/${run.id}`);
      }
    );

    server.registerTool(
      'get_task_status',
      {
        title: 'Get Arcwork task status',
        description: `Waits up to ${MAX_WAIT_S}s for the task to finish, ask a question or need an approval, then returns a short summary. Call again right away while it is still working. Pass since_event to skip progress you have seen. detail="full" returns the whole result (uses more of your usage).`,
        inputSchema: z.object({
          task_id: z.string(),
          since_event: z.number().int().min(0).optional(),
          wait_seconds: z.number().int().min(0).max(MAX_WAIT_S).optional().describe(`How long to wait for news (default ${MAX_WAIT_S}, 0 = answer now).`),
          detail: z.enum(['summary', 'full']).optional().describe('summary (default) or full.'),
        }),
      },
      async ({ task_id, since_event, wait_seconds, detail }, ctx) => {
        const user = await userFrom(ctx);
        const { run, q } = await waitForNews(user.id, task_id, wait_seconds ?? MAX_WAIT_S);
        if (!run) return text(`No task ${task_id}.`);
        const ask = q ? `\n\nQUESTION FOR YOU (question_id ${q.id}): ${q.question}\nOptions: ${q.options.join(' | ')}\nAnswer with answer_question (ask your human if you are unsure).` : '';
        return text(summarizeRun(run, since_event || 0, detail || 'summary') + ask);
      }
    );

    server.registerTool(
      'send_feedback',
      {
        title: 'Send review feedback to an Arcwork task',
        description: 'After reviewing a finished task, send corrections. Arcwork continues in the same project/context and returns a new task_id to poll.',
        inputSchema: z.object({ task_id: z.string(), feedback: z.string() }),
      },
      async ({ task_id, feedback }, ctx) => {
        const user = await userFrom(ctx);
        const runs = new RunsRepo();
        const parent = await runs.get(user.id, task_id);
        if (!parent) return text(`No task ${task_id}.`);
        if (ACTIVE.has(parent.status)) return text('That task is still running. Wait for it to finish before sending feedback.');
        const prompt = `Reviewer feedback on your previous work — address every point, verify, then summarize what changed:\n${feedback}`;
        const run = await runs.create(user.id, { agent: parent.agent, prompt, projectId: parent.projectId, parentRunId: parent.id, source: 'mcp' });
        after(() => executeRun(user, run, { history: buildFeedbackHistory(parent) }));
        return text(`Feedback sent. New task_id: ${run.id} (continues ${parent.id}${parent.projectId ? ` in project ${parent.projectId}` : ''}).`);
      }
    );

    server.registerTool(
      'answer_question',
      {
        title: 'Answer a question from an Arcwork task',
        description: 'When get_task_status shows a QUESTION, answer it here so the task can continue. Pick one of the options or write a short answer.',
        inputSchema: z.object({ question_id: z.string(), answer: z.string() }),
      },
      async ({ question_id, answer }, ctx) => {
        const user = await userFrom(ctx);
        const ok = await new QuestionsRepo().answer(user.id, question_id, answer);
        return text(ok ? 'Answer sent; the task is continuing.' : 'That question was already answered or does not exist.');
      }
    );

    server.registerTool(
      'list_tasks',
      { title: 'List recent Arcwork tasks', description: 'Recent tasks with status.', inputSchema: z.object({}) },
      async (_args, ctx) => {
        const user = await userFrom(ctx);
        const runs = await new RunsRepo().list(user.id, 20);
        return text(runs.length ? runs.map((r) => `${r.id} | ${r.agent} | ${r.status} | ${r.prompt.slice(0, 80)}`).join('\n') : 'No tasks yet.');
      }
    );

    server.registerTool(
      'list_project_files',
      { title: 'List files in an Arcwork project', description: 'Use to review what a code task produced.', inputSchema: z.object({ project_id: z.string() }) },
      async ({ project_id }, ctx) => {
        const user = await userFrom(ctx);
        const files = await new DbRepo().getProjectFiles(user.id, project_id);
        return text(files.length ? files.map((f) => `${f.path} (${f.content.split('\n').length} lines)`).join('\n') : 'Project is empty or not found.');
      }
    );

    server.registerTool(
      'read_project_file',
      { title: 'Read a file from an Arcwork project', description: 'Read code a task wrote, to review it.', inputSchema: z.object({ project_id: z.string(), path: z.string() }) },
      async ({ project_id, path }, ctx) => {
        const user = await userFrom(ctx);
        const f = (await new DbRepo().getProjectFiles(user.id, project_id)).find((x) => x.path === path);
        return text(f ? f.content.slice(0, 40000) : `No file ${path} in ${project_id}.`);
      }
    );

    server.registerTool(
      'generate_image',
      {
        title: 'Generate an image with Arcwork',
        description: 'Creates an image on free models (prompt is auto-expanded). Returns a public URL. Takes ~5-15s.',
        inputSchema: z.object({ prompt: z.string(), aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional() }),
      },
      async ({ prompt, aspect_ratio }, ctx) => {
        const user = await userFrom(ctx);
        const repo = new DbRepo();
        const key = async (p: string) => {
          const c = await repo.getCredential(user.id, p);
          return c && c.status === 'valid' ? decryptSecret(c.encryptedKey).catch(() => null) : null;
        };
        const r = await generateAndStoreImage({ userId: user.id, prompt, aspectRatio: aspect_ratio, googleApiKey: await key('google'), openaiApiKey: await key('openai') }, new PlatformRepo());
        return text(`Image (${r.provider} · ${r.model}): ${r.asset.url}`);
      }
    );

    server.registerTool(
      'list_pending_approvals',
      { title: 'List actions waiting for approval', description: 'Emails, schedules, calendar events or external changes a task prepared but has NOT executed.', inputSchema: z.object({}) },
      async (_args, ctx) => {
        const user = await userFrom(ctx);
        const actions = await new PlatformRepo().listPendingActions(user.id);
        return text(actions.length ? actions.map((a) => `${a.id} | ${a.kind} | ${a.summary}`).join('\n') : 'Nothing is waiting for approval.');
      }
    );

    server.registerTool(
      'decide_approval',
      {
        title: 'Approve or reject a pending action',
        description: 'Executes or rejects a prepared action (e.g. sending an email). ONLY call this after the human explicitly approved this exact action in the conversation.',
        inputSchema: z.object({ action_id: z.string(), decision: z.enum(['approve', 'reject']) }),
      },
      async ({ action_id, decision }, ctx) => {
        const user = await userFrom(ctx);
        const platform = new PlatformRepo();
        const action = await platform.getPendingAction(user.id, action_id);
        if (!action) return text(`No pending action ${action_id}.`);
        if (decision === 'reject') {
          await platform.decidePendingAction(user.id, action_id, 'rejected');
          return text('Rejected.');
        }
        if (!(await platform.decidePendingAction(user.id, action_id, 'approved'))) return text('That action was already decided.');
        const out = await executeApprovedAction(action, platform);
        await platform.completePendingAction(user.id, action_id, out.ok, out.result);
        return text(`${out.ok ? 'Done' : 'Failed'}: ${out.result}`);
      }
    );
  },
  { serverInfo: { name: 'arcwork', version: '1.1.0' }, instructions: INSTRUCTIONS }
);

async function verifyToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const found = await new RunsRepo().verifyToken(bearer);
  if (!found) return undefined;
  return { token: bearer, clientId: found.tokenId, scopes: ['tasks'], extra: { userId: found.userId } };
}

const authed = withMcpAuth(handler, verifyToken, { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp' });

export { authed as GET, authed as POST, authed as DELETE };
