import { tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { streamAgent } from '@/lib/agent/stream';
import type { PlatformRepo } from '@/lib/db/platform-repo';
import { searchGmail, readGmail, createGmailDraft, validateRecipients } from '@/lib/google/gmail';
import { listCalendarEvents } from '@/lib/google/calendar';
import { GoogleNotConnectedError } from '@/lib/google/oauth';
import { describeNow, RECURRENCES } from '@/lib/jobs/recurrence';

/**
 * Co-Work agent: an assistant that does real work through tools (Gmail, Calendar,
 * schedules, MCP servers, skills). Outward actions are proposed into the approval queue
 * and only run after the user approves them in the UI.
 */

export interface CoworkAgentOptions {
  model: LanguageModel;
  userId: string;
  prompt: string;
  history?: ModelMessage[];
  timezone: string;
  platform: PlatformRepo;
  googleConnected: boolean;
  googleEmail?: string | null;
  extraTools?: ToolSet;
  extraInstructions?: string;
  /** For scheduled runs: there is no user to approve, so only read-only tools are offered. */
  unattended?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: string, data: unknown) => void;
}

function parseFutureDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`"${iso}" is not a valid ISO-8601 date-time. Include the timezone offset, e.g. 2026-11-02T09:00:00+01:00.`);
  if (d.getTime() < Date.now() - 60_000) throw new Error(`${iso} is in the past. Call current_time and pick a future time.`);
  if (d.getTime() > Date.now() + 366 * 86400_000) throw new Error('Schedules more than a year ahead are not supported.');
  return d;
}

const googleGuard = async <T>(fn: () => Promise<T>): Promise<T | string> => {
  try {
    return await fn();
  } catch (err: any) {
    if (err instanceof GoogleNotConnectedError) return err.message;
    return `Error: ${err.message || err}`;
  }
};

