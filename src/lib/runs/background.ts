import type { ModelMessage } from 'ai';
import type { User } from '@/lib/types';
import { RunsRepo, type AgentRun, type RunAgent } from './repo';
import { runCodeTask, runCoworkTask, eventRecorder } from './execute';

/** Runs an agent task to completion and records progress/results on the run row. */
export async function executeRun(user: User, run: AgentRun, opts: { history?: ModelMessage[]; timezone?: string; pinnedModel?: string | null; maxSteps?: number } = {}): Promise<void> {
  const runs = new RunsRepo();
  const rec = eventRecorder(run.id, user.id, runs);
  await runs.update(user.id, run.id, { status: 'running' });
  try {
    const out = run.agent === 'code'
      ? await runCodeTask({
          user,
          prompt: run.prompt,
          projectId: run.projectId?.startsWith('local:') ? null : run.projectId,
          localRoot: run.projectId?.startsWith('local:') ? run.projectId.slice(6) : null,
          history: opts.history,
          pinnedModel: opts.pinnedModel,
          maxSteps: opts.maxSteps,
          runId: run.id,
          onEvent: rec.sink,
        })
      : await runCoworkTask({ user, runId: run.id, prompt: run.prompt, history: opts.history, timezone: opts.timezone, pinnedModel: opts.pinnedModel, onEvent: rec.sink });
    await rec.flush();
 // The web UI shows commands as chips; assistants on MCP get them in the text.
    const verified = run.source === 'mcp' && out.commandsRun.length ? `\n\nCommands run: ${out.commandsRun.map((c) => `\`${c.command}\` → exit ${c.exitCode}`).join(', ')}` : '';
    await runs.update(user.id, run.id, { status: 'done', result: `${out.text}${verified}`, filesChanged: out.filesModified, model: out.model, events: rec.events });
    if (out.projectId && out.projectId !== run.projectId) {
      // Link the auto-created project so feedback continues in the same files.
      await runs.setProject(user.id, run.id, out.projectId);
    }
  } catch (err: any) {
    await rec.flush();
    await runs.update(user.id, run.id, { status: 'error', error: err.message || String(err), events: rec.events });
  }
}

export function buildFeedbackHistory(parent: AgentRun): ModelMessage[] {
  return [
    { role: 'user', content: parent.prompt },
    { role: 'assistant', content: parent.result || parent.error || '(no result)' },
  ];
}

export async function startRun(user: User, agent: RunAgent, prompt: string, opts: { projectId?: string | null; parentRunId?: string | null; source?: string } = {}) {
  return new RunsRepo().create(user.id, { agent, prompt, projectId: opts.projectId, parentRunId: opts.parentRunId, source: opts.source });
}
