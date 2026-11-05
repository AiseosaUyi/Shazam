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
import { buildAskTool, QUESTION_GUIDANCE } from '@/lib/agents/ask';
import type { ResumableRun } from '@/lib/agent/stream';
import { normalizeApprovalMode } from '@/lib/cowork/approval';
import { errMessage } from '@/lib/errors';

/**
 * One implementation of each agent, shared by the web UI (streamed over SSE) and by
 * background runs started from MCP clients (Claude Code, Codex, Antigravity…).
 */

export type EventSink = (event: string, data: any) => void;

/** Short human project name from a request: "Build a landing page for Gruve, …" → "Landing page for Gruve". */
export function projectTitle(prompt: string): string {
  let t = prompt.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(please\s+)?(can you\s+)?(build|create|make|write|add|implement|set up|setup|scaffold|generate|design)\s+(me\s+)?(a|an|the|some)?\s*/i, '');
  t = t.split(/[,:;!?(\n]|\.(?:\s|$)/)[0];
  const words = t.split(' ').filter((w) => !/[\/\\]|\.(ts|js|py|tsx)$/.test(w)).slice(0, 5);
  const title = words.join(' ').trim();
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Untitled project';
}

export interface CodeTaskOptions extends ResumableRun {
  user: User;
  prompt: string;
  projectId?: string | null;
  history?: ModelMessage[];
  pinnedModel?: string | null;
  maxSteps?: number;
  allowExternalWrites?: boolean;
  /** Absolute path of an allowed folder on the user's paired computer: work there instead of a cloud project. */
  localRoot?: string | null;
  /** Background run id (lets ask_user questions be answered from the web or MCP). */
  runId?: string | null;
  /** Per-step budget for a local model (shorter on 300s streaming routes). */
  localStepTimeoutMs?: number;
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
  /** Stopped at a time limit with a checkpoint saved; the background runner resumes it. */
  paused?: boolean;
}

