import { PlatformRepo, type ScheduledJob } from '@/lib/db/platform-repo';
import { DbRepo } from '@/lib/db/repo';
import { sendGmail } from '@/lib/google/gmail';
import { nextOccurrence } from './recurrence';
import { getAgentModel } from '@/lib/agent/resolve';
import { runCoworkAgent } from '@/lib/cowork/agent';
import { buildMcpToolset } from '@/lib/mcp/tools';
import { buildSkillTools } from '@/lib/skills';

/** Executes one claimed job. Scheduled agent tasks run read-only (no one is there to approve). */
async function executeJob(job: ScheduledJob, platform: PlatformRepo): Promise<string> {
  if (job.kind === 'email') {
    const p = job.payload;
    const sent = await sendGmail(job.userId, { to: p.to, cc: p.cc, subject: p.subject, body: p.body, html: p.html });
    return `Sent (Gmail id ${sent.id}) to ${p.to.join(', ')}`;
  }

  if (job.kind === 'agent_task') {
    const repo = new DbRepo();
    const user = await repo.getUserById(job.userId);
    if (!user) throw new Error('User no longer exists.');
    const { model } = await getAgentModel(user, repo, job.payload.prompt, 'planning');
    const google = await platform.getOAuth(job.userId, 'google');
    const mcp = await buildMcpToolset(repo, job.userId, { platform });
    const skills = await buildSkillTools(platform, job.userId, 'cowork');
    const result = await runCoworkAgent({
      model,
      userId: job.userId,
      prompt: job.payload.prompt,
      timezone: job.timezone,
      platform,
      googleConnected: Boolean(google),
      googleEmail: google?.accountEmail,
      extraTools: { ...mcp.tools, ...skills.tools },
      extraInstructions: [mcp.inventory, skills.inventory].filter(Boolean).join('\n\n'),
      unattended: true,
    });
    if (job.payload.emailResultTo && google) {
      // The user approved this delivery when they approved the schedule.
      await sendGmail(job.userId, { to: [job.payload.emailResultTo], subject: `Shazam: ${job.title}`, body: result.text || '(no output)' });
    }
    return result.text.slice(0, 6000) || '(no output)';
  }

  throw new Error(`Unknown job kind ${job.kind}`);
}

export async function runDueJobs(limit = 10): Promise<Array<{ id: string; ok: boolean; output: string }>> {
  const platform = new PlatformRepo();
  const jobs = await platform.claimDueJobs(limit);
  const results = [];
  for (const job of jobs) {
    try {
      const output = await executeJob(job, platform);
      await platform.finishJob(job, { ok: true, output, nextRunAt: nextOccurrence(job.runAt, job.recurrence, job.timezone) });
      results.push({ id: job.id, ok: true, output });
    } catch (err: any) {
      const output = err.message || String(err);
      await platform.finishJob(job, { ok: false, output });
      results.push({ id: job.id, ok: false, output });
    }
  }
  return results;
}
