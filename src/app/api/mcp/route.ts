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

/**
 * Shazam as an MCP server: lets Claude Code / Claude Desktop, Codex, Antigravity, Cursor…
 * hand work to Shazam's free agents, then review and send feedback. Long work is async:
 * start_task returns immediately; get_task_status polls; send_feedback continues the task.
 */

export const maxDuration = 800;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const APP_URL = process.env.APP_URL || 'https://shazam-opal.vercel.app';

async function userFrom(ctx: any) {
  const userId = ctx?.http?.authInfo?.extra?.userId as string | undefined;
  if (!userId) throw new Error('Unauthenticated');
  const user = await new DbRepo().getUserById(userId);
  if (!user) throw new Error('User not found');
  return user;
}

function summarizeRun(run: any, sinceEvent = 0) {
  const events = run.events.slice(sinceEvent).slice(-25).map((e: any, i: number) => `${sinceEvent + i}. [${e.type}] ${e.text}`);
  return [
    `task_id: ${run.id}`,
    `agent: ${run.agent} · status: ${run.status}${run.model ? ` · model: ${run.model}` : ''}`,
    run.projectId ? `project_id: ${run.projectId}` : null,
    run.filesChanged?.length ? `files changed: ${run.filesChanged.join(', ')}` : null,
    events.length ? `progress (next since_event=${run.events.length}):\n${events.join('\n')}` : null,
    run.status === 'done' ? `\nRESULT:\n${(run.result || '').slice(0, 8000)}` : null,
    run.status === 'error' ? `\nERROR: ${run.error}` : null,
    run.status === 'queued' || run.status === 'running' ? '\nStill working. Call get_task_status again in ~20-40 seconds.' : null,
  ].filter(Boolean).join('\n');
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'suggest_agent',
      {
        title: 'Suggest the best Shazam agent',
        description: 'Before starting work, ask which Shazam agent fits a request (code, cowork, image, video, chat), which free model it will use, and what connection is missing.',
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
        title: 'Start a Shazam task',
        description:
          'Delegate work to Shazam\'s free-model agents. agent="code" writes/edits code in a project, runs tests in a real sandbox and can push to GitHub; agent="cowork" handles email, calendar, schedules, MCP tools, browser and media. Returns a task_id immediately; then poll get_task_status. Use this to save your own usage: let Shazam do the heavy lifting, then review.',
        inputSchema: z.object({
          prompt: z.string().describe('Complete, self-contained instructions (Shazam does not see your conversation).'),
          agent: z.enum(['auto', 'code', 'cowork']).default('auto'),
          project_id: z.string().optional().describe('Continue in an existing Shazam project (from a previous task).'),
          local_folder: z.string().optional().describe('Absolute path of a folder on the user\'s computer (must be allowed in the Shazam desktop app). The agent edits and runs code there.'),
        }),
      },
      async ({ prompt, agent, project_id, local_folder }, ctx) => {
        const user = await userFrom(ctx);
        let chosen = agent;
        if (chosen === 'auto') {
          const s = suggestAgent(prompt, await loadSuggestContext(user.id));
          chosen = s.agent === 'code' ? 'code' : 'cowork';
        }
        const run = await new RunsRepo().create(user.id, { agent: chosen as 'code' | 'cowork', prompt, projectId: local_folder ? `local:${local_folder}` : project_id, source: 'mcp' });
        after(() => executeRun(user, run));
        return text(`Started ${chosen} task.\ntask_id: ${run.id}\nPoll get_task_status(task_id) every ~30s. Watch it live: ${APP_URL}/runs/${run.id}`);
      }
    );

    server.registerTool(
      'get_task_status',
      {
        title: 'Get Shazam task status',
        description: 'Progress, tool steps and (when done) the result of a task. Pass since_event to only get new progress lines.',
        inputSchema: z.object({ task_id: z.string(), since_event: z.number().int().min(0).optional() }),
      },
      async ({ task_id, since_event }, ctx) => {
        const user = await userFrom(ctx);
        const run = await new RunsRepo().get(user.id, task_id);
        if (!run) return text(`No task ${task_id}.`);
        const q = await new QuestionsRepo().pendingForRun(user.id, task_id);
        const ask = q ? `\n\nQUESTION FOR YOU (question_id ${q.id}): ${q.question}\nOptions: ${q.options.join(' | ')}\nAnswer with answer_question (ask your human if you are unsure).` : '';
        return text(summarizeRun(run, since_event || 0) + ask);
      }
    );

    server.registerTool(
      'send_feedback',
      {
        title: 'Send review feedback to a Shazam task',
        description: 'After reviewing a finished task, send corrections. Shazam continues in the same project/context and returns a new task_id to poll.',
        inputSchema: z.object({ task_id: z.string(), feedback: z.string() }),
      },
      async ({ task_id, feedback }, ctx) => {
        const user = await userFrom(ctx);
        const runs = new RunsRepo();
        const parent = await runs.get(user.id, task_id);
        if (!parent) return text(`No task ${task_id}.`);
        if (parent.status === 'running' || parent.status === 'queued') return text('That task is still running. Wait for it to finish before sending feedback.');
        const prompt = `Reviewer feedback on your previous work — address every point, verify, then summarize what changed:\n${feedback}`;
        const run = await runs.create(user.id, { agent: parent.agent, prompt, projectId: parent.projectId, parentRunId: parent.id, source: 'mcp' });
        after(() => executeRun(user, run, { history: buildFeedbackHistory(parent) }));
        return text(`Feedback sent. New task_id: ${run.id} (continues ${parent.id}${parent.projectId ? ` in project ${parent.projectId}` : ''}).`);
      }
    );

    server.registerTool(
      'answer_question',
      {
        title: 'Answer a question from a Shazam task',
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
      { title: 'List recent Shazam tasks', description: 'Recent tasks with status.', inputSchema: z.object({}) },
      async (_args, ctx) => {
        const user = await userFrom(ctx);
        const runs = await new RunsRepo().list(user.id, 20);
        return text(runs.length ? runs.map((r) => `${r.id} | ${r.agent} | ${r.status} | ${r.prompt.slice(0, 80)}`).join('\n') : 'No tasks yet.');
      }
    );

    server.registerTool(
      'list_project_files',
      { title: 'List files in a Shazam project', description: 'Use to review what a code task produced.', inputSchema: z.object({ project_id: z.string() }) },
      async ({ project_id }, ctx) => {
        const user = await userFrom(ctx);
        const files = await new DbRepo().getProjectFiles(user.id, project_id);
        return text(files.length ? files.map((f) => `${f.path} (${f.content.split('\n').length} lines)`).join('\n') : 'Project is empty or not found.');
      }
    );

    server.registerTool(
      'read_project_file',
      { title: 'Read a file from a Shazam project', description: 'Read code a task wrote, to review it.', inputSchema: z.object({ project_id: z.string(), path: z.string() }) },
      async ({ project_id, path }, ctx) => {
        const user = await userFrom(ctx);
        const f = (await new DbRepo().getProjectFiles(user.id, project_id)).find((x) => x.path === path);
        return text(f ? f.content.slice(0, 40000) : `No file ${path} in ${project_id}.`);
      }
    );

    server.registerTool(
      'generate_image',
      {
        title: 'Generate an image with Shazam',
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
  { serverInfo: { name: 'shazam', version: '1.0.0' } }
);

async function verifyToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const found = await new RunsRepo().verifyToken(bearer);
  if (!found) return undefined;
  return { token: bearer, clientId: found.tokenId, scopes: ['tasks'], extra: { userId: found.userId } };
}

const authed = withMcpAuth(handler, verifyToken, { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp' });

export { authed as GET, authed as POST, authed as DELETE };