export async function runCodeTask(o: CodeTaskOptions): Promise<TaskResult> {
  const repo = new DbRepo();
  const platform = new PlatformRepo();
  const send: EventSink = o.onEvent || (() => {});
  if (o.localRoot) return runLocalCodeTask(o, repo, platform, send);

  // Every coding task works inside a persistent project so files survive the run.
  let projectId = o.projectId || null;
  if (projectId && !(await repo.getProject(o.user.id, projectId))) projectId = null;
  if (!projectId) {
    projectId = `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await repo.createProject(o.user.id, { id: projectId, name: projectTitle(o.prompt), description: null, rootDir: '/', settings: {} });
    send('project_created', { projectId });
  }
  const project = await repo.getProject(o.user.id, projectId);
  const files = (await repo.getProjectFiles(o.user.id, projectId)).map((f) => ({ path: f.path, content: f.content }));

  const agentModel = await getAgentModel(o.user, repo, o.prompt, 'coding', o.pinnedModel, (from, to, reason) => send('model_switch', { from, to, reason }), { localStepTimeoutMs: o.localStepTimeoutMs });
  send('react_model', { model: agentModel.label, provider: agentModel.provider, providerModelId: agentModel.modelId, mode: 'native-tools' });

  const sandbox = sandboxAvailable() ? new ProjectSandbox(o.user.id, projectId) : null;
  send('react_execution', { backend: sandbox ? 'vercel-sandbox' : 'none' });

  const [mcp, skills, bridge, ghCred] = await Promise.all([
    buildMcpToolset(repo, o.user.id, { allowMutations: o.allowExternalWrites, platform, onPendingAction: (a) => send('pending_action', a) }),
    buildSkillTools(platform, o.user.id, 'code'),
    buildBridgeTools(o.user.id, o.prompt),
    repo.getCredential(o.user.id, 'github'),
  ]);
  const ghToken = ghCred && ghCred.status === 'valid' ? await decryptSecret(ghCred.encryptedKey).catch(() => null) : null;
  const github = ghToken && sandbox ? buildGithubTools(ghToken, sandbox, files) : {};
  const githubNote = ghToken && sandbox
    ? 'GitHub is connected: use github_push (feature branch) and github_create_pr to ship changes.'
    : 'GitHub is not connected in the cloud. To push, the user can add a GitHub token in Connections, or use the desktop app (local_run_command with git).';

  // Save each file as soon as the agent writes it, so an interrupted run never loses work.
  const pid = projectId;
  const persistingSend: EventSink = (event, data) => {
    if (event === 'file_changed' && data?.path) {
      const f = files.find((x) => x.path === data.path);
      if (data.action === 'delete') void repo.deleteProjectFile(o.user.id, pid, data.path).catch(() => {});
      else if (f) void repo.putProjectFile(o.user.id, pid, f.path, f.content).catch(() => {});
    }
    send(event, data);
  };

  const out = await runToolAgent({
    model: agentModel.model,
    prompt: o.prompt,
    history: o.history,
    projectName: project?.name || 'Project',
    files,
    sandbox,
    extraTools: { ...mcp.tools, ...skills.tools, ...bridge.tools, ...github, ...buildAskTool({ userId: o.user.id, runId: o.runId ?? null, onEvent: send, signal: o.signal }) },
    extraInstructions: [QUESTION_GUIDANCE, mcp.inventory, skills.inventory, bridge.inventory, githubNote].filter(Boolean).join('\n\n'),
    maxSteps: o.maxSteps ?? 40,
    signal: o.signal,
    onEvent: persistingSend,
    resumeMessages: o.resumeMessages,
    deadline: o.deadline,
    onCheckpoint: o.onCheckpoint,
  });

  for (const p of out.filesModified) {
    const f = files.find((x) => x.path === p);
    if (f) await repo.putProjectFile(o.user.id, projectId, f.path, f.content);
  }
  for (const p of out.filesDeleted) await repo.deleteProjectFile(o.user.id, projectId, p);

  return { text: out.text || 'Done.', model: agentModel.label, projectId, filesModified: out.filesModified, filesDeleted: out.filesDeleted, commandsRun: out.commandsRun, steps: out.steps, paused: out.paused };
}

async function runLocalCodeTask(o: CodeTaskOptions, repo: DbRepo, platform: PlatformRepo, send: EventSink): Promise<TaskResult> {
  const { callDevice } = await import('@/lib/bridge/repo');
  const { ensureLocalFolder } = await import('@/lib/bridge/folders');
  const root = o.localRoot!.replace(/\/$/, '');
  // Offline → one actionable line; folder not allowed yet → the computer asks the person.
  const device = await ensureLocalFolder(o.user.id, root, { signal: o.signal });
  send('react_execution', { backend: 'local', device: device.name, root });

  const agentModel = await getAgentModel(o.user, repo, o.prompt, 'coding', o.pinnedModel, (from, to, reason) => send('model_switch', { from, to, reason }), { localStepTimeoutMs: o.localStepTimeoutMs });
  send('react_model', { model: agentModel.label, provider: agentModel.provider, providerModelId: agentModel.modelId, mode: 'native-tools' });

  const call = async (command: string, payload: Record<string, unknown>, timeoutMs = 120_000) => {
    try {
      const out = await callDevice(o.user.id, 'desktop', command, payload, { timeoutMs, signal: o.signal });
      const text = typeof out.result === 'string' ? out.result : JSON.stringify(out.result);
      return out.ok ? text : `Error: ${text}`;
    } catch (err) {
      if (o.signal?.aborted) throw err;
      // A brief disconnect must not end the run: tell the model, which can retry the step.
      return `Error: ${errMessage(err) || err} Wait a moment and retry this step.`;
    }
  };
  const { loadProjectMemory } = await import('./project-memory');
  const memory = await loadProjectMemory((p) => call('read_file', { path: p }), root).catch(() => '');
  const [mcp, skills] = await Promise.all([
    buildMcpToolset(repo, o.user.id, { allowMutations: o.allowExternalWrites, platform, onPendingAction: (a) => send('pending_action', a) }),
    buildSkillTools(platform, o.user.id, 'code'),
  ]);
  const out = await runToolAgent({
    model: agentModel.model,
    prompt: o.prompt,
    history: o.history,
    projectName: root.split('/').pop() || root,
    files: [],
    local: { root, deviceName: device.name, call },
    extraTools: { ...mcp.tools, ...skills.tools, ...buildAskTool({ userId: o.user.id, runId: o.runId ?? null, onEvent: send, signal: o.signal }) },
    extraInstructions: [memory, QUESTION_GUIDANCE, mcp.inventory, skills.inventory].filter(Boolean).join('\n\n'),
    maxSteps: o.maxSteps ?? 40,
    signal: o.signal,
    onEvent: send,
    resumeMessages: o.resumeMessages,
    deadline: o.deadline,
    onCheckpoint: o.onCheckpoint,
  });
  let text = out.text || 'Done.';
  if (!out.paused && (out.filesModified || []).length > 0) {
    const { autoVerify } = await import('./verify');
    const v = await autoVerify(
      (command, timeoutMs) => call('exec', { cwd: root, command, timeoutMs }, timeoutMs + 30_000),
      (p) => call('read_file', { path: p }),
      root,
    ).catch(() => null);
    if (v) { send('verification', { ok: v.ok, summary: v.summary }); text = `${text}\n\n${v.summary}`; }
  }
  return { text, model: agentModel.label, projectId: null, filesModified: out.filesModified, filesDeleted: [], commandsRun: out.commandsRun, steps: out.steps, paused: out.paused };
}

export interface CoworkTaskOptions extends ResumableRun {
  user: User;
  runId?: string | null;
  prompt: string;
  history?: ModelMessage[];
  timezone?: string;
  pinnedModel?: string | null;
  localStepTimeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export async function runCoworkTask(o: CoworkTaskOptions): Promise<TaskResult> {
  const repo = new DbRepo();
  const platform = new PlatformRepo();
  const send: EventSink = o.onEvent || (() => {});
  const { model, modelId, label, provider } = await getAgentModel(o.user, repo, o.prompt, 'planning', o.pinnedModel, (from, to, reason) => send('model_switch', { from, to, reason }), { localStepTimeoutMs: o.localStepTimeoutMs });
  send('react_model', { model: label, provider, providerModelId: modelId });

  const prefs = await repo.getUserPreferences(o.user.id).catch(() => null);
  const google = await platform.getOAuth(o.user.id, 'google');
  const approval = { mode: normalizeApprovalMode(prefs?.approvalMode), selfEmails: [o.user.email, google?.accountEmail || ''].filter(Boolean) };

  const [mcp, skills, media, bridge] = await Promise.all([
    buildMcpToolset(repo, o.user.id, { platform, approval, onPendingAction: (a) => send('pending_action', a) }),
    buildSkillTools(platform, o.user.id, 'cowork'),
    buildMediaTools(o.user.id, repo, platform, { enhancer: model, onAsset: (a) => send('media_asset', a) }),
    buildBridgeTools(o.user.id, o.prompt),
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
    approval,
    extraTools: { ...mcp.tools, ...skills.tools, ...media.tools, ...bridge.tools, ...buildAskTool({ userId: o.user.id, runId: o.runId ?? null, onEvent: send, signal: o.signal }) },
    extraInstructions: [QUESTION_GUIDANCE, mcp.inventory, skills.inventory, media.inventory, bridge.inventory].filter(Boolean).join('\n\n'),
    signal: o.signal,
    onEvent: send,
    resumeMessages: o.resumeMessages,
    deadline: o.deadline,
    onCheckpoint: o.onCheckpoint,
  });
  return { text: result.text, model: label, projectId: null, filesModified: [], filesDeleted: [], commandsRun: [], steps: result.steps, paused: result.paused };
}

/** Converts streaming agent events into a compact, persisted progress log. */
export function eventRecorder(runId: string, userId: string, runs = new RunsRepo(), previous: RunEvent[] = []) {
  // A resumed run keeps the progress of its earlier segments.
  const events: RunEvent[] = [...previous];
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
    events.push({ at: new Date().toISOString(), type, text: type === 'plan' || type === 'question' ? text.slice(0, 4000) : text.slice(0, 600) });
    dirty = true;
    void flush();
  };
  const sink: EventSink = (event, d) => {
    if (event === 'react_model') model = d.model;
    else if (event === 'react_step') push('step', `${d.tool} ${JSON.stringify(d.args || {}).slice(0, 200)}`);
    else if (event === 'react_observation') push(d.isError ? 'error' : 'result', d.observation || '');
    else if (event === 'pending_action') push('approval', `Waiting for approval in Arcwork: ${d.summary} (action ${d.id})`);
    else if (event === 'media_asset') push('media', `${d.kind}: ${d.url}`);
    else if (event === 'model_switch') push('note', `Switched model ${d.from} → ${d.to} (${d.reason})`);
    else if (event === 'preview') push('preview', d.url);
    else if (event === 'question') push('question', JSON.stringify(d));
    else if (event === 'question_answered') push('answer', JSON.stringify(d));
    else if (event === 'todos') push('plan', JSON.stringify(d.todos || []));
    else if (event === 'file_changed') push('file', d.path);
    else if (event === 'project_created') push('project', d.projectId);
    else if (event === 'react_execution') push('note', d.backend === 'local' ? `Working on ${d.device} in ${d.root}` : d.backend === 'vercel-sandbox' ? 'Working in a private cloud sandbox' : 'No sandbox available: commands will not run');
  };
  return { sink, events, flush: () => flush(true), getModel: () => model };
}
