'use client';

import React, { useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const MESSAGES: Record<string, string> = {
  connected: 'Google connected. Co-Work can now read, send and schedule email and manage your calendar.',
  denied: 'Google sign-in was cancelled.',
  invalid_state: 'Google sign-in expired or was tampered with. Please try again.',
  error: 'Google sign-in failed while exchanging tokens. Please try again.',
  not_configured: 'Google OAuth is not configured on this deployment yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
};

export function GoogleConnectCard() {
  const [state, setState] = useState<{ configured: boolean; connected: boolean; email: string | null; missingScopes: string[] } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    const r = await fetch('/api/v1/oauth/google').then((res) => (res.ok ? res.json() : null)).catch(() => null);
    setState(r);
  }

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('google');
    if (p && MESSAGES[p]) setFlash(p);
    load();
  }, []);

  async function disconnect() {
    await fetch('/api/v1/oauth/google', { method: 'DELETE' });
    load();
  }

  return (
    <div className="p-5 rounded-2xl bg-surface border border-line/[0.08] space-y-3">
      {flash && (
        <div className={`text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${flash === 'connected' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
          {flash === 'connected' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {MESSAGES[flash]}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-line/5 border border-line/10 flex items-center justify-center shrink-0">
          <Mail className="w-5 h-5 text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">Gmail & Google Calendar</p>
          <p className="text-xs text-ink-2">
            {state?.connected
              ? `Connected as ${state.email || 'your Google account'}. Co-Work can search, draft, send and schedule email (sends always ask you first).`
              : 'Lets Co-Work read your inbox, send and schedule email, and create calendar events, always with your approval.'}
          </p>
        </div>
        {!state ? (
          <Loader2 className="w-4 h-4 animate-spin text-ink-3" />
        ) : state.connected ? (
          <div className="flex gap-2">
            <a href="/api/v1/oauth/google/start" className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink">Reconnect</a>
            <button onClick={disconnect} className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-red-500/10 text-xs text-ink-2 hover:text-red-300">Disconnect</button>
          </div>
        ) : state.configured ? (
          <a href="/api/v1/oauth/google/start" className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-soft text-brand-ink text-xs font-semibold">Connect Google</a>
        ) : (
          <span className="text-[11px] text-ink-3">Awaiting admin setup</span>
        )}
      </div>
    </div>
  );
}
