'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cpu, Plug, Monitor, Bot } from 'lucide-react';
import { ModelsCard } from '@/components/connections/ModelsCard';
import { McpServersCard } from '@/components/connections/McpServersCard';
import { GithubCard } from '@/components/connections/GithubCard';
import { GoogleConnectCard } from '@/components/GoogleConnectCard';
import { DevicesCard } from '@/components/DevicesCard';
import { LocalAICard } from '@/components/LocalAICard';
import { AgentClientsCard } from '@/components/AgentClientsCard';
import { SystemStrip } from '@/components/SystemStrip';
import { AgentRunsList } from '@/components/AgentRunsList';
import { DirectorCard, ApprovalModeCard } from '@/components/DirectorCard';

/**
 * One place for everything Arcwork can use: models, apps, your devices, and the assistants
 * you already pay for. Replaces the separate Models and API-key pages.
 */

const SECTIONS = [
  { id: 'models', label: 'Models', icon: Cpu, blurb: 'What thinks for you' },
  { id: 'apps', label: 'Apps', icon: Plug, blurb: 'What it can act on' },
  { id: 'devices', label: 'Devices', icon: Monitor, blurb: 'Your computer & browser' },
  { id: 'assistants', label: 'Assistants', icon: Bot, blurb: 'Claude, Codex, Antigravity' },
] as const;

export default function ConnectionsPage() {
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [active, setActive] = useState<string>('models');

  useEffect(() => {
    fetch('/api/v1/auth/me').then((r) => (r.ok ? r.json() : { user: null })).then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  // Deep links (e.g. /connections#devices) arrive before the cards render; scroll once they exist.
  useEffect(() => {
    if (!user) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return () => clearTimeout(t);
  }, [user]);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [user]);

  if (user === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-ink">Sign in to connect things</h1>
          <p className="mt-1 text-[13px] text-ink-3">Your keys, apps and devices are tied to your account and stored encrypted.</p>
          <Link href="/login?next=/connections" className="mt-4 inline-block rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto flex max-w-5xl gap-10 px-4 pb-24 pt-10 sm:px-8">
        <nav className="sticky top-6 hidden h-fit w-48 shrink-0 md:block" aria-label="Sections">
          <p className="mb-3 px-3 text-[11px] font-medium text-ink-3">Connections</p>
          {SECTIONS.map(({ id, label, icon: Icon, blurb }) => (
            <a key={id} href={`#${id}`} className={`flex items-start gap-2.5 rounded-xl px-3 py-2 transition ${active === id ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <Icon className={`mt-0.5 h-4 w-4 ${active === id ? 'text-brand' : ''}`} />
              <span>
                <span className="block text-[13px]">{label}</span>
                <span className="block text-[11px] text-ink-3">{blurb}</span>
              </span>
            </a>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-14">
          <header>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Connections</h1>
            <p className="mt-1 text-[13px] text-ink-3">Everything Arcwork can use, and what&apos;s live right now.</p>
            <div className="mt-4 flex justify-start"><SystemStrip /></div>
          </header>

          <section id="models" className="scroll-mt-8 space-y-4">
            <h2 className="text-[15px] font-semibold text-ink">Models</h2>
            <ModelsCard />
          </section>

          <section id="apps" className="scroll-mt-8 space-y-3">
            <h2 className="text-[15px] font-semibold text-ink">Apps</h2>
            <GoogleConnectCard />
            <GithubCard />
            <McpServersCard />
          </section>

          <section id="devices" className="scroll-mt-8 space-y-3">
            <h2 className="text-[15px] font-semibold text-ink">Devices</h2>
            <DevicesCard />
            <LocalAICard />
          </section>

          <section id="assistants" className="scroll-mt-8 space-y-3">
            <h2 className="text-[15px] font-semibold text-ink">Assistants you already pay for</h2>
            <DirectorCard />
            <ApprovalModeCard />
            <AgentClientsCard />
            <AgentRunsList source="mcp" title="Recent tasks from your assistants" blurb="Work Claude, Codex or Antigravity handed to Arcwork. Open one to watch it live." />
          </section>
        </div>
      </div>
    </div>
  );
}
