import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getDb } from '@/lib/env';
import type { SqlDatabase } from '@/lib/db/sql';

/**
 * ask_user: the agent pauses, the question appears as a card (web) or in get_task_status
 * (MCP), and the answer resumes the task. Budgeted so agents don't interrogate people.
 */

export const MAX_QUESTIONS_PER_TASK = 2;
const WAIT_MS = 15 * 60 * 1000;

export class QuestionsRepo {
  constructor(private db: SqlDatabase = getDb()) {}

  async create(userId: string, runId: string | null, question: string, options: string[]): Promise<string> {
    const id = `q_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await this.db
      .prepare('INSERT INTO agent_questions (id, user_id, run_id, question, options, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, userId, runId, question, JSON.stringify(options), new Date().toISOString())
      .run();
    return id;
  }

  async answer(userId: string, id: string, answer: string): Promise<boolean> {
    const r = await this.db
      .prepare('UPDATE agent_questions SET answer = ?, answered_at = ? WHERE id = ? AND user_id = ? AND answer IS NULL')
      .bind(answer.slice(0, 4000), new Date().toISOString(), id, userId)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async get(userId: string, id: string): Promise<{ id: string; question: string; options: string[]; answer: string | null; runId: string | null } | null> {
    const r = await this.db.prepare('SELECT * FROM agent_questions WHERE id = ? AND user_id = ?').bind(id, userId).first<any>();
    return r ? { id: r.id, question: r.question, options: JSON.parse(r.options || '[]'), answer: r.answer, runId: r.run_id } : null;
  }

  async pendingForRun(userId: string, runId: string) {
    const r = await this.db.prepare('SELECT * FROM agent_questions WHERE run_id = ? AND user_id = ? AND answer IS NULL ORDER BY created_at DESC LIMIT 1').bind(runId, userId).first<any>();
    return r ? { id: r.id as string, question: r.question as string, options: JSON.parse(r.options || '[]') as string[] } : null;
  }
}

export const QUESTION_GUIDANCE = `Asking the user (ask_user):
- Default to acting. Pick sensible defaults for stack, style, naming, structure and wording, and state them in your summary.
- Ask only when the answer would materially change the result AND you cannot infer it: who to send something to, which account/repo/folder, a choice that is hard to undo, or genuinely ambiguous requirements.
- Ask everything you need in ONE question when possible, with 2-4 concrete options (the user can also type). At most ${MAX_QUESTIONS_PER_TASK} questions per task.
- For multi-step work, start with todo_write: a short plan (3-7 steps), then keep it updated as you go.`;

export function buildAskTool(opts: { userId: string; runId: string | null; onEvent?: (event: string, data: unknown) => void; signal?: AbortSignal; repo?: QuestionsRepo }): ToolSet {
  const repo = opts.repo || new QuestionsRepo();
  let asked = 0;
  return {
    ask_user: tool({
      description: 'Pause and ask the user one question with 2-4 options. Only when the answer materially changes the result and cannot be inferred (see guidance). Returns their answer.',
      inputSchema: z.object({
        question: z.string().min(5).max(500),
        options: z.array(z.string().min(1).max(120)).min(2).max(4),
      }),
      execute: async ({ question, options }) => {
        if (asked >= MAX_QUESTIONS_PER_TASK) return `Question budget used up (${MAX_QUESTIONS_PER_TASK}). Proceed with your best judgment and state your assumption.`;
        asked++;
        const id = await repo.create(opts.userId, opts.runId, question, options);
        opts.onEvent?.('question', { id, question, options });
        const deadline = Date.now() + WAIT_MS;
        let delay = 800;
        while (Date.now() < deadline && !opts.signal?.aborted) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(3000, delay + 400);
          const q = await repo.get(opts.userId, id);
          if (q?.answer) {
            opts.onEvent?.('question_answered', { id, answer: q.answer });
            return `The user answered: ${q.answer}`;
          }
        }
        return 'No answer yet. Proceed with the most sensible option and say which one you chose.';
      },
    }),
  };
}
