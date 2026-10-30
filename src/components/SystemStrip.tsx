'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Shazam's signature: a live, monospace readout of what is actually online for you:
 * free models, cloud sandbox, your computer, your browser, Gmail, MCP servers.
 */

interface Status {
  freeModels: number;
  sandbox: boolean;
  desktopOnline: boolean;
  browserOnline: boolean;
  googleConnected: boolean;
  mcpServers: string[];
  hasOwnKey: boolean;
}

function Chip({ on, label, href }: { on: boolean; label: string; href?: string }) {
  const body = (
    <span className={`shz-mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${on ? 'border-brand/25 bg-brand/[0.06] text-ink-2' : 'border-line/[0.08] text-ink-3 hover:border-line/20 hover:text-ink-2'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-brand shz-live' : 'bg-ink-3/50'}`} />
      {label}
    </span>
  );
  return href && !on ? <Link href={href}>{body}</Link> : body;
}

export function SystemStrip({ show = ['models', 'sandbox', 'desktop', 'browser', 'google', 'mcp'] }: { show?: Array<'models' | 'sandbox' | 'desktop' | 'browser' | 'google' | 'mcp'> }) {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    fetch('/api/v1/status').then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => {});
  }, []);
  if (!s) return <div className="h-7" />;
  const chips: Record<string, React.ReactNode> = {
    models: <Chip key="m" on={s.freeModels > 0 || s.hasOwnKey} label={`${s.freeModels} free models${s.hasOwnKey ? ' + your keys' : ''}`} href="/models" />,
    sandbox: <Chip key="s" on={s.sandbox} label="cloud sandbox" />,
    desktop: <Chip key="d" on={s.desktopOnline} label={s.desktopOnline ? 'your computer' : 'connect computer'} href="/connections#devices" />,
    browser: <Chip key="b" on={s.browserOnline} label={s.browserOnline ? 'your browser' : 'connect browser'} href="/connections#devices" />,
    google: <Chip key="g" on={s.googleConnected} label={s.googleConnected ? 'gmail · calendar' : 'connect gmail'} href="/connections" />,
    mcp: <Chip key="p" on={s.mcpServers.length > 0} label={s.mcpServers.length ? `${s.mcpServers.length} mcp` : 'add mcp'} href="/settings?tab=mcp" />,
  };
  return <div className="flex flex-wrap items-center justify-center gap-1.5">{show.map((k) => chips[k])}</div>;
}
