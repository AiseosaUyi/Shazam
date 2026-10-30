'use client';

import React, { useEffect, useState } from 'react';
import { Network, Loader2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useDialog } from '@/components/ui/dialog';

/** MCP servers (your startup's own, Notion, Linear…): add inline, see the real tools. */

interface Server {
  id: string;
  name: string;
  url: string;
  status: string;
  tools: Array<{ name: string; description?: string }>;
}

export function McpServersCard() {
  const dialog = useDialog();
  const [servers, setServers] = useState<Server[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    const r = await fetch('/api/v1/mcp').then((res) => (res.ok ? res.json() : { servers: [] })).catch(() => ({ servers: [] }));
    setServers(r.servers || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await fetch('/api/v1/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), url: url.trim(), transport: 'http', authToken: token.trim() || undefined }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error || 'Could not connect.');
    setName('');
    setUrl('');
    setToken('');
    setAdding(false);
    load();
  }

  async function remove(s: Server) {
    if (!(await dialog.confirm({ title: `Remove ${s.name}?`, body: 'Agents will no longer see its tools.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await fetch(`/api/v1/mcp/${s.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="rounded-2xl border border-line/[0.08] bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2"><Network className="h-4 w-4 text-ink-2" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">MCP servers</p>
          <p className="text-[12px] text-ink-3">Your startup&apos;s tools, Notion, Linear, Supabase… Agents can use every tool a server exposes. Changes need your approval.</p>
        </div>
        {!adding && <button onClick={() => setAdding(true)} className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">Add server</button>}
      </div>

      {adding && (
        <div className="mt-3 space-y-2 animate-shz-in">
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Linear)" className="rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… /mcp" className="shz-mono rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none" />
          </div>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token (if the server needs one)" className="shz-mono w-full rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none" />
          <div className="flex items-center gap-2">
            <button disabled={!name.trim() || !url.trim() || busy} onClick={add} className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Connect'}
            </button>
            <button onClick={() => { setAdding(false); setError(null); }} className="rounded-xl px-3 py-2 text-[12px] text-ink-3 hover:text-ink">Cancel</button>
            <span className="text-[11px] text-ink-3">We connect right away and list its real tools.</span>
          </div>
          {error && <p className="text-[12px] text-red-300">{error}</p>}
        </div>
      )}

      {servers.length > 0 && (
        <div className="mt-3 divide-y divide-line/[0.06]">
          {servers.map((s) => (
            <div key={s.id} className="py-2.5">
              <div className="flex items-center gap-2">
                <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {expanded === s.id ? <ChevronDown className="h-3.5 w-3.5 text-ink-3" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-3" />}
                  <span className="text-[13px] text-ink">{s.name}</span>
                  <span className="shz-mono truncate text-[11px] text-ink-3">{s.tools.length} tools · {s.url.replace(/^https?:\/\//, '')}</span>
                </button>
                <button onClick={() => remove(s)} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-red-300" aria-label={`Remove ${s.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              {expanded === s.id && (
                <ul className="ml-6 mt-1.5 space-y-1">
                  {s.tools.map((t) => (
                    <li key={t.name} className="text-[12px] text-ink-3"><span className="shz-mono text-ink-2">{t.name}</span>{t.description ? ` · ${t.description.slice(0, 110)}` : ''}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
