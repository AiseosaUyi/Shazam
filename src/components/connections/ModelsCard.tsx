'use client';

import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, Monitor, Sparkles } from 'lucide-react';
import { useDialog } from '@/components/ui/dialog';

/**
 * Models in plain language: what works with no setup, which free keys add headroom, and
 * which paid keys are optional. Keys are added inline (no modal) and checked before saving.
 */

interface Provider {
  id: string;
  name: string;
  unlocks: string;
  note?: string;
  keyUrl: string;
  free: boolean;
}

const PROVIDERS: Provider[] = [
  { id: 'google', name: 'Google AI Studio', unlocks: 'Gemini 3.8 Flash, 3.5 Flash Lite, plus Nano Banana images with billing', note: 'Free key. Google may use free-tier requests to improve its models.', keyUrl: 'https://aistudio.google.com/app/apikey', free: true },
  { id: 'groq', name: 'Groq', unlocks: 'Qwen3.8 27B and gpt-oss at very high speed', note: 'Free key, tight per-minute limits.', keyUrl: 'https://console.groq.com/keys', free: true },
  { id: 'cerebras', name: 'Cerebras', unlocks: 'gpt-oss-120b, about 1M free tokens a day', keyUrl: 'https://cloud.cerebras.ai', free: true },
  { id: 'openrouter', name: 'OpenRouter', unlocks: 'Nemotron 3 Ultra and Gemma 4 (free models)', note: '50 free requests a day, 1,000 with $10 of credit.', keyUrl: 'https://openrouter.ai/keys', free: true },
  { id: 'anthropic', name: 'Anthropic', unlocks: 'Claude Opus, Sonnet and Haiku', keyUrl: 'https://console.anthropic.com/settings/keys', free: false },
  { id: 'openai', name: 'OpenAI', unlocks: 'GPT models and GPT Image', keyUrl: 'https://platform.openai.com/api-keys', free: false },
  { id: 'deepseek', name: 'DeepSeek', unlocks: 'DeepSeek chat and reasoning models', keyUrl: 'https://platform.deepseek.com/api_keys', free: false },
];

const INCLUDED = ['Qwen3 Coder', 'Kimi K2', 'GLM 4.6', 'gpt-oss-120b', 'FLUX.2 klein (images)'];

function ProviderRow({ p, connected, hint, onChange }: { p: Provider; connected: boolean; hint?: string; onChange: () => void }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await fetch('/api/v1/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: p.id, apiKey: key.trim() }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error || 'Could not save this key.');
    setKey('');
    setOpen(false);
    onChange();
  }

  async function remove() {
    if (!(await dialog.confirm({ title: `Remove your ${p.name} key?`, body: 'Agents will stop using it. You can add it again anytime.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const me = await fetch('/api/v1/auth/me').then((r) => r.json());
    await fetch(`/api/v1/credentials/${encodeURIComponent(`${me.user.id}:${p.id}`)}`, { method: 'DELETE' });
    onChange();
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            {p.name}
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
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">
            {open ? 'Cancel' : 'Add key'}
          </button>
        )}
      </div>
      {open && !connected && (
        <div className="mt-2.5 space-y-2 animate-shz-in">
          <div className="flex gap-2">
            <input
              autoFocus
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && save()}
              placeholder={`Paste your ${p.name} key`}
              className="shz-mono min-w-0 flex-1 rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none"
            />
            <button disabled={!key.trim() || busy} onClick={save} className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </button>
          </div>
          <p className="text-[11px] text-ink-3">
            <a href={p.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-2 underline-offset-2 hover:underline">
              Get a {p.free ? 'free ' : ''}key <ExternalLink className="h-3 w-3" />
            </a>
            {p.note ? ` · ${p.note}` : ''} We check the key before saving and store it encrypted.
          </p>
          {error && <p className="text-[12px] text-red-300">{error}</p>}
        </div>
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
        <p className="mt-2 text-[12px] text-ink-3">Shazam picks the best one for each task and switches automatically when a free limit is hit.</p>
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
