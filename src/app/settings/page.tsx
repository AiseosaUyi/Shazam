'use client';

import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Save,
  CheckCircle2,
  Shield,
  Lock,
  AlertCircle,
  Network,
  Plus,
  Trash2,
  ExternalLink,
  RefreshCw,
  Terminal,
  Server,
  Check,
} from 'lucide-react';
import type { UserPreferences } from '@/lib/types';

interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: string;
  status: string;
  tools?: Array<{ name: string; description?: string }>;
  createdAt?: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'preferences' | 'mcp'>('preferences');
  const [pref, setPref] = useState<UserPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loadingMcp, setLoadingMcp] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'sse' | 'http' | 'websocket'>('sse');
  const [newMcpToken, setNewMcpToken] = useState('');
  const [addingMcp, setAddingMcp] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Please sign in to view and edit settings.');
        return res.json();
      })
      .then((json) => {
        if (json.preferences) setPref(json.preferences);
      })
      .catch((err) => setError(err.message));

    loadMcpServers();
  }, []);

  async function loadMcpServers() {
    setLoadingMcp(true);
    try {
      const res = await fetch('/api/v1/mcp');
      const data = await res.json();
      if (res.ok && data.servers) {
        setMcpServers(data.servers);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMcp(false);
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pref) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultCostPolicy: pref.defaultCostPolicy,
          maxCostPerTaskUSD: Number(pref.maxCostPerTaskUSD),
          monthlyBudgetUSD: Number(pref.monthlyBudgetUSD),
          privacyMode: pref.privacyMode,
          autoFallbackEnabled: pref.autoFallbackEnabled,
          allowPaidFallback: pref.allowPaidFallback,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save settings.');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  async function handleAddMcp(e: React.FormEvent) {
    e.preventDefault();
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;

    setAddingMcp(true);
    setMcpError(null);
    try {
      const res = await fetch('/api/v1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMcpName.trim(),
          url: newMcpUrl.trim(),
          transport: newMcpTransport,
          authToken: newMcpToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.server) {
        setMcpServers((prev) => [data.server, ...prev]);
        setMcpModalOpen(false);
        setNewMcpName('');
        setNewMcpUrl('');
        setNewMcpToken('');
      } else {
        setMcpError(data.error || 'Failed to connect MCP server.');
      }
    } catch (err: any) {
      setMcpError(err.message || 'Network error.');
    } finally {
      setAddingMcp(false);
    }
  }

  async function handleDeleteMcp(id: string) {
    try {
      await fetch(`/api/v1/mcp/${id}`, { method: 'DELETE' });
      setMcpServers((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  }

  if (!pref) {
    return (
      <div className="flex-1 max-w-4xl w-full mx-auto p-8">
        {error ? (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm font-sans text-center py-16">Loading settings...</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-sans">Settings & Connectors</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Manage your task routing policies, monthly budget, and custom Model Context Protocol (MCP) integrations.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.08] gap-6">
        <button
          onClick={() => setActiveTab('preferences')}
          className={`pb-3 text-sm font-medium transition flex items-center gap-2 relative ${
            activeTab === 'preferences' ? 'text-amber-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Routing & Budget</span>
          {activeTab === 'preferences' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('mcp')}
          className={`pb-3 text-sm font-medium transition flex items-center gap-2 relative ${
            activeTab === 'mcp' ? 'text-amber-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>MCP Servers & Tools</span>
          {mcpServers.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono">
              {mcpServers.length}
            </span>
          )}
          {activeTab === 'mcp' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full" />
          )}
        </button>
      </div>

      {saved && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Settings successfully saved.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab 1: Routing & Budget */}
      {activeTab === 'preferences' && (
        <form onSubmit={handleSave} className="bg-[#0f1118] border border-white/[0.08] rounded-2xl p-6 shadow-xl space-y-6">
          {/* Cost Policy Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-sans">
              Default Routing Policy
            </label>
            <p className="text-xs text-zinc-400">
              Governs model selection. Free-only strictly guarantees zero paid API calls.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {[
                { id: 'free_only', title: 'Free Only', desc: 'Verified $0 routes only. Zero paid API charges.' },
                { id: 'lowest_cost', title: 'Lowest Cost', desc: 'Prioritizes free & lowest cost routes while maintaining quality.' },
                { id: 'balanced', title: 'Balanced (Recommended)', desc: 'Optimizes quality-to-cost ratio for the best overall experience.' },
                { id: 'best_quality', title: 'Best Quality', desc: 'Picks the highest-rated eligible model regardless of price.' },
                { id: 'manual_pin', title: 'Manual Pin', desc: 'Only runs models you explicitly specify in your prompt.' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPref({ ...pref, defaultCostPolicy: p.id as any })}
                  className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                    pref.defaultCostPolicy === p.id
                      ? 'border-amber-500 bg-amber-500/10 text-white'
                      : 'border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="text-xs font-semibold text-zinc-200">{p.title}</span>
                  <span className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Financial Ceilings */}
          <div className="pt-4 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-sans mb-1">
                Max Cost Per Task (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.001"
                max="50"
                value={pref.maxCostPerTaskUSD}
                onChange={(e) => setPref({ ...pref, maxCostPerTaskUSD: parseFloat(e.target.value) || 0.01 })}
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-sm text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">Routes exceeding this ceiling are excluded.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-sans mb-1">
                Monthly Budget Cap (USD)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="5000"
                value={pref.monthlyBudgetUSD}
                onChange={(e) => setPref({ ...pref, monthlyBudgetUSD: parseFloat(e.target.value) || 1.0 })}
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-sm text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">Stops paid routing once spend reaches cap.</p>
            </div>
          </div>

          {/* Privacy Mode */}
          <div className="pt-4 border-t border-white/[0.06] space-y-2">
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-sans">
              Privacy Mode
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPref({ ...pref, privacyMode: 'standard' })}
                className={`flex-1 p-3.5 rounded-xl border text-left transition ${
                  pref.privacyMode === 'standard'
                    ? 'border-amber-500 bg-amber-500/10 text-white'
                    : 'border-white/[0.06] bg-white/[0.02] text-zinc-400'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-200">Standard</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">Allows free tier routes with standard provider policies.</div>
              </button>
              <button
                type="button"
                onClick={() => setPref({ ...pref, privacyMode: 'strict' })}
                className={`flex-1 p-3.5 rounded-xl border text-left transition ${
                  pref.privacyMode === 'strict'
                    ? 'border-amber-500 bg-amber-500/10 text-white'
                    : 'border-white/[0.06] bg-white/[0.02] text-zinc-400'
                }`}
              >
                <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" /> Strict Privacy
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">Excludes any route where user data may be used for model training.</div>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.06] flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-xl transition flex items-center gap-2 shadow-md disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: MCP Connectors & Tools */}
      {activeTab === 'mcp' && (
        <div className="space-y-6">
          <div className="bg-[#0f1118] border border-white/[0.08] rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Connected MCP Servers</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Connect custom Model Context Protocol (MCP) servers to give Shazam AI tools to interact with external databases, APIs, and services.
                </p>
              </div>

              <button
                onClick={() => setMcpModalOpen(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-xl transition flex items-center gap-1.5 shadow-md"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add MCP Server</span>
              </button>
            </div>

            {loadingMcp ? (
              <div className="text-center py-8 text-xs text-zinc-500">Loading connected servers...</div>
            ) : mcpServers.length === 0 ? (
              <div className="border border-dashed border-white/10 rounded-xl p-8 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/5 mx-auto flex items-center justify-center text-zinc-400">
                  <Server className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-zinc-200">No Custom MCP Servers Connected</h4>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                    Just like in Claude Desktop, you can connect your own MCP endpoints (e.g. Postgres DB, GitHub, Slack) to let Shazam execute actions on your platform.
                  </p>
                </div>
                <button
                  onClick={() => setMcpModalOpen(true)}
                  className="px-3.5 py-1.5 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-zinc-200 rounded-lg transition"
                >
                  Connect your first MCP
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {mcpServers.map((server) => (
                  <div
                    key={server.id}
                    className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-sm font-semibold text-zinc-100">{server.name}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/[0.05] text-zinc-400 border border-white/5 uppercase">
                          {server.transport}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 font-mono truncate max-w-xl">{server.url}</p>

                      {server.tools && server.tools.length > 0 && (
                        <div className="pt-2 flex flex-wrap gap-1.5">
                          {server.tools.map((t, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-white/[0.04] text-[11px] font-mono text-zinc-300 border border-white/5"
                              title={t.description || t.name}
                            >
                              ⚙️ {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleDeleteMcp(server.id)}
                      className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition"
                      title="Disconnect Server"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add MCP Modal */}
      {mcpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f1118] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h3 className="text-base font-semibold text-white">Add Custom MCP Server</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Provide the SSE or HTTP endpoint for your Model Context Protocol server.
              </p>
            </div>

            {mcpError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs">
                {mcpError}
              </div>
            )}

            <form onSubmit={handleAddMcp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Server Name</label>
                <input
                  type="text"
                  placeholder="e.g. Postgres DB Inspector"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Server URL</label>
                <input
                  type="url"
                  placeholder="https://mcp.yourdomain.com/sse"
                  value={newMcpUrl}
                  onChange={(e) => setNewMcpUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Transport</label>
                  <select
                    value={newMcpTransport}
                    onChange={(e) => setNewMcpTransport(e.target.value as any)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  >
                    <option value="sse">Server-Sent Events (SSE)</option>
                    <option value="http">HTTP POST / Stream</option>
                    <option value="websocket">WebSocket</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Auth Token (Optional)</label>
                  <input
                    type="password"
                    placeholder="Bearer token"
                    value={newMcpToken}
                    onChange={(e) => setNewMcpToken(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setMcpModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingMcp}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-xl transition shadow-md disabled:opacity-50"
                >
                  {addingMcp ? 'Connecting...' : 'Connect Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
