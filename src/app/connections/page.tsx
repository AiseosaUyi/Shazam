'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  KeyRound,
  ShieldCheck,
  ExternalLink,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Lock,
  Plus,
  X,
  Palette,
  Zap,
  Sparkles,
} from 'lucide-react';

interface ProviderItem {
  id: string;
  name: string;
  description: string;
  documentationUrl?: string;
  apiDocsUrl?: string;
  requiresApiKey?: boolean;
  isZeroKeyProvider?: boolean;
  isConnected: boolean;
  isSystemProvided?: boolean;
  keyMask?: string | null;
  credentialStatus: string;
  lastValidatedAt?: string | null;
}

export default function ConnectionsPage() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderItem | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/v1/providers');
      const json = await res.json();
      const list: ProviderItem[] = json.providers || [];
      setProviders(list);

      // Check URL query param for automatic provider selection
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const target = params.get('provider');
        if (target) {
          const match = list.find((p) => p.id === target);
          if (match && match.requiresApiKey !== false && !match.isZeroKeyProvider) {
            setSelectedProvider(match);
          }
        }
      }

      // Cache connected status locally so refreshes never flash disconnected
      try {
        const cache: Record<string, { isConnected: boolean; keyMask?: string | null }> = {};
        for (const p of list) {
          if (p.isConnected) {
            cache[p.id] = { isConnected: true, keyMask: p.keyMask };
          }
        }
        localStorage.setItem('shazam_connections_cache', JSON.stringify(cache));
      } catch {}
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => setUser(data.user))
      .catch(() => {});

    // Optimistically hydrate cached connection status from local storage
    try {
      const raw = localStorage.getItem('shazam_connections_cache');
      if (raw) {
        const cache = JSON.parse(raw);
        setProviders((prev) =>
          prev.map((p) => (cache[p.id] ? { ...p, isConnected: true, keyMask: cache[p.id].keyMask } : p))
        );
      }
    } catch {}

    fetchProviders();
  }, []);

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider || !apiKeyInput.trim()) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/v1/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProvider.id,
          apiKey: apiKeyInput.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save credential.');
      }

      setFeedback({ type: 'success', message: `Successfully connected ${selectedProvider.name}. Key encrypted in vault.` });
      setApiKeyInput('');
      setSelectedProvider(null);
      await fetchProviders();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeKey = async (providerId: string, providerName: string) => {
    if (!confirm(`Revoke connected API key for ${providerName}?`)) return;

    try {
      const res = await fetch(`/api/v1/credentials/${providerId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to revoke credential.');

      setFeedback({ type: 'success', message: `Revoked credential for ${providerName}.` });
      try {
        const raw = localStorage.getItem('shazam_connections_cache');
        if (raw) {
          const cache = JSON.parse(raw);
          delete cache[providerId];
          localStorage.setItem('shazam_connections_cache', JSON.stringify(cache));
        }
      } catch {}
      await fetchProviders();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  return (
    <div className="flex-1 h-full min-h-0 overflow-y-auto">
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#232736] pb-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white font-mono">Provider Connections</h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                BYOK Vault
              </span>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Manage your personal API keys. Credentials are encrypted at rest with AES-256-GCM and never returned in plaintext.
            </p>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141824] border border-[#232736] text-xs text-zinc-300">
            <Lock className="w-3.5 h-3.5 text-amber-500" />
            <span>Zero Server Key Leaks</span>
          </div>
        </div>

      {/* Guest Mode Banner */}
      {!user && !loading && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-200">
              You are viewing available AI providers in guest preview mode. Sign in to link your own private API keys in the vault.
            </span>
          </div>
          <Link
            href="/login"
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs shrink-0 transition shadow-sm"
          >
            Sign In
          </Link>
        </div>
      )}

      {/* Free Tier Guide Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-[#141824] to-[#141824] border border-amber-500/20 text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              100% Free Forever
            </span>
            <span className="font-semibold text-white">How Free AI Keys Work</span>
          </div>
          <p className="text-zinc-400 leading-relaxed max-w-2xl">
            You are never billed by Shazam AI. To get unlimited personal free usage (1,500 requests/day), you can get a 100% free API key from Google AI Studio in 30 seconds using any standard Google account. Google will never ask for a credit card or billing details.
          </p>
        </div>
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 shadow-sm"
        >
          <span>Get Free Google Key</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-red-950/40 border-red-800 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-zinc-500 text-sm font-mono">Loading connected providers...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((p) => (
            <div
              key={p.id}
              className="bg-[#10131d] border border-[#232736] rounded-xl p-5 flex flex-col justify-between space-y-4 hover:border-zinc-700 transition"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-base font-bold text-white tracking-tight">{p.name}</h3>
                      {p.id === 'google' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          100% Free
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400">{p.id}</p>
                  </div>

                  {p.requiresApiKey === false || p.isZeroKeyProvider ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shadow-sm">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> ACTIVE · ZERO KEY
                    </span>
                  ) : p.isConnected ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> CONNECTED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800 border border-zinc-700">
                      NOT CONNECTED
                    </span>
                  )}
                </div>

                <p className="text-xs text-zinc-400">{p.description}</p>

                {(p.requiresApiKey === false || p.isZeroKeyProvider) && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center justify-between">
                    <span>100% Free · Zero API key required</span>
                    <span className="text-[10px] font-mono font-semibold text-emerald-400">Ready Out-of-the-Box</span>
                  </div>
                )}

                {p.id === 'google' && !p.isConnected && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center justify-between">
                    <span>No credit card needed</span>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      Get Key <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {p.isConnected && (
                  <div className="pt-2 border-t border-[#1e2333] space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Key Mask</span>
                      <span className="font-mono text-zinc-200">{p.keyMask || '••••••••'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Status</span>
                      <span className={`font-mono ${p.credentialStatus === 'valid' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {p.credentialStatus}
                      </span>
                    </div>
                    {p.lastValidatedAt && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Last Verified</span>
                        <span className="font-mono text-zinc-400">
                          {new Date(p.lastValidatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[#1e2333] flex items-center justify-between">
                {p.apiDocsUrl ? (
                  <a
                    href={p.apiDocsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 hover:text-amber-400 flex items-center gap-1 transition"
                  >
                    API Keys <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span />
                )}

                {p.requiresApiKey === false || p.isZeroKeyProvider ? (
                  <Link
                    href={p.id === 'pollinations' ? '/?model=FLUX.1+Schnell+(Free)' : '/'}
                    className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-lg transition flex items-center gap-1.5 shadow-sm"
                  >
                    {p.id === 'pollinations' ? (
                      <>
                        <Palette className="w-3.5 h-3.5" />
                        <span>Generate Images 🎨</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Launch in Chat ⚡</span>
                      </>
                    )}
                  </Link>
                ) : p.isConnected && !p.isSystemProvided ? (
                  <button
                    onClick={() => handleRevokeKey(p.id, p.name)}
                    className="px-2.5 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded border border-red-900/40 transition flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Revoke
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    {p.id === 'google' && (
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg transition flex items-center gap-1"
                      >
                        <span>Get Key</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => {
                        if (!user) {
                          window.location.href = '/login';
                          return;
                        }
                        setSelectedProvider(p);
                        setApiKeyInput('');
                        setFeedback(null);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-lg transition flex items-center gap-1 shadow-sm"
                    >
                      <Plus className="w-3 h-3" /> Connect Key
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connect Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10131d] border border-[#232736] rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-500" /> Connect {selectedProvider.name}
              </h3>
              <button onClick={() => setSelectedProvider(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Provide your API key for {selectedProvider.name}. The key is sent over HTTPS and encrypted inside the vault using AES-256-GCM.
            </p>

            {selectedProvider.id === 'google' && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 flex items-center justify-between shadow-sm">
                <div>
                  <div className="font-semibold text-emerald-200">100% Free Forever (No Card)</div>
                  <div className="text-[11px] text-zinc-400">Takes 30 seconds with any Google account.</div>
                </div>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-lg text-xs flex items-center gap-1 shrink-0 transition"
                >
                  <span>Get Free Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {selectedProvider.id === 'openai' && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-300 flex items-center justify-between">
                <span>Copy or generate your OpenAI API key:</span>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs flex items-center gap-1 transition"
                >
                  <span>OpenAI Keys</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {selectedProvider.id === 'anthropic' && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-300 flex items-center justify-between">
                <span>Copy or generate your Anthropic API key:</span>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs flex items-center gap-1 transition"
                >
                  <span>Anthropic Keys</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {selectedProvider.id === 'deepseek' && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-300 flex items-center justify-between">
                <span>Copy or generate your DeepSeek API key:</span>
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs flex items-center gap-1 transition"
                >
                  <span>DeepSeek Keys</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            <form onSubmit={handleSaveKey} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">API Key</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your API key here..."
                  required
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 placeholder-zinc-500 font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedProvider(null)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !apiKeyInput.trim()}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg transition disabled:opacity-50"
                >
                  {submitting ? 'Encrypting & Saving...' : 'Save Credential'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
