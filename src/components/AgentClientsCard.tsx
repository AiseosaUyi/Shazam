'use client';

import React, { useEffect, useState } from 'react';
import { Bot, Copy, Check, Trash2, KeyRound } from 'lucide-react';

/**
 * Lets people who already pay for Claude / ChatGPT / Gemini plug those assistants into
 * Shazam over MCP, so the assistant delegates heavy work to Shazam's free agents and
 * reviews the result, stretching the subscription further.
 */

interface Token {
  id: string;
  name: string;
  hint: string;
  lastUsedAt: string | null;
}

type Client = 'claude-code' | 'codex' | 'antigravity' | 'cursor' | 'claude-ai';

function snippets(url: string, token: string): Record<Client, { title: string; body: string; note: string }> {
  return {
    'claude-code': {
      title: 'Claude Code (uses your Claude subscription)',
      body: `claude mcp add --transport http shazam ${url} \\\n  --header "Authorization: Bearer ${token}" --scope user`,
      note: 'Then ask Claude: "Use Shazam to build X, then review the result and send feedback." Works in the terminal, VS Code and JetBrains.',
    },
    codex: {
      title: 'OpenAI Codex (CLI & IDE) — ~/.codex/config.toml',
      body: `[mcp_servers.shazam]\nurl = "${url}"\nbearer_token_env_var = "SHAZAM_TOKEN"\ntool_timeout_sec = 120\n\n# then in your shell profile:\n# export SHAZAM_TOKEN="${token}"`,
      note: 'Codex tool calls time out after 60s by default; Shazam tasks are async (start → poll), so 120s is plenty.',
    },
    antigravity: {
      title: 'Google Antigravity — ~/.gemini/config/mcp_config.json',
      body: JSON.stringify({ mcpServers: { shazam: { serverUrl: url, headers: { Authorization: `Bearer ${token}` }, timeoutSeconds: 120 } } }, null, 2),
      note: 'Restart Antigravity after saving.',
    },
    cursor: {
      title: 'Cursor / Windsurf / VS Code',
      body: JSON.stringify({ mcpServers: { shazam: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
      note: 'Cursor: ~/.cursor/mcp.json · Windsurf uses "serverUrl" · VS Code: .vscode/mcp.json with {"servers":{"shazam":{"type":"http",…}}}.',
    },
    'claude-ai': {
      title: 'Claude.ai & Claude Desktop (custom connector)',
      body: `Settings → Connectors → Add custom connector\nName: Shazam\nURL: ${url}`,
      note: 'Claude will open a Shazam sign-in window to authorize the connector (OAuth). No token needed here.',
    },
  };
}

export function AgentClientsCard() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<{ token: string; mcpUrl: string } | null>(null);
  const [client, setClient] = useState<Client>('claude-code');
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const mcpUrl = fresh?.mcpUrl || `${origin}/api/mcp`;

  async function load() {
    const r = await fetch('/api/v1/access-tokens').then((res) => (res.ok ? res.json() : { tokens: [] })).catch(() => ({ tokens: [] }));
    setTokens(r.tokens || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    const label = client === 'codex' ? 'Codex' : client === 'antigravity' ? 'Antigravity' : client === 'cursor' ? 'Cursor' : 'Claude Code';
    const r = await fetch('/api/v1/access-tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label }) }).then((res) => res.json());
    setFresh({ token: r.token, mcpUrl: r.mcpUrl });
    setCopied(false);
    load();
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this token? Any assistant using it will lose access.')) return;
    await fetch(`/api/v1/access-tokens/${id}`, { method: 'DELETE' });
    load();
  }

  const sn = snippets(mcpUrl, fresh?.token || 'shz_pat_…create a token first…')[client];

  return (
    <div id="assistants" className="p-5 rounded-2xl bg-[#0f1118] border border-white/[0.08] space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0"><Bot className="w-5 h-5 text-amber-400" /></div>
        <div>
          <p className="text-sm font-semibold text-white">Connect Claude, Codex & Antigravity</p>
          <p className="text-xs text-zinc-400">
            Already pay for Claude or ChatGPT? Let your assistant hand the heavy work (coding, emails, images, video) to Shazam&apos;s free agents, then review and send feedback. Your subscription lasts much longer.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['claude-code', 'claude-ai', 'codex', 'antigravity', 'cursor'] as Client[]).map((c) => (
          <button key={c} onClick={() => setClient(c)} className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${client === c ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/5'}`}>
            {c === 'claude-code' ? 'Claude Code' : c === 'claude-ai' ? 'Claude.ai / Desktop' : c === 'codex' ? 'Codex' : c === 'antigravity' ? 'Antigravity' : 'Cursor & others'}
          </button>
        ))}
      </div>

      {client !== 'claude-ai' && !fresh && (
        <button onClick={create} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" /> Create access token
        </button>
      )}
      {fresh && <p className="text-[11px] text-amber-300">Copy this now — the token is shown only once.</p>}

      <div className="rounded-xl border border-white/[0.06] bg-black/40">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
          <span className="text-[11px] text-zinc-300">{sn.title}</span>
          <button onClick={() => { navigator.clipboard.writeText(sn.body); setCopied(true); }} className="text-zinc-400 hover:text-white">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
        </div>
        <pre className="px-3 py-2.5 text-[11px] text-zinc-200 overflow-x-auto whitespace-pre-wrap break-all">{sn.body}</pre>
      </div>
      <p className="text-[11px] text-zinc-500">{sn.note}</p>
      <p className="text-[11px] text-zinc-500">Tools your assistant gets: suggest_agent, start_task, get_task_status, send_feedback, list/read project files, generate_image, list_pending_approvals, decide_approval.</p>

      {tokens.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Active tokens</p>
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">{t.name} <span className="text-zinc-500 font-mono">{t.hint}</span></span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500">{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleString()}` : 'never used'}</span>
                <button onClick={() => revoke(t.id)} className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
