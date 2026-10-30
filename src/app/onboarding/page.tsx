'use client';

import React from 'react';
import Link from 'next/link';
import { Mail, Monitor, Bot, ArrowRight } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { SystemStrip } from '@/components/SystemStrip';

/** First run: you're ready now; connections are optional extras, not a gate. */
const EXTRAS = [
  { href: '/connections#apps', icon: Mail, title: 'Connect Gmail & Calendar', body: 'So Co-Work can read, send and schedule email.' },
  { href: '/connections#devices', icon: Monitor, title: 'Connect your computer', body: 'Work in your own folders, run code locally, use local models.' },
  { href: '/connections#assistants', icon: Bot, title: 'Connect Claude, Codex or Antigravity', body: 'Let the plan you already pay for hand heavy work to Shazam.' },
];

export default function OnboardingPage() {
  return (
    <div className="shz-atmosphere flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="flex justify-center">
          <LogoMark size={44} />
        </div>
        <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.025em] text-ink">You&apos;re ready.</h1>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2">
          Shazam already has free models for coding, email and images. Nothing to set up. Free tiers have daily limits, and Shazam switches models when one runs out.
        </p>
        <div className="mt-5">
          <SystemStrip show={['models', 'sandbox']} />
        </div>

        <Link href="/" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-brand-ink hover:bg-brand-soft">
          Start <ArrowRight className="h-4 w-4" />
        </Link>

        <div className="mt-10 space-y-2 text-left">
          <p className="px-1 text-[12px] text-ink-3">Optional, whenever you like</p>
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
    </div>
  );
}
