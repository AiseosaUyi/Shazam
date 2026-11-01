'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Loader2, Trash2 } from 'lucide-react';

/** Self-serve account deletion: type your email to confirm, then everything is removed. */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/auth/me', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmEmail: email }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error || 'Could not delete your account. Please try again.');
      window.location.href = '/signup';
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-ink">Delete account</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Permanently deletes your account, chats, projects, keys, connected apps, schedules and generated files. This can&apos;t be undone.{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-2">Privacy Policy</Link>
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/10">
            Delete…
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2 animate-shz-in">
          <label className="block text-[12px] text-ink-2">
            Type your account email to confirm
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[13px] text-ink focus:border-red-400/50 focus:outline-none"
            />
          </label>
          {error && <p className="text-[12px] text-red-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOpen(false); setEmail(''); setError(null); }} className="rounded-xl px-3 py-2 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink">Cancel</button>
            <button type="button" disabled={!email.trim() || busy} onClick={del} className="flex items-center gap-1.5 rounded-xl bg-red-500 px-3 py-2 text-[12px] font-semibold text-ink hover:bg-red-400 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete my account
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
