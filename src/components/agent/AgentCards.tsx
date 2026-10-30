'use client';

import React, { useState } from 'react';
import { CircleHelp, Check, Circle, Loader2 } from 'lucide-react';

/** A question the agent paused on: click an option or type an answer; the task resumes. */
export function QuestionCard({ id, question, options, answered }: { id: string; question: string; options: string[]; answered?: string | null }) {
  const [custom, setCustom] = useState('');
  const [sent, setSent] = useState<string | null>(answered || null);
  const [busy, setBusy] = useState(false);

  async function answer(value: string) {
    if (!value.trim() || sent) return;
    setBusy(true);
    const r = await fetch(`/api/v1/questions/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: value.trim() }) });
    setBusy(false);
    if (r.ok) setSent(value.trim());
  }

  return (
    <div className="rounded-2xl border border-brand/25 bg-brand/[0.04] p-4 animate-shz-in">
      <p className="flex items-start gap-2 text-[13px] font-medium text-ink">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        {question}
      </p>
      {sent ? (
        <p className="mt-2 flex items-center gap-1.5 pl-6 text-[12px] text-ink-2"><Check className="h-3.5 w-3.5 text-brand" /> {sent}</p>
      ) : (
        <div className="mt-3 space-y-2 pl-6">
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button key={o} disabled={busy} onClick={() => answer(o)} className="rounded-xl border border-line/10 bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-brand/40 hover:bg-surface-2 disabled:opacity-50">
                {o}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); answer(custom); }} className="flex gap-2">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type your own answer…" className="min-w-0 flex-1 rounded-xl border border-line/10 bg-canvas px-3 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none" />
            <button disabled={!custom.trim() || busy} className="rounded-xl bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-ink disabled:opacity-40">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Send'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** The agent's plan, updated live as it works. */
export function PlanCard({ todos }: { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }) {
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="rounded-2xl border border-line/[0.08] bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-ink">Plan</p>
        <p className="shz-mono text-[11px] text-ink-3">{done}/{todos.length}</p>
      </div>
      <ol className="mt-2 space-y-1.5">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            {t.status === 'completed' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" /> : t.status === 'in_progress' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-brand" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />}
            <span className={t.status === 'completed' ? 'text-ink-3 line-through decoration-ink-3/40' : 'text-ink-2'}>{t.content}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
