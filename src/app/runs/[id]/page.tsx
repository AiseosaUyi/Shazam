'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Bot } from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

/** Live view of a background agent run (e.g. one Claude Code delegated over MCP). */
export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/v1/runs/${id}`);
      if (r.status === 401) {
        window.location.href = `/login?next=/runs/${id}`;
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error || 'Not found');
      else setRun(d.run);
      if (!stop && (!d.run || d.run.status === 'queued' || d.run.status === 'running')) setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [id]);

  if (error) return <div className="p-8 text-sm text-red-300">{error}</div>;
  if (!run) return <div className="p-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;
  const live = run.status === 'queued' || run.status === 'running';

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0a0c10]">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-amber-400" />
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">{run.agent === 'code' ? 'Code agent' : 'Co-Work'} · started from {run.source === 'mcp' ? 'an assistant (MCP)' : 'Shazam'} · {run.model || 'choosing model…'}</p>
            <p className="text-sm text-white font-medium truncate">{run.prompt}</p>
          </div>
          <span className={`ml-auto text-[10px] uppercase font-bold px-2 py-0.5 rounded ${live ? 'bg-amber-500/15 text-amber-300' : run.status === 'done' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{run.status}</span>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1 max-h-[45vh] overflow-y-auto">
          {run.events.length === 0 && <p className="text-xs text-zinc-500">Waiting for the first step…</p>}
          {run.events.map((e: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              {e.type === 'error' ? <AlertCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />}
              <span className={`${e.type === 'step' ? 'text-zinc-200 font-mono' : e.type === 'note' || e.type === 'approval' ? 'text-amber-200' : 'text-zinc-400'} break-all`}>{e.text}</span>
            </div>
          ))}
          {live && <div className="flex items-center gap-2 text-[11px] text-zinc-500"><Loader2 className="w-3 h-3 animate-spin" /> working…</div>}
        </div>

        {run.result && <MarkdownRenderer content={run.result} className="text-sm text-zinc-200" />}
        {run.error && <p className="text-sm text-red-300">{run.error}</p>}
        {run.projectId && <Link href={`/agent?project=${run.projectId}`} className="inline-block text-xs text-amber-300 hover:underline">Open the project ({run.filesChanged.length} files changed)</Link>}
      </div>
    </div>
  );
}
