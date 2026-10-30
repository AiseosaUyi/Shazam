'use client';

import React, { useEffect, useState } from 'react';
import { Monitor, Chrome, Github, Loader2, Trash2, Copy, Check } from 'lucide-react';

interface Device {
  id: string;
  kind: 'desktop' | 'browser';
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  capabilities: { workspaces?: string[] };
}

export function DevicesCard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: string; server: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [github, setGithub] = useState<{ connected: boolean; hint?: string }>({ connected: false });
  const [ghToken, setGhToken] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);

  async function load() {
    const [d, c] = await Promise.all([
      fetch('/api/v1/bridge/devices').then((r) => (r.ok ? r.json() : { devices: [] })).catch(() => ({ devices: [] })),
      fetch('/api/v1/credentials').then((r) => (r.ok ? r.json() : { credentials: [] })).catch(() => ({ credentials: [] })),
    ]);
    setDevices(d.devices || []);
    const gh = (c.credentials || []).find((x: any) => x.providerId === 'github');
    setGithub({ connected: Boolean(gh), hint: gh?.keyMask });
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function newCode() {
    const r = await fetch('/api/v1/bridge/pair', { method: 'POST' }).then((res) => res.json());
    setCode(r);
    setCopied(false);
  }

  async function revoke(id: string) {
    if (!confirm('Disconnect this device? It will stop working until paired again.')) return;
    await fetch(`/api/v1/bridge/devices/${id}`, { method: 'DELETE' });
    load();
  }

  async function saveGithub() {
    setGhBusy(true);
    setGhError(null);
    // Validate the token against GitHub before saving it.
    const check = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${ghToken.trim()}` } }).catch(() => null);
    if (!check || !check.ok) {
      setGhBusy(false);
      return setGhError('GitHub rejected this token. Create a fine-grained token with Contents + Pull requests (read & write).');
    }
    await fetch('/api/v1/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: 'github', apiKey: ghToken.trim() }) });
    setGhToken('');
    setGhBusy(false);
    load();
  }

  const desktop = devices.filter((d) => d.kind === 'desktop');
  const browsers = devices.filter((d) => d.kind === 'browser');

  return (
    <div id="devices" className="p-5 rounded-2xl bg-[#0f1118] border border-white/[0.08] space-y-4">
      <div>
        <p className="text-sm font-semibold text-white">Your devices</p>
        <p className="text-xs text-zinc-400">
          Let agents work on your computer (local folders, git push with your credentials, local LLMs) and in your real browser. Devices connect out to Shazam; nothing is exposed to the internet.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={newCode} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold">Get pairing code</button>
        <a href="https://github.com/AiseosaUyi/Shazam/tree/main/extensions/chrome" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200">Chrome extension</a>
        <a href="https://github.com/AiseosaUyi/Shazam/releases" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200">Desktop app</a>
        <code className="text-[11px] text-zinc-400">npx shazam-bridge pair CODE</code>
      </div>

      {code && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3 flex items-center gap-3">
          <span className="font-mono text-xl tracking-[0.25em] text-amber-300">{code.code}</span>
          <button onClick={() => { navigator.clipboard.writeText(code.code); setCopied(true); }} className="p-1.5 rounded-md hover:bg-white/5 text-zinc-300">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
          <span className="text-[11px] text-zinc-400">Enter it in the desktop app or extension within 10 minutes. Server: {code.server}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {[{ title: 'Desktop app', icon: <Monitor className="w-4 h-4" />, list: desktop }, { title: 'Browser extension', icon: <Chrome className="w-4 h-4" />, list: browsers }].map((g) => (
          <div key={g.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-200 flex items-center gap-2">{g.icon}{g.title}</p>
            {g.list.length === 0 && <p className="text-[11px] text-zinc-500">Not connected.</p>}
            {g.list.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="text-zinc-200 truncate"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${d.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />{d.name}</p>
                  {d.kind === 'desktop' && <p className="text-[10px] text-zinc-500 truncate">{(d.capabilities.workspaces || []).join(', ') || 'no folders allowed yet'}</p>}
                </div>
                <button onClick={() => revoke(d.id)} className="p-1 text-zinc-500 hover:text-red-400" title="Disconnect"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-200 flex items-center gap-2"><Github className="w-4 h-4" />GitHub (push & PRs from the cloud)</p>
        {github.connected ? (
          <p className="text-[11px] text-emerald-300">Connected ({github.hint}). The Code agent can push branches and open pull requests.</p>
        ) : (
          <div className="flex gap-2">
            <input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="Fine-grained token (Contents + Pull requests: read & write)" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200" />
            <button disabled={!ghToken || ghBusy} onClick={saveGithub} className="px-3 py-1.5 rounded-lg bg-amber-500 disabled:opacity-40 text-zinc-950 text-xs font-semibold">{ghBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}</button>
          </div>
        )}
        {ghError && <p className="text-[11px] text-red-300">{ghError}</p>}
      </div>
    </div>
  );
}
