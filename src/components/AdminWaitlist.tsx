'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Users, X } from 'lucide-react';

interface Entry {
  id: string;
  email: string;
  name: string | null;
  useCase: string | null;
  source: string;
  status: 'pending' | 'invited' | 'declined';
  createdAt: string;
}

/** Google test users are capped at 100 for the app's lifetime while unverified. */
const GOOGLE_CAP = 100;
const GOOGLE_AUDIENCE_URL = 'https://console.cloud.google.com/auth/audience?project=shazam-513215';

/**
 * Early-access list. Flow: copy pending emails → add them as test users in Google Cloud
 * (Audience → Test users) → mark them invited here, which unlocks Connect Google for them.
 */
export function AdminWaitlist() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'invited' | 'all'>('pending');

  async function load() {
    const r = await fetch('/api/v1/admin/waitlist').then((res) => (res.ok ? res.json() : { entries: [] })).catch(() => ({ entries: [] }));
    setEntries(r.entries || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: Entry['status']) {
    await fetch('/api/v1/admin/waitlist', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
    load();
  }

  const pending = entries.filter((e) => e.status === 'pending');
  const invited = entries.filter((e) => e.status === 'invited');
  const shown = filter === 'all' ? entries : entries.filter((e) => e.status === filter);

  async function copyPending() {
    try {
      await navigator.clipboard.writeText(pending.map((e) => e.email).join(', '));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="bg-surface border border-line/10 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Users className="w-4 h-4 text-brand" /> Early access (Gmail &amp; Calendar)
        </h2>
        <p className="shz-mono text-[11px] text-ink-3">
          {pending.length} waiting · {invited.length}/{GOOGLE_CAP} Google test users
        </p>
      </div>
      <p className="text-[12px] text-ink-2">
        1. Copy the waiting emails. 2. Add them under{' '}
        <a href={GOOGLE_AUDIENCE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline underline-offset-2">
          Google Cloud → Audience → Test users <ExternalLink className="h-3 w-3" />
        </a>
        . 3. Mark them invited here; that turns on Connect Google for them.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={copyPending} disabled={!pending.length} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
          {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy waiting emails'}
        </button>
        <div className="ml-auto flex gap-1">
          {(['pending', 'invited', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-2.5 py-1 text-[12px] ${filter === f ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
              {f === 'pending' ? 'Waiting' : f === 'invited' ? 'Invited' : 'All'}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-line/[0.06]">
        {shown.length === 0 && <p className="py-3 text-[12px] text-ink-3">Nobody here yet.</p>}
        {shown.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-ink">{e.email}{e.name ? <span className="text-ink-3"> · {e.name}</span> : null}</p>
              <p className="shz-mono text-[11px] text-ink-3">
                {new Date(e.createdAt).toLocaleDateString()} · {e.source}{e.useCase ? ` · ${e.useCase}` : ''}
              </p>
            </div>
            {e.status === 'pending' ? (
              <div className="flex gap-1.5">
                <button onClick={() => setStatus(e.id, 'invited')} className="rounded-lg bg-brand px-2.5 py-1 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft">Mark invited</button>
                <button onClick={() => setStatus(e.id, 'declined')} aria-label="Decline" className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <span className="flex items-center gap-2 text-[12px] text-ink-3">
                {e.status === 'invited' ? 'Invited' : 'Declined'}
                <button onClick={() => setStatus(e.id, 'pending')} className="text-ink-3 underline underline-offset-2 hover:text-ink-2">Undo</button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
