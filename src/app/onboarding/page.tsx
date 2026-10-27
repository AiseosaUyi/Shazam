'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';

const PROVIDER_OPTIONS = [
  { id: 'google', name: 'Google Gemini', placeholder: 'AIzaSy...', hint: 'Free tier available (gemini-3.8-flash, gemini-3.5-flash-lite)' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-proj-...', hint: 'gpt-6.1-terra, gpt-6-luna' },
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...', hint: 'claude-sonnet-5-5, claude-opus-5-5' },
  { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...', hint: 'deepseek-flash, deepseek-v4-pro' },
  { id: 'openrouter', name: 'OpenRouter', placeholder: 'sk-or-...', hint: 'Multi-provider unified API + verified free routes' },
];

export default function OnboardingPage() {
  const [selectedProvider, setSelectedProvider] = useState('google');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedProvider, apiKey }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save credential.');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, 1000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const currentOption = PROVIDER_OPTIONS.find((p) => p.id === selectedProvider)!;

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-[#10131d] border border-[#232736] rounded-xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white font-mono">Connect your first provider</h1>
            <p className="text-xs text-zinc-400">Bring Your Own Key (BYOK) — encrypted at rest with AES-256-GCM</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="p-6 text-center space-y-3 bg-emerald-950/30 border border-emerald-800 rounded-lg">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-semibold text-emerald-300 font-mono">Key Connected Successfully</h3>
            <p className="text-xs text-zinc-400">Redirecting to your workspace...</p>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-2">Select Provider</label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDER_OPTIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProvider(p.id)}
                    className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                      selectedProvider === p.id
                        ? 'border-amber-500 bg-amber-500/10 text-white'
                        : 'border-[#232736] bg-[#0c0e14] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span className="text-xs font-semibold">{p.name}</span>
                    <span className="text-[10px] text-zinc-500 truncate mt-1">{p.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                {currentOption.name} API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                placeholder={currentOption.placeholder}
                className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Keys are never stored in plaintext and never leaked to the client browser.
              </p>
            </div>

            <div className="p-3 bg-[#151926] border border-[#202538] rounded-lg flex items-start gap-2 text-zinc-400 text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Shazam AI respects your policies: Free-only tasks will only use free tiers and will never fall back to paid routes.
              </span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link
                href="/"
                className="text-xs text-zinc-400 hover:text-zinc-200 transition"
              >
                Skip for now
              </Link>
              <button
                type="submit"
                disabled={loading || !apiKey}
                className="py-2 px-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg transition flex items-center gap-1.5 shadow-md disabled:opacity-50"
              >
                {loading ? 'Encrypting & Saving...' : 'Save & Continue'}
                {!loading && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
