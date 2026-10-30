'use client';

import React, { useEffect, useState } from 'react';
import { Github, Loader2, Check } from 'lucide-react';
import { useDialog } from '@/components/ui/dialog';

/** GitHub token so the Code agent can push branches and open pull requests from the cloud. */
export function GithubCard() {
  const dialog = useDialog();
  const [hint, setHint] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const c = await fetch('/api/v1/credentials').then((r) => (r.ok ? r.json() : { credentials: [] })).catch(() => ({ credentials: [] }));
    setHint((c.credentials || []).find((x: any) => x.providerId === 'github')?.keyMask || null);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await fetch('/api/v1/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: 'github', apiKey: token.trim() }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error || 'GitHub rejected this token.');
    setToken('');
    setOpen(false);
    load();
  }

  async function remove() {
    if (!(await dialog.confirm({ title: 'Disconnect GitHub?', body: 'The Code agent will no longer push or open pull requests from the cloud.', confirmLabel: 'Disconnect', tone: 'danger' }))) return;
    const me = await fetch('/api/v1/auth/me').then((r) => r.json());
    await fetch(`/api/v1/credentials/${encodeURIComponent(`${me.user.id}:github`)}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="rounded-2xl border border-line/[0.08] bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2"><Github className="h-4 w-4 text-ink-2" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">GitHub</p>
          <p className="text-[12px] text-ink-3">{hint ? 'The Code agent can push branches and open pull requests.' : 'Let the Code agent push branches and open pull requests from the cloud. (The desktop app uses your own git instead.)'}</p>
        </div>
        {hint ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[12px] text-brand-soft"><Check className="h-3.5 w-3.5" /> Connected</span>
            <button onClick={remove} className="rounded-lg px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink">Remove</button>
          </div>
        ) : (
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">{open ? 'Cancel' : 'Connect'}</button>
        )}
      </div>
      {open && !hint && (
        <div className="mt-3 space-y-2 animate-shz-in">
          <div className="flex gap-2">
            <input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && token.trim() && save()} placeholder="Fine-grained token" className="shz-mono min-w-0 flex-1 rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none" />
            <button disabled={!token.trim() || busy} onClick={save} className="rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-40">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}</button>
          </div>
          <p className="text-[11px] text-ink-3">
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:underline">Create a token</a> with Contents and Pull requests set to read & write, for the repos you choose.
          </p>
          {error && <p className="text-[12px] text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