export async function runCoworkAgent(opts: CoworkAgentOptions): Promise<{ text: string; steps: number }> {
  const { userId, platform, timezone, onEvent } = opts;

  const propose = async (kind: string, summary: string, payload: unknown) => {
    if (opts.unattended) return `NOT RUN: "${summary}" needs the user's approval and this is an unattended scheduled run.`;
    const action = await platform.createPendingAction(userId, kind, summary, payload);
    onEvent?.('pending_action', { id: action.id, kind, summary, payload });
    return `AWAITING USER APPROVAL (action ${action.id}): ${summary}. It has NOT happened yet. Tell the user to review and approve it in the chat.`;
  };

  const emailSchema = {
    to: z.array(z.string()).min(1),
    cc: z.array(z.string()).optional(),
    subject: z.string().min(1),
    body: z.string().min(1).describe('Complete email body, ready to send. Sign off with the user\'s name if known.'),
  };

  const tools: ToolSet = {
    current_time: tool({
      description: 'Get the current date and time in the user\'s timezone. Call this before scheduling anything relative ("tomorrow 9am").',
      inputSchema: z.object({}),
      execute: async () => describeNow(timezone),
    }),
    list_schedules: tool({
      description: 'List the user\'s scheduled emails and tasks.',
      inputSchema: z.object({}),
      execute: async () => {
        const jobs = await platform.listJobs(userId);
        if (!jobs.length) return 'No scheduled emails or tasks.';
        return jobs.map((j) => `${j.id} | ${j.status} | ${j.title} | runs ${j.runAt}${j.recurrence ? ` (${j.recurrence})` : ''}${j.lastError ? ` | last error: ${j.lastError}` : ''}`).join('\n');
      },
    }),
    cancel_schedule: tool({
      description: 'Cancel a scheduled email or task by job id.',
      inputSchema: z.object({ job_id: z.string() }),
      execute: async ({ job_id }) => ((await platform.setJobStatus(userId, job_id, 'cancelled')) ? `Cancelled ${job_id}.` : `Could not cancel ${job_id} (not found or already finished).`),
    }),
  };

  if (!opts.unattended) {
    tools.schedule_task = tool({
      description: 'Schedule a Co-Work task (e.g. "every Friday 5pm summarize my inbox and email me"). Requires user approval.',
      inputSchema: z.object({
        title: z.string(),
        prompt: z.string().describe('Exact instruction the agent will run at that time.'),
        run_at: z.string().describe('ISO-8601 with timezone offset'),
        recurrence: z.enum(RECURRENCES as [string, ...string[]]).optional(),
        email_result_to: z.string().optional().describe('Email the result to this address after each run.'),
      }),
      execute: async ({ title, prompt, run_at, recurrence, email_result_to }) => {
        try {
          const when = parseFutureDate(run_at);
          return await propose('schedule_task', `Schedule task "${title}" at ${when.toISOString()}${recurrence ? ` repeating ${recurrence}` : ''}`, {
            title, prompt, runAt: when.toISOString(), recurrence, timezone, emailResultTo: email_result_to,
          });
        } catch (err: any) {
          return `Error: ${err.message}`;
        }
      },
    });
  }

  if (opts.googleConnected) {
    Object.assign(tools, {
      gmail_search: tool({
        description: 'Search the user\'s Gmail with Gmail query syntax (e.g. "from:sam newer_than:7d", "is:unread").',
        inputSchema: z.object({ query: z.string(), max_results: z.number().int().min(1).max(25).optional() }),
        execute: async ({ query, max_results }) => googleGuard(async () => {
          const hits = await searchGmail(userId, query, max_results || 10);
          return hits.length ? hits.map((h) => `id:${h.id} | ${h.date} | ${h.from} | ${h.subject}\n  ${h.snippet}`).join('\n') : 'No messages found.';
        }),
      }),
      gmail_read: tool({
        description: 'Read one Gmail message by id.',
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => googleGuard(async () => {
          const m = await readGmail(userId, id);
          return `From: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\nThread: ${m.threadId}\n\n${m.body}`;
        }),
      }),
      gmail_create_draft: tool({
        description: 'Save an email as a Gmail draft (does not send).',
        inputSchema: z.object(emailSchema),
        execute: async (email) => googleGuard(async () => {
          const d = await createGmailDraft(userId, email);
          return `Draft saved in Gmail (draft id ${d.id}).`;
        }),
      }),
      calendar_list_events: tool({
        description: 'List calendar events between two ISO date-times.',
        inputSchema: z.object({ time_min: z.string(), time_max: z.string() }),
        execute: async ({ time_min, time_max }) => googleGuard(async () => {
          const events = await listCalendarEvents(userId, new Date(time_min).toISOString(), new Date(time_max).toISOString());
          return events.length ? events.map((e: any) => `${e.start} → ${e.end} | ${e.summary}${e.attendees.length ? ` | ${e.attendees.join(', ')}` : ''}`).join('\n') : 'No events in that range.';
        }),
      }),
    });

    if (!opts.unattended) {
      Object.assign(tools, {
        gmail_send: tool({
          description: 'Send an email now from the user\'s Gmail. Requires user approval.',
          inputSchema: z.object({ ...emailSchema, thread_id: z.string().optional() }),
          execute: async ({ to, cc, subject, body, thread_id }) => {
            try {
              validateRecipients([...to, ...(cc || [])]);
            } catch (err: any) {
              return `Error: ${err.message}`;
            }
            return propose('gmail_send', `Send "${subject}" to ${to.join(', ')}`, { to, cc, subject, body, threadId: thread_id });
          },
        }),
        schedule_email: tool({
          description: 'Schedule an email to send later (optionally recurring). Requires user approval.',
          inputSchema: z.object({
            ...emailSchema,
            send_at: z.string().describe('ISO-8601 with timezone offset, e.g. 2026-11-02T09:00:00+01:00'),
            recurrence: z.enum(RECURRENCES as [string, ...string[]]).optional(),
          }),
          execute: async ({ to, cc, subject, body, send_at, recurrence }) => {
            try {
              validateRecipients([...to, ...(cc || [])]);
              const when = parseFutureDate(send_at);
              const local = new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(when);
              return await propose('schedule_email', `Schedule "${subject}" to ${to.join(', ')} for ${local}${recurrence ? `, repeating ${recurrence}` : ''}`, {
                to, cc, subject, body, sendAt: when.toISOString(), recurrence, timezone,
              });
            } catch (err: any) {
              return `Error: ${err.message}`;
            }
          },
        }),
        calendar_create_event: tool({
          description: 'Create a calendar event and invite attendees. Requires user approval.',
          inputSchema: z.object({
            summary: z.string(),
            description: z.string().optional(),
            start: z.string(),
            end: z.string(),
            attendees: z.array(z.string()).optional(),
            add_meet: z.boolean().optional(),
          }),
          execute: async ({ summary, description, start, end, attendees, add_meet }) => {
            try {
              parseFutureDate(start);
            } catch (err: any) {
              return `Error: ${err.message}`;
            }
            return propose('calendar_create', `Create event "${summary}" ${start} → ${end}${attendees?.length ? ` with ${attendees.join(', ')}` : ''}`, {
              summary, description, start, end, timeZone: timezone, attendees, addMeet: add_meet,
            });
          },
        }),
      });
    }
  }

  Object.assign(tools, opts.extraTools || {});

  const instructions = `You are Shazam Co-Work, a capable executive assistant that gets real work done with tools.
Current time: ${describeNow(timezone)}.
${opts.googleConnected ? `Google is connected as ${opts.googleEmail || 'the user'}: you can search/read Gmail, draft, send, schedule email and use Calendar.` : 'Google (Gmail/Calendar) is NOT connected. If the user wants email or calendar actions, tell them to click "Connect Google" in Connections. Do not pretend to send or schedule anything.'}

How to work:
- Use tools to do the task instead of describing what you would do.
- Before scheduling, call current_time and convert relative times ("tomorrow 9am") to ISO-8601 with the user's offset.
- Sending, scheduling, creating events and changing external data go to the user for approval. Tool results say "AWAITING USER APPROVAL": tell the user it is ready for their approval. Never say it was sent or scheduled before approval.
- Write emails completely (greeting, body, sign-off). Never leave placeholders like [Your Name] if you know the name; ask if you do not.
- Only mention tools, MCP servers and skills that appear in your tool list. If something is not connected, say so plainly.
- Be concise. Finish with what was done and what is waiting for approval.
${opts.extraInstructions ? `\n${opts.extraInstructions}` : ''}`;

  return streamAgent({
    model: opts.model,
    instructions,
    messages: [...(opts.history || []), { role: 'user', content: opts.prompt }],
    tools,
    maxSteps: 25,
    signal: opts.signal,
    onEvent,
  });
}
