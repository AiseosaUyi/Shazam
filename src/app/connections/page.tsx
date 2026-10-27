'use client';

import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  ShieldCheck,
  ExternalLink,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
} from 'lucide-react';
import { Provider } from '@/types/provider';

interface ProviderWithStatus extends Provider {
  isConnected: boolean;
  keyPrefix?: string;
  credentialStatus: string;
  lastValidatedAt?: string;
}

export default function ConnectionsPage() {
  const [providers, setProviders] = useState<ProviderWithStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderWithStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/v1/providers');
      const json = await res.json();
      if (json.success) {
        setProviders(json.data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider || !apiKeyInput.trim()) return;

    setIsSubmitting(true);
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
      if (!json.success) {
        setFeedback({ type: 'error', message: json.error });
        setIsSubmitting(false);
        return;
      }

      setFeedback({ type: 'success', message: 'API key validated and securely stored in BYOK Vault.' });
      setApiKeyInput('');
      setSelectedProvider(null);
      fetchProviders();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save key.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeKey = async (providerId: string) => {
    if (!confirm('Are you sure you want to revoke this connected API key?')) return;
    try {
      const res = await fetch(`/api/v1/credentials/${providerId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchProviders();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-sky-400" />
          BYOK Provider Connections
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Connect your own API keys. Keys are encrypted at rest with AES-256-GCM and never returned to the browser.
        </p>
      </div>

      {/* Security Notice Banner */}
      <div className="bg-sky-950/40 border border-sky-800/60 rounded-2xl p-4 flex items-start gap-3">
        <Lock className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-sky-200 leading-relaxed">
          <strong>Enterprise Vault Security:</strong> Shazam AI uses envelope encryption at rest. Keys are isolated per user tenant, evaluated server-side, and scrubbed from error logs. Free-Only mode will never incur charges on paid keys.
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          )}
          {feedback.message}
        </div>
      )}

      {/* Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {providers.map((p) => (
          <div
            key={p.id}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-bold text-base text-white">{p.name}</h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    p.isConnected
                      ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-400'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {p.isConnected ? 'Connected' : 'Unconnected'}
                </span>
              </div>

              <p className="text-xs text-slate-400 mb-4 capitalize">
                Category: <strong className="text-slate-300">{p.category}</strong>
              </p>

              {p.isConnected && p.keyPrefix && (
                <div className="mb-4 p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">Key: {p.keyPrefix}</span>
                  <span className="text-[10px] text-emerald-400 font-semibold uppercase">Verified</span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              {p.keyInstructionsUrl && (
                <a
                  href={p.keyInstructionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium"
                >
                  Get API Key <ExternalLink className="w-3 h-3" />
                </a>
              )}

              <div className="flex items-center gap-2 ml-auto">
                {p.isConnected && p.keyPrefix !== 'system_configured' ? (
                  <button
                    onClick={() => handleRevokeKey(p.id)}
                    className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 transition"
                    title="Revoke Key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedProvider(p);
                      setApiKeyInput('');
                      setFeedback(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition"
                  >
                    Connect Key
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Connect Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-lg text-white">Connect {selectedProvider.name}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Paste your official {selectedProvider.name} API key below. The key will be tested against the provider endpoint and encrypted at rest.
            </p>

            <form onSubmit={handleSaveKey} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  API Key Secret
                </label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your key here..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedProvider(null)}
                  className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !apiKeyInput.trim()}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    'Verify & Save'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
