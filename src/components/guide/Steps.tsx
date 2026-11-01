'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/** Numbered guide steps with copyable values, shared by setup cards and the walkthrough. */

export function CopyText({ value, label, mono = true }: { value: string; label?: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-line/[0.08] bg-canvas px-2.5 py-2">
      {label && <span className="shrink-0 pt-px text-[11px] text-ink-3">{label}</span>}
      <span className={`min-w-0 flex-1 whitespace-pre-wrap text-[12px] text-ink ${mono ? 'shz-mono break-all' : 'break-words'}`}>{value}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value).catch(() => {});
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        aria-label={`Copy ${label || 'text'}`}
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        {done ? <><Check className="h-3 w-3 text-brand" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
      </button>
    </div>
  );
}

export function Step({ n, title, children }: { n: number; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shz-mono mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] text-ink-2">{n}</span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-[13px] text-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}
