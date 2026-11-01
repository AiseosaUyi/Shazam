'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Monitor, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import { CopyText, Step } from '@/components/guide/Steps';

/**
 * Connect your computer. Two jobs:
 *   /connect?code=ABCD-EFGH  the desktop app or `npx arcwork connect` opened this; approve it.
 *   /connect                 how to start (open the desktop app, or one terminal command).
 */

interface PendingRequest {
  kind: 'desktop' | 'browser';
  name: string;
  platform: string | null;
  createdAt: string;
  sameNetwork: boolean | null;
}

const PLATFORM: Record<string, string> = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' };

function Card({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-md rounded-2xl border border-line/[0.08] bg-surface p-6">{children}</div>;
}

function Approve({ code }: { code: string }) {
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'approved' | 'denied' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/auth/me').then((r) => (r.ok ? r.json() : { user: null })).then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/v1/bridge/device/approve?code=${encodeURIComponent(code)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setRequest(d.request);
        else setError(d.error || 'Something went wrong.');
      })
      .catch(() => setError('Could not reach Arcwork. Check your connection and reload.'));
  }, [user, code]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError('');
    const r = await fetch('/api/v1/bridge/device/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_code: code, approve }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setDone(approve ? 'approved' : 'denied');
    else setError(d.error || 'Something went wrong.');
  }

  if (user === undefined) return <Card><p className="text-[13px] text-ink-3">Loading…</p></Card>;
  if (user === null) {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-ink">Sign in to connect your computer</h1>
        <p className="mt-1 text-[13px] text-ink-2">Your computer will be linked to the Arcwork account you sign in with.</p>
        <Link href={`/login?next=${encodeURIComponent(`/connect?code=${code}`)}`} className="mt-4 inline-block rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft">Sign in</Link>
      </Card>
    );
  }
  if (done) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-ink">
          <Check className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold">{done === 'approved' ? 'Your computer is connected' : 'Connection declined'}</h1>
        </div>
        <p className="mt-2 text-[13px] text-ink-2">
          {done === 'approved'
            ? 'You can close this tab. The first time an agent needs a folder, your computer asks you to allow it.'
            : 'Nothing was connected. You can close this tab.'}
        </p>
        {done === 'approved' && <Link href="/connections#devices" className="mt-4 inline-block text-[13px] text-brand hover:text-brand-soft">See your devices</Link>}
      </Card>
    );
  }
  if (error && !request) {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-ink">Can’t connect with this link</h1>
        <p className="mt-1 text-[13px] text-ink-2">{error}</p>
        <Link href="/connect" className="mt-4 inline-block text-[13px] text-brand hover:text-brand-soft">How to connect</Link>
      </Card>
    );
  }
  if (!request) return <Card><p className="text-[13px] text-ink-3">Checking the code…</p></Card>;

  const where = request.platform ? PLATFORM[request.platform] || request.platform : 'computer';
  return (
    <Card>
      <div className="flex items-center gap-2 text-ink">
        <Monitor className="h-5 w-5 text-brand" />
        <h1 className="text-lg font-semibold">Connect “{request.name}”?</h1>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">
        This lets Arcwork agents work on this {where} for <span className="text-ink">{user.email}</span>: run commands and edit files, only in folders you allow there.
      </p>

      <div className="mt-4 rounded-xl border border-line/[0.08] bg-canvas p-3 text-center">
        <p className="text-[11px] text-ink-3">Check that your computer shows this code</p>
        <p className="shz-mono mt-1 text-2xl tracking-[0.25em] text-ink">{code.toUpperCase()}</p>
      </div>

      {request.sameNetwork === false && (
        <p className="mt-3 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[12px] text-ink-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          This request came from a different network than the one you’re on. Only approve if you started it on your own computer just now.
        </p>
      )}

      <p className="mt-3 flex gap-2 text-[12px] text-ink-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Never approve a code someone sent you. Risky commands (push, delete, publish) still ask you on your computer first.
      </p>
      {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button disabled={busy} onClick={() => decide(true)} className="flex-1 rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-60">Approve</button>
        <button disabled={busy} onClick={() => decide(false)} className="rounded-xl bg-line/5 px-4 py-2 text-[13px] text-ink hover:bg-line/10 disabled:opacity-60">Deny</button>
      </div>
    </Card>
  );
}

function HowTo() {
  return (
    <Card>
      <div className="flex items-center gap-2 text-ink">
        <Monitor className="h-5 w-5 text-brand" />
        <h1 className="text-lg font-semibold">Connect your computer</h1>
      </div>
      <p className="mt-1 text-[13px] text-ink-2">Lets Arcwork agents work in folders on your computer. It connects out to Arcwork, so nothing on your computer is opened to the internet.</p>
      <ol className="mt-4 space-y-3">
        <Step n={1} title={<>Have the Arcwork desktop app? <a href="arcwork://connect" className="text-brand hover:text-brand-soft">Open it and click Connect</a>.</>} />
        <Step n={2} title="No app? Open a terminal in your project folder and run this. It opens this page to approve, allows that folder and keeps running in the background.">
          <CopyText value="npx arcwork connect" />
        </Step>
      </ol>
      <p className="mt-3 text-[11px] text-ink-3">Needs Node 18 or newer. Arcwork asks before working in any other folder, and before risky commands.</p>
    </Card>
  );
}

function ConnectInner() {
  const code = useSearchParams().get('code') || '';
  return <div className="flex flex-1 items-center justify-center bg-canvas p-6">{code ? <Approve code={code} /> : <HowTo />}</div>;
}

export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectInner />
    </Suspense>
  );
}
