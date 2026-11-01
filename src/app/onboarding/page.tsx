'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, Monitor, Bot, ArrowRight, Check, Sparkles, Zap } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { SystemStrip } from '@/components/SystemStrip';
import { KeySetupModal } from '@/components/connections/KeySetupModal';
import { KEY_PROVIDERS } from '@/lib/providers/key-setup';

/**
 * First run. Arcwork works with zero setup on built-in free models; one free Gemini key (about a
 * minute, done without leaving Arcwork) gives much better quality and limits. Everything else is
 * optional and can be added later in Connections.
 */
const EXTRAS = [
  { href: '/connections#apps', icon: Mail, title: 'Connect Gmail & Calendar', body: 'So Co-Work can read, send and schedule email.' },
  { href: '/connections#devices', icon: Monitor, title: 'Connect your computer', body: 'Work in your own folders, run code locally, use local models.' },
  { href: '/guide', icon: Bot, title: 'Connect Claude, Codex or Antigravity', body: 'Let the plan you already pay for hand heavy work to Arcwork.' },
];

const GEMINI = KEY_PROVIDERS.find((p) => p.id === 'google')!;
const MORE_FREE = KEY_PROVIDERS.filter((p) => p.free && p.id !== 'google');

export default function OnboardingPage() {
  const [connected, setConnected] = useState<Record<string, string>>({});
  const [setup, setSetup] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch('/api/v1/credentials').then((r) => (r.ok ? r.json() : { credentials: [] })).catch(() => ({ credentials: [] }));
    setConnected(Object.fromEntries((d.credentials || []).filter((c: any) => c.status === 'valid').map((c: any) => [c.providerId, c.keyMask])));
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const geminiOn = Boolean(connected.google);
  const anyKey = Object.keys(connected).length > 0;

  return (
    <div className="shz-atmosphere flex h-full min-h-0 flex-1 justify-center overflow-y-auto px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <div className="flex justify-center">
            <LogoMark size={44} />
          </div>
          <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.025em] text-ink">Welcome to Arcwork</h1>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2">
            You can start right now on built-in free models. Add a free Gemini key for better answers and higher daily limits. It takes about a minute and you never leave this page.
          </p>
        </div>

        {/* Recommended: Gemini */}
        <div className={`mt-8 rounded-2xl border p-4 ${geminiOn ? 'border-brand/30 bg-brand/[0.04]' : 'border-brand/25 bg-surface ring-4 ring-brand/[0.04]'}`}>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold text-ink">{GEMINI.name}</p>
                <span className="rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">Recommended</span>
                <span className="text-[11px] text-ink-3">Free</span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-2">{GEMINI.unlocks}.</p>
            </div>
          </div>
          {geminiOn ? (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-brand-soft">
              <Check className="h-4 w-4" /> Connected <span className="shz-mono text-[11px] text-ink-3">{connected.google}</span>
            </p>
          ) : (
            <button onClick={() => setSetup('google')} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft">
              Add my free Gemini key <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* More free models */}
        <div className="mt-6">
          <p className="px-1 text-[12px] text-ink-3">More free models, optional</p>
          <div className="mt-2 divide-y divide-line/[0.06] rounded-2xl border border-line/[0.08] bg-surface/80">
            {MORE_FREE.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{p.name}</p>
                  <p className="truncate text-[12px] text-ink-3">{p.unlocks}</p>
                </div>
                {connected[p.id] ? (
                  <span className="flex items-center gap-1 text-[12px] text-brand-soft"><Check className="h-3.5 w-3.5" /> Connected</span>
                ) : (
                  <button onClick={() => setSetup(p.id)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">
                    {p.oneClick ? <><Zap className="h-3.5 w-3.5" /> One click</> : 'Add key'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-brand-ink hover:bg-brand-soft">
            {anyKey ? 'Start using Arcwork' : 'Start with built-in free models'} <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-2 text-[12px] text-ink-3">You can add or change any of this later in Connections.</p>
          <div className="mt-4 flex justify-center">
            <SystemStrip show={['models', 'sandbox']} />
          </div>
        </div>

        <div className="mt-10 space-y-2">
          <p className="px-1 text-[12px] text-ink-3">Later, when you need them</p>
          {EXTRAS.map(({ href, icon: Icon, title, body }) => (
            <Link key={href} href={href} className="flex items-center gap-3 rounded-2xl border border-line/[0.08] bg-surface/80 p-3.5 transition hover:border-brand/30 hover:bg-surface">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                <Icon className="h-4 w-4 text-ink-2" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{title}</p>
                <p className="text-[12px] text-ink-3">{body}</p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-3" />
            </Link>
          ))}
        </div>
      </div>

      {setup && (
        <KeySetupModal
          providerId={setup}
          onClose={() => setSetup(null)}
          onSaved={() => {
            setSetup(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
