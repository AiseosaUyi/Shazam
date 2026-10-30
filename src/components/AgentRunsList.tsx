'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Code2, Zap, Bot } from 'lucide-react';

/** Every Code / Co-Work task, including ones your assistant (Claude, Codex…) started over MCP. */
export function AgentRunsList({ source, title = 'Agent tasks', blurb = 'Code and Co-Work tasks, including ones your assistants started.' }: { source?: 'mcp' | 'web'; title?: string; blurb?: string } = {}) {
  const [runs, setRuns] = useState<Array<{ id: string; agent: string; prompt: string; status: string; model: string | null; source: string; createdAt: string }> | null>(null);
  useEffect(() => {
    fetch('/api/v1/runs').then((r) => (r.ok ? r.json() : { runs: [] })).then((d) => setRuns((d.runs || []).filter((x: any) => !source || x.source === source))).catch(() => setRuns([]));
  }, [source]);

  return (
    <div className="rounded-2xl border border-line/[0.08] bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      <p className="text-[12px] text-ink-3">{blurb}</p>
      {runs === null ? (
        <div className="h-16" />
      ) : runs.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-ink-3">Nothing yet.</p>
      ) : (
        <div className="mt-2 divide-y divide-line/[0.06]">
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2/40">
              {r.source === 'mcp' ? <Bot className="h-4 w-4 shrink-0 text-ink-3" /> : r.agent === 'code' ? <Code2 className="h-4 w-4 shrink-0 text-ink-3" /> : <Zap className="h-4 w-4 shrink-0 text-ink-3" />}
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.prompt}</span>
              <span className="shz-mono hidden shrink-0 text-[11px] text-ink-3 sm:inline">{r.model?.split(' · ')[0] || ''}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${r.status === 'done' ? 'bg-brand/10 text-brand-soft' : r.status === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-surface-2 text-ink-2'}`}>
                {r.status === 'done' ? 'Done' : r.status === 'error' ? 'Failed' : 'Running'}
              </span>
              <span className="shz-mono hidden w-28 shrink-0 text-right text-[11px] text-ink-3 md:inline">{new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
