'use client';

import React, { useEffect, useState } from 'react';
import { Check, Monitor, Sparkles, Zap } from 'lucide-react';
import { useDialog } from '@/components/ui/dialog';
import { KeySetupModal } from '@/components/connections/KeySetupModal';
import { KEY_PROVIDERS, type KeyProvider } from '@/lib/providers/key-setup';

/**
 * Models in plain language: what works with no setup, which free keys add headroom, and
 * which paid keys are optional. Keys are added through the guided KeySetupModal (key page
 * in a popup, auto-save on paste, one-click OAuth for OpenRouter) and checked before saving.
 */

const PROVIDERS: KeyProvider[] = KEY_PROVIDERS;

const INCLUDED = ['Qwen3 Coder', 'Kimi K2', 'GLM 4.6', 'gpt-oss-120b', 'FLUX.2 klein (images)'];

function ProviderRow({ p, connected, hint, onChange }: { p: KeyProvider; connected: boolean; hint?: string; onChange: () => void }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);

  async function remove() {
    if (!(await dialog.confirm({ title: `Remove your ${p.name} key?`, body: 'Agents will stop using it. You can add it again anytime.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const r = await fetch(`/api/v1/credentials/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) await dialog.alert({ title: `Could not remove your ${p.name} key`, body: 'Please try again.' });
    onChange();
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            {p.name}
            {p.recommended && !connected && <span className="ml-2 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">Recommended</span>}
            {connected && <span className="shz-mono ml-2 text-[11px] font-normal text-ink-3">{hint}</span>}
          </p>
          <p className="truncate text-[12px] text-ink-3">{p.unlocks}</p>
        </div>
        {connected ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[12px] text-brand-soft"><Check className="h-3.5 w-3.5" /> Connected</span>
            <button onClick={remove} className="rounded-lg px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink">Remove</button>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">
            {p.oneClick ? <><Zap className="h-3.5 w-3.5" /> One click</> : 'Add key'}
          </button>
        )}
      </div>
      {open && (
        <KeySetupModal
          providerId={p.id}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

export function ModelsCard() {
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [local, setLocal] = useState<{ device: string; models: string[] } | null>(null);

  async function load() {
    const [c, d] = await Promise.all([
      fetch('/api/v1/credentials').then((r) => (r.ok ? r.json() : { credentials: [] })).catch(() => ({ credentials: [] })),
      fetch('/api/v1/bridge/devices').then((r) => (r.ok ? r.json() : { devices: [] })).catch(() => ({ devices: [] })),
    ]);
    setCreds(Object.fromEntries((c.credentials || []).filter((x: any) => x.status === 'valid').map((x: any) => [x.providerId, x.keyMask])));
    const desk = (d.devices || []).find((x: any) => x.kind === 'desktop' && x.online);
    setLocal(desk ? { device: desk.name, models: (desk.capabilities.localModels || []).map((m: any) => m.id) } : null);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink"><Sparkles className="h-4 w-4 text-brand" /> Included free. Nothing to set up.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {INCLUDED.map((m) => (
            <span key={m} className="shz-mono rounded-full border border-line/10 px-2.5 py-0.5 text-[11px] text-ink-2">{m}</span>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Arcwork picks the best one for each task and switches automatically when a free limit is hit.</p>
      </div>

      <section>
        <h3 className="text-[13px] font-medium text-ink">Add free keys for more headroom</h3>
        <p className="text-[12px] text-ink-3">Each takes about a minute, with no card. Your keys are used first.</p>
        <div className="mt-1 divide-y divide-line/[0.06]">
          {PROVIDERS.filter((p) => p.free).map((p) => (
            <ProviderRow key={p.id} p={p} connected={Boolean(creds[p.id])} hint={creds[p.id]} onChange={load} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink"><Monitor className="h-4 w-4 text-ink-3" /> Models on your computer</h3>
        {local ? (
          local.models.length ? (
            <p className="mt-1 text-[12px] text-ink-2">On {local.device}: <span className="shz-mono">{local.models.join(', ')}</span>. Pick “Local model” in any composer.</p>
          ) : (
            <p className="mt-1 text-[12px] text-ink-3">{local.device} is connected. Install Ollama or LM Studio and pull a model (e.g. <span className="shz-mono">ollama pull qwen3.8:27b</span>) to use it free and private.</p>
          )
        ) : (
          <p className="mt-1 text-[12px] text-ink-3">Connect the desktop app (Devices below), then run Ollama or LM Studio, to use free, private local models.</p>
        )}
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-ink">Your paid keys <span className="font-normal text-ink-3">(optional)</span></h3>
        <div className="mt-1 divide-y divide-line/[0.06]">
          {PROVIDERS.filter((p) => !p.free).map((p) => (
            <ProviderRow key={p.id} p={p} connected={Boolean(creds[p.id])} hint={creds[p.id]} onChange={load} />
          ))}
        </div>
      </section>
    </div>
  );
}
