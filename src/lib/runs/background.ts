import type { ModelMessage } from 'ai';
import type { User } from '@/lib/types';
import { RunsRepo, type AgentRun, type RunAgent, type RunOptions } from './repo';
import { runCodeTask, runCoworkTask, eventRecorder } from './execute';
import { BridgeOfflineError } from '@/lib/bridge/repo';

/**
 * Background runs outlive one serverless invocation. The function hosting a run is killed
 * after ~13 min (maxDuration 800s), and one slow step on a local model can take minutes, so:
 * - after every step the conversation is saved (checkpoint);
 * - no new step starts after SEGMENT_MS; the run pauses and a fresh invocation
 *   (/api/v1/runs/resume, kicked immediately and polled by cron every minute) continues it;
 * - the run holds a lease while an invocation owns it, so a run whose invocation died is
 *   found and resumed instead of showing "running" forever.
 */
/** 450s + the slowest local step (240s + 90s retry) still ends before the 800s function limit. */
export const SEGMENT_MS = Number(process.env.SHAZAM_RUN_SEGMENT_MS || 450_000);
/** A little longer than a function may live, so an expired lease means the owner is gone. */
export const LEASE_MS = 840_000;
export const MAX_SEGMENTS = Number(process.env.SHAZAM_RUN_MAX_SEGMENTS || 8);
const APP_URL = process.env.APP_URL || 'https://arcwork-ai.vercel.app';

export interface ExecuteRunOptions {
  history?: ModelMessage[];
  timezone?: string;
  pinnedModel?: string | null;
  maxSteps?: number;
}

/** Runs one segment of an agent task and records progress/results on the run row. */
export async function executeRun(user: User, run: AgentRun, opts: ExecuteRunOptions = {}, runs = new RunsRepo()): Promise<void> {
  const started = Date.now();
  const options: RunOptions = {
    ...run.options,
    ...(opts.pinnedModel !== undefined ? { pinnedModel: opts.pinnedModel } : {}),
    ...(opts.timezone ? { timezone: opts.timezone } : {}),
    ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
  };
  if (run.segment === 0) await runs.saveOptions(user.id, run.id, options);
  const rec = eventRecorder(run.id, user.id, runs, run.events);
  await runs.setLease(user.id, run.id, new Date(started + LEASE_MS).toISOString());
  await runs.update(user.id, run.id, { status: 'running' });

  const resumeMessages = run.checkpoint?.length ? (run.checkpoint as ModelMessage[]) : undefined;
  const totalSteps = options.maxSteps ?? 40;
  const stepsLeft = Math.max(1, totalSteps - (options.stepsUsed || 0));
  const resumable = {
    resumeMessages,
    deadline: started + SEGMENT_MS,
    onCheckpoint: (messages: ModelMessage[]) => runs.saveCheckpoint(user.id, run.id, messages).catch(() => {}),
  };

  try {
    const out = run.agent === 'code'
      ? await runCodeTask({
          user,
          prompt: run.prompt,
          projectId: run.projectId?.startsWith('local:') ? null : run.projectId,
          localRoot: run.projectId?.startsWith('local:') ? run.projectId.slice(6) : null,
          history: opts.history,
          pinnedModel: options.pinnedModel,
          maxSteps: stepsLeft,
          runId: run.id,
          onEvent: rec.sink,
          ...resumable,
        })
      : await runCoworkTask({ user, runId: run.id, prompt: run.prompt, history: opts.history, timezone: options.timezone, pinnedModel: options.pinnedModel, onEvent: rec.sink, ...resumable });

    if (out.paused) {
      await runs.saveOptions(user.id, run.id, { ...options, stepsUsed: (options.stepsUsed || 0) + out.steps });
      // A first-segment cloud project is linked now, so the resumed segment works in the same files.
      if (out.projectId && out.projectId !== run.projectId) await runs.setProject(user.id, run.id, out.projectId);
      if (run.segment + 1 >= MAX_SEGMENTS) {
        await rec.flush();
        await runs.setLease(user.id, run.id, null);
        await runs.update(user.id, run.id, {
          status: 'error',
          error: `Stopped after ${MAX_SEGMENTS} time segments (about ${Math.round((MAX_SEGMENTS * SEGMENT_MS) / 60_000)} min) without finishing. Progress is saved: send feedback to continue.`,
          events: rec.events,
        });
        return;
      }
      await rec.flush();
      await runs.setLease(user.id, run.id, null);
      await runs.update(user.id, run.id, {
        status: 'paused',
        events: [...rec.events, { at: new Date().toISOString(), type: 'note', text: 'Reached this server call\'s time limit; progress saved, continuing automatically.' }],
      });
      await kickResume();
      return;
    }

    await rec.flush();
    // The web UI shows commands as chips; assistants on MCP get them in the text.
    const verified = run.source === 'mcp' && out.commandsRun.length ? `\n\nCommands run: ${out.commandsRun.map((c) => `\`${c.command}\` → exit ${c.exitCode}`).join(', ')}` : '';
    await runs.setLease(user.id, run.id, null);
    await runs.update(user.id, run.id, { status: 'done', result: `${out.text}${verified}`, filesChanged: out.filesModified, model: out.model, events: rec.events });
    if (out.projectId && out.projectId !== run.projectId) {
      // Link the auto-created project so feedback continues in the same files.
      await runs.setProject(user.id, run.id, out.projectId);
    }
  } catch (err: any) {
    await rec.flush();
    await runs.setLease(user.id, run.id, null);
    // A resumed run that finds the computer briefly offline waits for the next resume instead of failing.
    if (resumeMessages && isComputerOffline(err) && run.segment + 1 < MAX_SEGMENTS) {
      await runs.update(user.id, run.id, { status: 'paused', events: [...rec.events, { at: new Date().toISOString(), type: 'note', text: 'Your computer is not connected right now; will continue when it is back.' }] });
      return;
    }
    await runs.update(user.id, run.id, { status: 'error', error: err.message || String(err), events: rec.events });
  }
}

/** The paired computer is (briefly) unreachable: worth waiting for rather than failing. */
export function isComputerOffline(err: unknown): boolean {
  return err instanceof BridgeOfflineError || /desktop app is not connected|computer isn't connected/i.test(String((err as any)?.message || ''));
}

/** Asks a fresh invocation to continue paused runs now (cron also polls every minute). */
export async function kickResume(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  await fetch(`${APP_URL}/api/v1/runs/resume`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) }).catch(() => {});
}

/** Claims one run waiting to continue and runs its next segment. Returns the run id, if any. */
export async function resumeNextRun(loadUser: (id: string) => Promise<User | null>, runs = new RunsRepo()): Promise<string | null> {
  const run = await runs.claimResumable(LEASE_MS);
  if (!run) return null;
  const user = await loadUser(run.userId);
  if (!user) {
    await runs.setLease(run.userId, run.id, null);
    await runs.update(run.userId, run.id, { status: 'error', error: 'The account for this run no longer exists.' });
    return run.id;
  }
  if (!run.checkpoint?.length && run.segment > 1) {
    // Died twice before saving any step: retrying again would loop.
    await runs.setLease(user.id, run.id, null);
    await runs.update(user.id, run.id, { status: 'error', error: 'The run stopped before saving any progress. Send feedback to try again.' });
    return run.id;
  }
  await executeRun(user, run, {}, runs);
  return run.id;
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
