'use client';

import { useDialog } from '@/components/ui/dialog';
import React, { useEffect, useState } from 'react';
import { Bot, Trash2, KeyRound, ExternalLink } from 'lucide-react';
import { CopyText, Step } from '@/components/guide/Steps';
import { BRAND_NAME } from '@/lib/brand';

/**
 * Lets people who already pay for Claude / ChatGPT / Gemini plug those assistants into
 * Arcwork over MCP, so the assistant hands heavy work to Arcwork's free agents and reviews
 * the result. Written as a plain, numbered guide per assistant: Claude signs in with OAuth
 * (no key at all); the others need a personal key, created inline at the step that uses it.
 */

interface Token {
  id: string;
  name: string;
  hint: string;
  lastUsedAt: string | null;
}

type Client = 'claude-app' | 'claude-code' | 'codex' | 'antigravity' | 'cursor';

const CLIENTS: { id: Client; label: string; hint?: string }[] = [
  { id: 'claude-app', label: 'Claude app', hint: 'Recommended' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'ChatGPT Codex' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'cursor', label: 'Cursor & others' },
];

const TRY_PROMPT = `Use ${BRAND_NAME} to build a simple landing page for my project, then review what it made and send feedback.`;

export function AgentClientsCard() {
  const dialog = useDialog();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [client, setClient] = useState<Client>('claude-app');
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/api/mcp`;

  async function load() {
    const r = await fetch('/api/v1/access-tokens').then((res) => (res.ok ? res.json() : { tokens: [] })).catch(() => ({ tokens: [] }));
    setTokens(r.tokens || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function createKey() {
    setBusy(true);
    try {
      const name = CLIENTS.find((c) => c.id === client)?.label || 'Assistant';
      const r = await fetch('/api/v1/access-tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then((res) => res.json());
      if (r.token) setFresh(r.token);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!(await dialog.confirm({ title: 'Remove this key?', body: `Any assistant using it will lose access to ${BRAND_NAME}.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    await fetch(`/api/v1/access-tokens/${id}`, { method: 'DELETE' });
    load();
  }

  const key = fresh || 'YOUR_KEY';

  /** Shared "make a key" step for assistants that can't sign in on their own. */
  const keyStep = (n: number) => (
    <Step n={n} title={fresh ? 'Your personal key is ready. It is already filled in below.' : 'Create your personal key'}>
      {fresh ? (
        <p className="mt-1 text-[11px] text-ink-3">It is shown only this once, so finish the next step now. You can remove it any time below.</p>
      ) : (
        <button onClick={createKey} disabled={busy} className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-50">
          <KeyRound className="h-3.5 w-3.5" /> Create my key
        </button>
      )}
    </Step>
  );

  const tryStep = (n: number, where: string) => (
    <Step n={n} title={`Try it. In ${where}, ask:`}>
      <CopyText value={TRY_PROMPT} mono={false} />
    </Step>
  );

  return (
    <div id="assistants" className="space-y-5 rounded-2xl border border-line/[0.08] bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line/10 bg-line/5"><Bot className="h-5 w-5 text-brand" /></div>
        <div>
          <p className="text-sm font-semibold text-ink">Use the AI plan you already pay for</p>
          <p className="mt-0.5 text-[12px] text-ink-2">
            Connect Claude, ChatGPT or Gemini to {BRAND_NAME}. Your assistant hands the heavy work (coding, email, images, video) to {BRAND_NAME}&apos;s free
            agents and checks the result, so your plan&apos;s limits last much longer. It takes about a minute.{' '}
            <a href="/guide" className="text-ink underline underline-offset-2 hover:text-brand">See the full walkthrough</a>
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] text-ink-3">Which assistant do you use?</p>
        <div className="flex flex-wrap gap-1.5">
          {CLIENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => setClient(c.id)}
              aria-pressed={client === c.id}
              className={`rounded-full px-3 py-1.5 text-[12px] ring-1 transition ${client === c.id ? 'bg-brand/10 text-ink ring-brand/40' : 'text-ink-2 ring-line/10 hover:bg-surface-2'}`}
            >
              {c.label}
              {c.hint && <span className="ml-1.5 text-[10px] text-brand">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>

      <ol className="space-y-4">
        {client === 'claude-app' && (
          <>
            <Step n={1} title="Open Claude's connector settings">
              <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft">
                Open Claude settings <ExternalLink className="h-3 w-3" />
              </a>
              <p className="mt-1.5 text-[11px] text-ink-3">In the Claude desktop app: Settings → Connectors.</p>
            </Step>
            <Step n={2} title={<>Click <b>Add custom connector</b> and fill in:</>}>
              <CopyText label="Name" value={BRAND_NAME} />
              <CopyText label="URL" value={url} />
            </Step>
            <Step n={3} title={<>Click <b>Add</b>, then <b>Connect</b>. Approve the {BRAND_NAME} sign-in window that opens.</>}>
              <p className="mt-1 text-[11px] text-ink-3">No key needed. It works in Claude chats, Cowork, and in Claude Code when you&apos;re signed in to the same Claude account.</p>
            </Step>
            {tryStep(4, 'any Claude chat')}
          </>
        )}

        {client === 'claude-code' && (
          <>
            <Step n={1} title={<>Open your <b>Terminal</b> and paste this, then press Enter:</>}>
              <CopyText value={`claude mcp add --transport http arcwork ${url} --scope user`} />
            </Step>
            <Step n={2} title={<>Start Claude Code, type <b>/mcp</b>, pick <b>arcwork</b> and choose <b>Authenticate</b>.</>}>
              <p className="mt-1 text-[11px] text-ink-3">Your browser opens a {BRAND_NAME} sign-in. Approve it and you&apos;re done. No key needed.</p>
            </Step>
            {tryStep(3, 'Claude Code')}
          </>
        )}

        {client === 'codex' && (
          <>
            {keyStep(1)}
            <Step n={2} title={<>Open your <b>Terminal</b> and paste this, then press Enter:</>}>
              <CopyText
                value={`mkdir -p ~/.codex && cat >> ~/.codex/config.toml <<'EOF'\n\n[mcp_servers.arcwork]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${key}" }\ntool_timeout_sec = 120\nEOF`}
              />
              <p className="mt-1 text-[11px] text-ink-3">This adds {BRAND_NAME} to Codex&apos;s settings file. Restart Codex afterwards.</p>
            </Step>
            {tryStep(3, 'Codex')}
          </>
        )}

        {client === 'antigravity' && (
          <>
            {keyStep(1)}
            <Step n={2} title={<>In Antigravity open <b>⋯ → MCP Servers → Manage → View raw config</b> and add this inside <code className="shz-mono">mcpServers</code>:</>}>
              <CopyText value={`"arcwork": {\n  "serverUrl": "${url}",\n  "headers": { "Authorization": "Bearer ${key}" }\n}`} />
            </Step>
            <Step n={3} title="Save and restart Antigravity." />
            {tryStep(4, 'Antigravity')}
          </>
        )}

        {client === 'cursor' && (
          <>
            {keyStep(1)}
            <Step n={2} title={<>In Cursor open <b>Settings → MCP → Add new MCP server</b> and paste this into the file that opens:</>}>
              <CopyText value={JSON.stringify({ mcpServers: { arcwork: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
              <p className="mt-1 text-[11px] text-ink-3">Windsurf: use &quot;serverUrl&quot; instead of &quot;url&quot;. VS Code: put it in .vscode/mcp.json under &quot;servers&quot; with &quot;type&quot;: &quot;http&quot;.</p>
            </Step>
            {tryStep(3, 'the chat')}
          </>
        )}
      </ol>

      {tokens.length > 0 && (
        <details className="rounded-xl border border-line/[0.06] px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-ink-2">Personal keys you&apos;ve created ({tokens.length})</summary>
          <div className="mt-2 space-y-1.5">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs">
                <span className="text-ink-2">
                  {t.name} <span className="shz-mono text-ink-3">{t.hint}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-ink-3">{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleString()}` : 'never used'}</span>
                  <button onClick={() => revoke(t.id)} aria-label={`Remove ${t.name} key`} className="text-ink-3 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
