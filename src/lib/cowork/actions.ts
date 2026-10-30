import { PlatformRepo, type PendingAction } from '@/lib/db/platform-repo';
import { DbRepo } from '@/lib/db/repo';
import { decryptSecret } from '@/lib/crypto/vault';
import { sendGmail, validateRecipients } from '@/lib/google/gmail';
import { createCalendarEvent } from '@/lib/google/calendar';
import { callMcpTool } from '@/lib/mcp/client';

/**
 * Executes an action the user explicitly approved. Agents can only *propose* outward
 * actions (send, schedule, create events, mutate MCP data); nothing runs until approval.
 */
export async function executeApprovedAction(action: PendingAction, platform = new PlatformRepo()): Promise<{ ok: boolean; result: string }> {
  const p = action.payload;
  try {
    switch (action.kind) {
      case 'gmail_send': {
        const sent = await sendGmail(action.userId, { to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, body: p.body, html: p.html, inReplyToThreadId: p.threadId });
        return { ok: true, result: `Email sent (Gmail id ${sent.id}).` };
      }
      case 'schedule_email': {
        validateRecipients(p.to);
        const job = await platform.createJob(action.userId, {
          kind: 'email',
          title: `Email: ${p.subject}`,
          payload: { to: p.to, cc: p.cc, subject: p.subject, body: p.body, html: p.html },
          runAt: p.sendAt,
          recurrence: p.recurrence || null,
          timezone: p.timezone || 'UTC',
          idempotencyKey: `action:${action.id}`,
        });
        return { ok: true, result: `Scheduled for ${job.runAt}${job.recurrence ? ` (repeats ${job.recurrence})` : ''}. Job id ${job.id}.` };
      }
      case 'schedule_task': {
        const job = await platform.createJob(action.userId, {
          kind: 'agent_task',
          title: p.title,
          payload: { prompt: p.prompt, emailResultTo: p.emailResultTo || null },
          runAt: p.runAt,
          recurrence: p.recurrence || null,
          timezone: p.timezone || 'UTC',
          idempotencyKey: `action:${action.id}`,
        });
        return { ok: true, result: `Task scheduled for ${job.runAt}${job.recurrence ? ` (repeats ${job.recurrence})` : ''}. Job id ${job.id}.` };
      }
      case 'calendar_create': {
        const ev = await createCalendarEvent(action.userId, p);
        return { ok: true, result: `Event created: ${ev.link}${ev.meet ? ` (Meet: ${ev.meet})` : ''}` };
      }
      case 'mcp_call': {
        const repo = new DbRepo();
        const server = (await repo.getMcpServers(action.userId)).find((s) => s.id === p.serverId);
        if (!server) return { ok: false, result: 'That MCP server is no longer connected.' };
        const enc = await repo.getMcpServerAuth(action.userId, server.id);
        const authToken = enc ? await decryptSecret(enc).catch(() => undefined) : undefined;
        const out = await callMcpTool({ url: server.url, authToken }, p.tool, p.args || {});
        return { ok: !out.isError, result: out.text.slice(0, 8000) || '(empty result)' };
      }
      default:
        return { ok: false, result: `Unknown action type "${action.kind}".` };
    }
  } catch (err: any) {
    return { ok: false, result: err.message || String(err) };
  }
}
