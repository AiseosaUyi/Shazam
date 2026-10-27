'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';

const PROVIDER_OPTIONS = [
  {
    id: 'google',
    name: 'Google Gemini (100% Free)',
    placeholder: 'AIzaSy...',
    hint: 'Instant free key with any Google Account. Zero billing or credit card.',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    placeholder: 'sk-proj-...',
    hint: 'gpt-6.1-terra, gpt-6-luna (Pay-as-you-go)',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    placeholder: 'sk-ant-...',
    hint: 'claude-sonnet-5.5, claude-opus-5.5 (Pay-as-you-go)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    placeholder: 'sk-...',
    hint: 'deepseek-flash, deepseek-v4-pro',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    placeholder: 'sk-or-...',
    hint: 'Multi-provider unified API + community free models',
    keyUrl: 'https://openrouter.ai/keys',
  },
];

export default function OnboardingPage() {
  const [selectedProvider, setSelectedProvider] = useState('google');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showAdvancedByok, setShowAdvancedByok] = useState(false);
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
      <div className="w-full max-w-xl space-y-6">
        {/* Welcome Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Welcome to Shazam AI</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Intelligent AI, Made Simple & Free
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-md mx-auto">
            You describe what you want to achieve, and Shazam selects the best AI model for the job.
          </p>
        </div>

        {/* Primary Card: Start Free Forever */}
        <div className="bg-[#10131d] border border-[#232736] rounded-2xl p-6 sm:p-7 shadow-2xl relative overflow-hidden space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                  Recommended
                </span>
                <span className="text-xs text-zinc-500 font-mono">100% Free Guarantee</span>
              </div>
              <h2 className="text-lg font-bold text-white">Start Free Forever</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                No credit card required. No API keys needed. You will never be billed for usage on our free tier.
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <Zap className="w-6 h-6" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
            <div className="p-3 rounded-xl bg-[#090b10] border border-[#1e2333] space-y-1">
              <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> $0.00 Cost
              </div>
              <p className="text-[11px] text-zinc-500 leading-normal">
                Strict guardrails guarantee you never incur unexpected charges.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[#090b10] border border-[#1e2333] space-y-1">
              <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Auto-Routing
              </div>
              <p className="text-[11px] text-zinc-500 leading-normal">
                Automatically routes each prompt to the fastest, smartest free model.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[#090b10] border border-[#1e2333] space-y-1">
              <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" /> Instant Access
              </div>
              <p className="text-[11px] text-zinc-500 leading-normal">
                Jump right in and start asking questions or generating code right now.
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
          >
            <span>Enter Workspace — It&apos;s Free</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Secondary Expandable Section: Power User / BYOK */}
        <div className="bg-[#0c0e14] border border-[#1e2333] rounded-2xl p-5">
          <button
            type="button"
            onClick={() => setShowAdvancedByok(!showAdvancedByok)}
            className="w-full flex items-center justify-between text-left text-xs text-zinc-400 hover:text-zinc-200 transition"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-500" />
              <div>
                <span className="font-semibold text-zinc-200">Power User or Developer?</span>
                <span className="text-zinc-500 ml-1.5 hidden sm:inline">Connect your own custom API key (Optional)</span>
              </div>
            </div>
            {showAdvancedByok ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showAdvancedByok && (
            <div className="mt-5 pt-5 border-t border-[#1e2333] space-y-4 animate-in fade-in duration-200">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Connecting your own key gives you a private, dedicated daily quota of up to 1,500 requests/day.
                You can get a free key from Google AI Studio in 30 seconds using your normal Google account (no credit card needed).
              </p>

              {error && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {success ? (
                <div className="p-4 text-center space-y-2 bg-emerald-950/30 border border-emerald-800 rounded-lg">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
                  <p className="text-xs font-semibold text-emerald-300">Key Connected Successfully</p>
                </div>
              ) : (
                <form onSubmit={handleConnect} className="space-y-4">
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
                              : 'border-[#232736] bg-[#080a0f] text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <span className="text-xs font-semibold">{p.name}</span>
                          <span className="text-[10px] text-zinc-500 truncate mt-1">{p.hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-zinc-300">
                        {currentOption.name} API Key
                      </label>
                      {currentOption.keyUrl && (
                        <a
                          href={currentOption.keyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-amber-400 hover:underline flex items-center gap-1 font-mono"
                        >
                          Get Free Key ↗
                        </a>
                      )}
                    </div>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      required
                      placeholder={currentOption.placeholder}
                      className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Keys are encrypted at rest with AES-256-GCM and never exposed to the browser.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !apiKey}
                    className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {loading ? 'Encrypting & Saving...' : 'Save & Connect Custom Key'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
