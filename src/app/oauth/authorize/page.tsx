'use client';

import React, { useEffect, useState } from 'react';
import { Zap, ShieldCheck, Loader2 } from 'lucide-react';

/** OAuth consent screen for MCP clients such as Claude.ai custom connectors. */
export default function AuthorizePage() {
  const [info, setInfo] = useState<{ clientName: string; redirectHost: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = Object.fromEntries(q.entries());
    setParams(p);
    (async () => {
      const me = await fetch('/api/v1/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!me?.user) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const r = await fetch(`/api/oauth/authorize?${q.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.description || d.error || 'Invalid authorization request.');
      else setInfo(d);
    })();
  }, []);

  async function decide(decision: 'allow' | 'deny') {
    setBusy(true);
    const r = await fetch('/api/oauth/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, decision }) });
    const d = await r.json().catch(() => ({}));
    if (d.redirect) window.location.href = d.redirect;
    else {
      setError(d.error || 'Authorization failed.');
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 min-h-full flex items-center justify-center p-6 bg-[#0a0c10]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1118] p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400"><Zap className="w-5 h-5" /></div>
          <div>
            <p className="text-sm font-semibold text-white">Connect to Shazam</p>
            <p className="text-xs text-zinc-400">Authorize an assistant to use your Shazam agents</p>
          </div>
        </div>
        {error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : !info ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        ) : (
          <>
            <p className="text-sm text-zinc-200"><strong>{info.clientName}</strong> wants to:</p>
            <ul className="text-xs text-zinc-300 space-y-1.5 list-disc pl-5">
              <li>start Code and Co-Work tasks on your behalf and read their results</li>
              <li>read files in your Shazam projects and generate images</li>
              <li>see and decide actions waiting for your approval</li>
            </ul>
            <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> It will return to {info.redirectHost}. You can revoke access anytime in Connections.</p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => decide('allow')} className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-sm font-semibold">Allow</button>
              <button disabled={busy} onClick={() => decide('deny')} className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-200 text-sm">Deny</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
