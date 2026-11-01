'use client';

import { useDialog } from '@/components/ui/dialog';
import { CopyText, Step } from '@/components/guide/Steps';
import React, { useEffect, useState } from 'react';
import { Monitor, Chrome, Trash2 } from 'lucide-react';

interface Device {
  id: string;
  kind: 'desktop' | 'browser';
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  capabilities: { workspaces?: string[] };
}

export function DevicesCard() {
  const dialog = useDialog();
  const [devices, setDevices] = useState<Device[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: string; server: string } | null>(null);

  async function load() {
    const d = await fetch('/api/v1/bridge/devices').then((r) => (r.ok ? r.json() : { devices: [] })).catch(() => ({ devices: [] }));
    setDevices(d.devices || []);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function newCode() {
    const r = await fetch('/api/v1/bridge/pair', { method: 'POST' }).then((res) => res.json());
    setCode(r);
  }

  async function revoke(id: string) {
    if (!(await dialog.confirm({ title: 'Disconnect this device?', body: 'It stops working until you pair it again.', confirmLabel: 'Disconnect', tone: 'danger' }))) return;
    await fetch(`/api/v1/bridge/devices/${id}`, { method: 'DELETE' });
    load();
  }

  const desktop = devices.filter((d) => d.kind === 'desktop');
  const browsers = devices.filter((d) => d.kind === 'browser');

  return (
    <div id="devices" className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">Your devices</p>
        <p className="text-xs text-ink-2">
          Let agents work on your computer (local folders, git push with your credentials, local LLMs) and in your real browser. Devices connect out to Arcwork; nothing is exposed to the internet.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={newCode} className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-soft text-brand-ink text-xs font-semibold">Get pairing code</button>
        <a href="https://github.com/AiseosaUyi/Shazam/tree/main/extensions/chrome" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink">Chrome extension</a>
        <a href="/guide#computer" className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink">How it works</a>
      </div>

      {code && (
        <div className="rounded-xl border border-brand/30 bg-brand/[0.05] p-3">
          <p className="text-[12px] text-ink">Your pairing code: <span className="font-mono text-base tracking-[0.2em] text-brand-soft">{code.code}</span> <span className="text-[11px] text-ink-3">(valid 10 minutes)</span></p>
          <p className="mt-2 text-[12px] text-ink-2">Open a terminal on your computer (in Cursor or VS Code: Terminal → New Terminal) and paste these one at a time:</p>
          <ol className="mt-1 space-y-2">
            <Step n={1} title="Download the connector (needs Node 18+)"><CopyText value={`curl -fsSL ${code.server}/arcwork-bridge.js -o ~/.arcwork-bridge.js`} /></Step>
            <Step n={2} title="Pair this computer"><CopyText value={`node ~/.arcwork-bridge.js pair ${code.code}`} /></Step>
            <Step n={3} title="Allow your projects folder. Agents can only work inside folders you allow."><CopyText value="node ~/.arcwork-bridge.js allow ~/Projects" /></Step>
            <Step n={4} title="Start it, and keep this terminal open while agents work"><CopyText value="node ~/.arcwork-bridge.js start" /></Step>
          </ol>
          <p className="mt-2 text-[11px] text-ink-3">In step 3, replace ~/Projects with the folder your projects are in (for example ~/Desktop/Development). Run it again to allow more folders. Risky commands always ask you in that terminal first.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {[{ title: 'Desktop app', icon: <Monitor className="w-4 h-4" />, list: desktop }, { title: 'Browser extension', icon: <Chrome className="w-4 h-4" />, list: browsers }].map((g) => (
          <div key={g.title} className="rounded-xl border border-line/[0.06] bg-line/[0.02] p-3 space-y-2">
            <p className="text-xs font-semibold text-ink flex items-center gap-2">{g.icon}{g.title}</p>
            {g.list.length === 0 && <p className="text-[11px] text-ink-3">Not connected.</p>}
            {g.list.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="text-ink truncate"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${d.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />{d.name}</p>
                  {d.kind === 'desktop' && <p className="text-[10px] text-ink-3 truncate">{(d.capabilities.workspaces || []).join(', ') || 'no folders allowed yet'}</p>}
                </div>
                <button onClick={() => revoke(d.id)} className="p-1 text-ink-3 hover:text-red-400" title="Disconnect"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        ))}
      </div>

    </div>
  );
}
