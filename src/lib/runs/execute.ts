import type { ModelMessage } from 'ai';
import type { User } from '@/lib/types';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { decryptSecret } from '@/lib/crypto/vault';
import { getAgentModel } from '@/lib/agent/resolve';
import { runToolAgent } from '@/lib/agent/tool_agent';
import { ProjectSandbox, sandboxAvailable } from '@/lib/agent/sandbox';
import { buildGithubTools } from '@/lib/agent/github';
import { runCoworkAgent } from '@/lib/cowork/agent';
import { buildMcpToolset } from '@/lib/mcp/tools';
import { buildSkillTools } from '@/lib/skills';
import { buildMediaTools } from '@/lib/media/tools';
import { buildBridgeTools } from '@/lib/bridge/tools';
import { RunsRepo, type RunEvent } from './repo';

/**
 * One implementation of each agent, shared by the web UI (streamed over SSE) and by
 * background runs started from MCP clients (Claude Code, Codex, Antigravity…).
 */

export type EventSink = (event: string, data: any) => void;

export interface CodeTaskOptions {
  user: User;
  prompt: string;
  projectId?: string | null;
  history?: ModelMessage[];
  pinnedModel?: string | null;
  maxSteps?: number;
  allowExternalWrites?: boolean;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface TaskResult {
  text: string;
  model: string;
  projectId: string | null;
  filesModified: string[];
  filesDeleted: string[];
  commandsRun: Array<{ command: string; exitCode: number }>;
  steps: number;
}

export async function runCodeTask(o: CodeTaskOptions): Promise<TaskResult> {
  const repo = new DbRepo();
  const platform = new PlatformRepo();
  const send: EventSink = o.onEvent || (() => {});

  // Every coding task works inside a persistent project so files survive the run.
  let projectId = o.projectId || null;
  if (projectId && !(await repo.getProject(o.user.id, projectId))) projectId = null;
  if (!projectId) {
    projectId = `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await repo.createProject(o.user.id, { id: projectId, name: o.prompt.replace(/\s+/g, ' ').slice(0, 48) || 'Scratch project', description: null, rootDir: '/', settings: {} });
    send('project_created', { projectId });
  }
  const project = await repo.getProject(o.user.id, projectId);
  const files = (await repo.getProjectFiles(o.user.id, projectId)).map((f) => ({ path: f.path, content: f.content }));

  const agentModel = await getAgentModel(o.user, repo, o.prompt, 'coding', o.pinnedModel, (from, to, reason) => send('model_switch', { from, to, reason }));
  send('react_model', { model: agentModel.label, provider: agentModel.provider, providerModelId: agentModel.modelId, mode: 'native-tools' });

  const sandbox = sandboxAvailable() ? new ProjectSandbox(o.user.id, projectId) : null;
  send('react_execution', { backend: sandbox ? 'vercel-sandbox' : 'none' });

  const [mcp, skills, bridge, ghCred] = await Promise.all([
    buildMcpToolset(repo, o.user.id, { allowMutations: o.allowExternalWrites, platform, onPendingAction: (a) => send('pending_action', a) }),
    buildSkillTools(platform, o.user.id, 'code'),
    buildBridgeTools(o.user.id),
    repo.getCredential(o.user.id, 'github'),
  ]);
  const ghToken = ghCred && ghCred.status === 'valid' ? await decryptSecret(ghCred.encryptedKey).catch(() => null) : null;
  const github = ghToken && sandbox ? buildGithubTools(ghToken, sandbox, files) : {};
  const githubNote = ghToken && sandbox
    ? 'GitHub is connected: use github_push (feature branch) and github_create_pr to ship changes.'
    : 'GitHub is not connected in the cloud. To push, the user can add a GitHub token in Connections, or use the desktop app (local_run_command with git).';

  const out = await runToolAgent({
    model: agentModel.model,
    prompt: o.prompt,
    history: o.history,
    projectName: project?.name || 'Project',
    files,
    sandbox,
    extraTools: { ...mcp.tools, ...skills.tools, ...bridge.tools, ...github },
    extraInstructions: [mcp.inventory, skills.inventory, bridge.inventory, githubNote].filter(Boolean).join('\n\n'),
    maxSteps: o.maxSteps ?? 40,
    signal: o.signal,
    onEvent: send,
  });

  for (const p of out.filesModified) {
    const f = files.find((x) => x.path === p);
    if (f) await repo.putProjectFile(o.user.id, projectId, f.path, f.content);
  }
  for (const p of out.filesDeleted) await repo.deleteProjectFile(o.user.id, projectId, p);

  return { text: out.text || 'Done.', model: agentModel.label, projectId, filesModified: out.filesModified, filesDeleted: out.filesDeleted, commandsRun: out.commandsRun, steps: out.steps };
}

export interface CoworkTaskOptions {
  user: User;
  prompt: string;
  history?: ModelMessage[];
  timezone?: string;
  pinnedModel?: string | null;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export async function runCoworkTask(o: CoworkTaskOptions): Promise<TaskResult> {
  const repo = new DbRepo();
  const platform = new PlatformRepo();
  const send: EventSink = o.onEvent || (() => {});
  const { model, modelId, label, provider } = await getAgentModel(o.user, repo, o.prompt, 'planning', o.pinnedModel, (from, to, reason) => send('model_switch', { from, to, reason }));
  send('react_model', { model: label, provider, providerModelId: modelId });

  const [google, mcp, skills, media, bridge] = await Promise.all([
    platform.getOAuth(o.user.id, 'google'),
    buildMcpToolset(repo, o.user.id, { platform, onPendingAction: (a) => send('pending_action', a) }),
    buildSkillTools(platform, o.user.id, 'cowork'),
    buildMediaTools(o.user.id, repo, platform, { enhancer: model, onAsset: (a) => send('media_asset', a) }),
    buildBridgeTools(o.user.id),
  ]);

  const result = await runCoworkAgent({
    model,
    userId: o.user.id,
    prompt: o.prompt,
    history: o.history,
    timezone: o.timezone || 'UTC',
    platform,
    googleConnected: Boolean(google),
    googleEmail: google?.accountEmail,
    extraTools: { ...mcp.tools, ...skills.tools, ...media.tools, ...bridge.tools },
    extraInstructions: [mcp.inventory, skills.inventory, media.inventory, bridge.inventory].filter(Boolean).join('\n\n'),
    signal: o.signal,
    onEvent: send,
  });
  return { text: result.text, model: label, projectId: null, filesModified: [], filesDeleted: [], commandsRun: [], steps: result.steps };
}

/** Converts streaming agent events into a compact, persisted progress log. */
export function eventRecorder(runId: string, userId: string, runs = new RunsRepo()) {
  const events: RunEvent[] = [];
  let model: string | null = null;
  let dirty = false;
  let lastFlush = 0;
  const flush = async (force = false) => {
    if (!dirty || (!force && Date.now() - lastFlush < 1500)) return;
    dirty = false;
    lastFlush = Date.now();
    await runs.update(userId, runId, { events, model: model ?? undefined }).catch(() => {});
  };
  const push = (type: RunEvent['type'], text: string) => {
    events.push({ at: new Date().toISOString(), type, text: text.slice(0, 600) });
    dirty = true;
    void flush();
  };
  const sink: EventSink = (event, d) => {
    if (event === 'react_model') model = d.model;
    else if (event === 'react_step') push('step', `${d.tool} ${JSON.stringify(d.args || {}).slice(0, 200)}`);
    else if (event === 'react_observation') push(d.isError ? 'error' : 'result', d.observation || '');
    else if (event === 'pending_action') push('approval', `Waiting for approval in Shazam: ${d.summary} (action ${d.id})`);
    else if (event === 'media_asset') push('media', `${d.kind}: ${d.url}`);
    else if (event === 'model_switch') push('note', `Switched model ${d.from} → ${d.to} (${d.reason})`);
  };
  return { sink, events, flush: () => flush(true), getModel: () => model };
}
