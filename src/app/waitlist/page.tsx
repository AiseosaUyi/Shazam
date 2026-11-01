'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader2, Mail } from 'lucide-react';
import { PublicShell } from '@/components/public/PublicShell';
import { BRAND_NAME } from '@/lib/brand';

/**
 * Early access. Everything except Gmail & Calendar is open to all; Google limits apps in review
 * to approved test users, so people join this list and we turn it on for them in batches.
 */
const USES = ['Email & calendar', 'Coding', 'Images & video', 'A bit of everything'];

export default function WaitlistPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | 'pending' | 'invited'>(null);
  const [account, setAccount] = useState<{ email: string } | null>(null);

  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setAccount({ email: d.user.email }))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account ? undefined : email, name: name || undefined, useCase: useCase || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error || 'Something went wrong. Please try again.');
      setDone(d.status === 'invited' ? 'invited' : 'pending');
    } catch {
      setError('Network problem. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell width="max-w-md">
      {done ? (
        <div className="pt-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.02em] text-ink">{done === 'invited' ? 'You already have access' : 'You’re on the list'}</h1>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-ink-2">
            {done === 'invited'
              ? 'Gmail & Calendar are on for your account. Connect Google in Connections.'
              : 'We’ll turn on Gmail & Calendar for you soon and let you know by email. Everything else works right now.'}
          </p>
          <Link href={account ? (done === 'invited' ? '/connections#apps' : '/') : '/signup'} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-brand-ink hover:bg-brand-soft">
            {account ? (done === 'invited' ? 'Open Connections' : `Open ${BRAND_NAME}`) : 'Create your free account'} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.025em] text-ink">Early access to email agents</h1>
          <p className="mt-2 text-[14px] text-ink-2">
            Let agents read, draft, send and schedule your email and manage your calendar, always with your approval. While Google reviews {BRAND_NAME},
            we&apos;re letting people in in small batches.
          </p>
          <p className="mt-2 text-[13px] text-ink-3">
            Coding, chat, images and video are free for everyone today.{' '}
            {!account && (
              <Link href="/signup" className="text-ink-2 underline underline-offset-2 hover:text-ink">Create an account</Link>
            )}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {account ? (
              <p className="rounded-xl border border-line/10 bg-surface px-3.5 py-2.5 text-[13px] text-ink-2">
                Joining as <span className="text-ink">{account.email}</span>
              </p>
            ) : (
              <label className="block">
                <span className="text-[12px] text-ink-3">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gmail.com"
                  className="mt-1 w-full rounded-xl border border-line/10 bg-canvas px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="text-[12px] text-ink-3">Name <span className="text-ink-3/70">(optional)</span></span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1 w-full rounded-xl border border-line/10 bg-canvas px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none"
              />
            </label>
            <div>
              <span className="text-[12px] text-ink-3">What will you use it for? <span className="text-ink-3/70">(optional)</span></span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {USES.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUseCase(useCase === u ? null : u)}
                    aria-pressed={useCase === u}
                    className={`rounded-full px-3 py-1.5 text-[12px] ring-1 transition ${useCase === u ? 'bg-brand/10 text-ink ring-brand/40' : 'text-ink-2 ring-line/10 hover:bg-surface-2'}`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-[13px] text-red-300">{error}</p>}
            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[14px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join the list'}
            </button>
            <p className="text-center text-[12px] text-ink-3">
              We&apos;ll only email you about access. See our <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-2">Privacy Policy</Link>.
            </p>
          </form>
        </>
      )}
    </PublicShell>
  );
}
