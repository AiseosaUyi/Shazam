'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, AlertTriangle, ArrowRight, Lightbulb } from 'lucide-react';

/**
 * Shows, before running, which agent and model fit the request and what is missing.
 * Debounced; the suggestion engine is deterministic and free.
 */

interface Suggestion {
  agent: 'code' | 'cowork' | 'image' | 'video' | 'chat';
  confidence: number;
  reason: string;
  model: string;
  missing: Array<{ what: string; fix: string }>;
  tips: string[];
}

const LABEL: Record<Suggestion['agent'], string> = { code: 'Code agent', cowork: 'Co-Work', image: 'Image', video: 'Video edit', chat: 'Chat' };
const HOME: Record<Suggestion['agent'], string> = { code: '/agent', cowork: '/cowork', image: '/', video: '/cowork', chat: '/' };

export function AgentSuggestion({ prompt, current }: { prompt: string; current: 'code' | 'cowork' | 'chat' }) {
  const [s, setS] = useState<Suggestion | null>(null);

  useEffect(() => {
    const text = prompt.trim();
    if (text.length < 12) {
      setS(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch('/api/v1/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text }) }).then((res) => (res.ok ? res.json() : null)).catch(() => null);
      setS(r?.suggestion || null);
    }, 450);
    return () => clearTimeout(t);
  }, [prompt]);

  if (!s) return null;
  const handledHere = s.agent === current || (current === 'cowork' && (s.agent === 'image' || s.agent === 'video')) || (current === 'chat' && s.agent === 'image');
  const target = `${HOME[s.agent]}?prompt=${encodeURIComponent(prompt.trim().slice(0, 1500))}`;

  return (
    <div className="mb-2 rounded-xl border border-line/[0.07] bg-line/[0.02] px-3 py-2 text-[11px] space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="w-3.5 h-3.5 text-brand shrink-0" />
        <span className="text-ink-2">
          Best fit: <strong className="text-ink">{LABEL[s.agent]}</strong> · {s.model}
        </span>
        {!handledHere && (
          <Link href={target} className="ml-auto flex items-center gap-1 text-brand-soft hover:text-brand-soft">
            Open in {LABEL[s.agent]} <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      {s.missing.map((m) => (
        <p key={m.what} className="flex items-start gap-1.5 text-brand-soft/90">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span><strong>{m.what}:</strong> {m.fix} <Link href="/connections" className="underline">Connections</Link></span>
        </p>
      ))}
      {s.tips.slice(0, 1).map((tip) => (
        <p key={tip} className="flex items-start gap-1.5 text-ink-3"><Lightbulb className="w-3 h-3 mt-0.5 shrink-0" />{tip}</p>
      ))}
    </div>
  );
}
