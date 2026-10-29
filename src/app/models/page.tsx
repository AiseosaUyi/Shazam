'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Cpu, ExternalLink, ShieldAlert, Sparkles, Search, Check, AlertTriangle, KeyRound, CheckCircle2, Palette, Zap } from 'lucide-react';
import type { Model, Provider, CatalogRoute } from '@/lib/types';

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [routes, setRoutes] = useState<CatalogRoute[]>([]);
  const [connectedProviders, setConnectedProviders] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [costFilter, setCostFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [modalityFilter, setModalityFilter] = useState<'all' | 'text' | 'image'>('all');

  useEffect(() => {
    // 1. Optimistic hydration from local storage connections cache
    try {
      const raw = localStorage.getItem('shazam_connections_cache');
      if (raw) {
        const cache = JSON.parse(raw);
        const map: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(cache)) {
          if ((v as any)?.isConnected) map[k] = true;
        }
        setConnectedProviders(map);
      }
    } catch {}

    // 2. Fetch live catalog and provider credentials simultaneously
    Promise.all([
      fetch('/api/v1/catalog').then((res) => (res.ok ? res.json() : { models: [], providers: [], routes: [] })),
      fetch('/api/v1/providers').then((res) => (res.ok ? res.json() : { providers: [] })),
    ])
      .then(([catData, provData]) => {
        setModels(catData.models || []);
        setProviders(catData.providers || []);
        setRoutes(catData.routes || []);

        const map: Record<string, boolean> = {};
        for (const p of provData.providers || []) {
          if (p.isConnected) map[p.id] = true;
        }
        setConnectedProviders(map);
        try {
          localStorage.setItem(
            'shazam_connections_cache',
            JSON.stringify(
              Object.fromEntries(
                (provData.providers || [])
                  .filter((p: any) => p.isConnected)
                  .map((p: any) => [p.id, { isConnected: true, keyMask: p.keyMask }])
              )
            )
          );
        } catch {}

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const providerMap = new Map(providers.map((p) => [p.id, p]));

  // Index routes by model ID to support multiple tiers (free tier & paid tier)
  const routesByModel = new Map<string, CatalogRoute[]>();
  for (const r of routes) {
    const list = routesByModel.get(r.modelId) || [];
    list.push(r);
    routesByModel.set(r.modelId, list);
  }

  const filteredModels = models.filter((m) => {
    const modelRoutes = routesByModel.get(m.id) || [];
    const hasFreeRoute = modelRoutes.some((r) => r.costClass === 'verified_free' || r.costClass === 'local_compute');
    const hasPaidRoute = modelRoutes.some((r) => r.costClass === 'paid' || r.costClass === 'unknown');

    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase());

    const matchesProvider =
      selectedProvider === 'all' || modelRoutes.some((r) => r.providerId === selectedProvider);

    const matchesCost =
      costFilter === 'all'
        ? true
        : costFilter === 'free'
        ? hasFreeRoute
        : hasPaidRoute && !hasFreeRoute;

    const matchesModality =
      modalityFilter === 'all'
        ? true
        : modalityFilter === 'image'
        ? m.outputModality === 'image' || m.id.includes('flux') || m.name.toLowerCase().includes('flux')
        : m.outputModality !== 'image';

    return matchesSearch && matchesProvider && matchesCost && matchesModality;
  });

  return (
    <div className="flex-1 h-full min-h-0 overflow-y-auto">
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.07] pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-white font-sans">Model Intelligence Catalog</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tracking-wide uppercase font-mono">
                Verified 2026
              </span>
            </div>
            <p className="text-sm text-zinc-400">
              Real-time verified pricing, token context windows, quality benchmark priors, and privacy terms.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="pl-9 pr-3.5 py-1.5 text-xs bg-white/[0.03] border border-white/10 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 transition w-48 sm:w-56"
              />
            </div>

            {/* Modality Filter */}
            <div className="flex items-center p-0.5 bg-white/[0.03] border border-white/10 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setModalityFilter('all')}
                className={`px-2.5 py-1 rounded-lg transition font-medium ${
                  modalityFilter === 'all' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setModalityFilter('text')}
                className={`px-2.5 py-1 rounded-lg transition font-medium ${
                  modalityFilter === 'text' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Chat & Code
              </button>
              <button
                type="button"
                onClick={() => setModalityFilter('image')}
                className={`px-2.5 py-1 rounded-lg transition font-medium flex items-center gap-1.5 ${
                  modalityFilter === 'image' ? 'bg-pink-500/20 text-pink-300 font-semibold border border-pink-500/30' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Palette className="w-3.5 h-3.5 text-pink-400" />
                <span>Image Gen</span>
              </button>
            </div>

            {/* Cost Filter */}
            <div className="flex items-center p-0.5 bg-white/[0.03] border border-white/10 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setCostFilter('all')}
                className={`px-2.5 py-1 rounded-lg transition font-medium ${
                  costFilter === 'all' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All Costs
              </button>
              <button
                type="button"
                onClick={() => setCostFilter('free')}
                className={`px-2.5 py-1 rounded-lg transition font-medium flex items-center gap-1 ${
                  costFilter === 'free' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span>100% Free</span>
              </button>
              <button
                type="button"
                onClick={() => setCostFilter('paid')}
                className={`px-2.5 py-1 rounded-lg transition font-medium ${
                  costFilter === 'paid' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Paid (BYOK)
              </button>
            </div>

            {/* Provider Filter */}
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white/[0.03] border border-white/10 rounded-xl text-zinc-200 focus:outline-none focus:border-amber-500/60 transition font-sans"
            >
              <option value="all" className="bg-[#12141c]">All Providers</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#12141c]">
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Free Tier Callout Banner */}
        {connectedProviders['google'] ? (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-white/[0.02] border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  Google Gemini Connected
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Free Tier Active
                  </span>
                </h4>
                <p className="text-xs text-zinc-300 mt-0.5 max-w-2xl">
                  Your Google AI Studio API key is encrypted and active in your personal vault. 1,500 free requests per day ready across Gemini 3.8 Flash and 3.5 Flash Lite with zero server fees.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/?model=Gemini%203.8%20Flash"
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center gap-1.5 transition shadow-sm"
              >
                <span>Start Free Chat</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/connections"
                className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-zinc-300 text-xs font-medium border border-white/10 transition"
              >
                Manage Keys
              </Link>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-amber-500/5 to-white/[0.02] border border-emerald-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  Use Shazam AI 100% Free
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Zero Credit Card
                  </span>
                </h4>
                <p className="text-xs text-zinc-300 mt-0.5 max-w-2xl">
                  Get an instant free API key from Google AI Studio in 30 seconds using any standard Google account. Google provides Gemini 3.8 Flash and Flash Lite free of charge with up to 1,000,000 tokens!
                </p>
              </div>
            </div>
            <Link
              href="/connections"
              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center gap-1.5 transition shadow-sm shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Connect Free Google Key</span>
            </Link>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-zinc-500 text-sm">Loading verified catalog...</div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-20 text-zinc-500 text-sm">No models matching filter criteria.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-12">
            {filteredModels.map((model) => {
              const modelRoutes = routesByModel.get(model.id) || [];
              const freeRoute = modelRoutes.find((r) => r.costClass === 'verified_free' || r.costClass === 'local_compute');
              const paidRoute = modelRoutes.find((r) => r.costClass === 'paid' || r.costClass === 'unknown');
              const primaryRoute = freeRoute || paidRoute || modelRoutes[0];
              const provider = primaryRoute ? providerMap.get(primaryRoute.providerId) : undefined;
              const isLocal = primaryRoute?.costClass === 'local_compute' || primaryRoute?.providerId === 'ollama';
              const isFree = !!freeRoute || isLocal || primaryRoute?.costClass === 'verified_free';
              const isZeroKey = provider?.requiresApiKey === false || primaryRoute?.providerId === 'pollinations' || isLocal;
              const isProviderConnected = isZeroKey || Boolean(primaryRoute && connectedProviders[primaryRoute.providerId]);
              const mayTrain = primaryRoute?.privacy.providerMayTrainOnData === true;

              return (
                <div
                  key={model.id}
                  className="bg-white/[0.02] border border-white/[0.07] hover:border-white/15 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 shadow-sm hover:shadow-lg group"
                >
                  <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          {provider?.name || 'Unknown Provider'}
                        </span>
                        <h3 className="text-base font-bold text-white tracking-tight group-hover:text-amber-300 transition-colors">
                          {model.name}
                        </h3>
                        <p className="text-[11px] font-mono text-zinc-400 mt-0.5">{model.providerModelId}</p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {model.outputModality === 'image' ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 shadow-sm font-mono ${
                              isZeroKey
                                ? 'bg-pink-500/15 text-pink-300 border border-pink-500/30'
                                : isFree
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-white/5 text-zinc-300 border border-white/10'
                            }`}>
                              <Palette className="w-3 h-3 text-zinc-400" />
                              {isZeroKey ? 'FREE IMAGE GEN' : isFree ? '100% FREE (BYOK)' : 'PAID (BYOK)'}
                            </span>
                            {isProviderConnected && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5" /> CONNECTED
                              </span>
                            )}
                          </div>
                        ) : isLocal ? (
                          <div className="flex items-center gap-1.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 shadow-sm font-mono">
                              <Zap className="w-3 h-3 text-cyan-400" />
                              LOCAL COMPUTE
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                              $0.00
                            </span>
                          </div>
                        ) : isFree ? (
                          <div className="flex items-center gap-1.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 shadow-sm">
                              <Sparkles className="w-3 h-3 text-emerald-400" />
                              100% FREE TIER
                            </span>
                            {isProviderConnected && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5" /> CONNECTED
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] text-zinc-300 bg-white/5 border border-white/10 font-medium">
                              PAID (BYOK)
                            </span>
                            {isProviderConnected && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5" /> CONNECTED
                              </span>
                            )}
                          </div>
                        )}

                        {primaryRoute?.status === 'disabled' && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] bg-red-500/10 text-red-400 border border-red-500/20 font-semibold">
                            DISABLED
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{model.description}</p>

                    {/* Pricing and specs */}
                    <div className="pt-3 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-zinc-500 block">Input / 1M</span>
                        <span className="font-mono text-zinc-200 font-medium">
                          {isFree ? (
                            <span className="text-emerald-400 font-semibold">$0.00 (Free)</span>
                          ) : primaryRoute?.pricing ? (
                            `$${primaryRoute.pricing.inputPer1M}`
                          ) : (
                            'unknown'
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Output / 1M</span>
                        <span className="font-mono text-zinc-200 font-medium">
                          {isFree ? (
                            <span className="text-emerald-400 font-semibold">$0.00 (Free)</span>
                          ) : primaryRoute?.pricing ? (
                            `$${primaryRoute.pricing.outputPer1M}`
                          ) : (
                            'unknown'
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Context Window</span>
                        <span className="font-mono text-zinc-200">
                          {model.contextWindowTokens ? `${(model.contextWindowTokens / 1000).toFixed(0)}k tokens` : 'unknown'}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Quality Prior</span>
                        <span className="font-mono text-amber-400 font-semibold">
                          {model.qualityTier}/5
                        </span>
                      </div>
                    </div>

                    {/* Free tier note */}
                    {isZeroKey ? (
                      <div className="p-2.5 rounded-xl border border-pink-500/25 bg-pink-500/10 text-[11px] text-pink-300 flex items-center justify-between gap-2 shadow-sm">
                        <div className="flex items-center gap-1.5 leading-tight">
                          <CheckCircle2 className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                          <span>100% Free · Zero API Key Required</span>
                        </div>
                        <Link
                          href={`/?model=${encodeURIComponent(model.name)}`}
                          className="shrink-0 text-pink-300 hover:text-white font-semibold underline underline-offset-2 flex items-center gap-0.5"
                        >
                          <span>Generate Now</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    ) : isLocal ? (
                      <div className="p-2.5 rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-[11px] text-cyan-300 flex items-center justify-between gap-2 shadow-sm">
                        <div className="flex items-center gap-1.5 leading-tight">
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>Local Device Compute · No Key Needed · Offline Privacy</span>
                        </div>
                        <Link
                          href={`/?model=${encodeURIComponent(model.name)}`}
                          className="shrink-0 text-cyan-300 hover:text-white font-semibold underline underline-offset-2 flex items-center gap-0.5"
                        >
                          <span>Chat Now</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    ) : (
                      <div className={`p-2.5 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
                        isProviderConnected
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                      }`}>
                        <div className="flex items-center gap-1.5 leading-tight">
                          {isProviderConnected ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span>Key connected · Ready to {model.outputModality === 'image' ? 'generate' : 'chat'}</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>{provider?.name || 'Provider'} API Key Required</span>
                            </>
                          )}
                        </div>
                        {isProviderConnected ? (
                          <Link
                            href={`/?model=${encodeURIComponent(model.name)}`}
                            className="shrink-0 text-emerald-400 hover:text-emerald-300 font-semibold underline underline-offset-2 flex items-center gap-0.5"
                          >
                            <span>{model.outputModality === 'image' ? 'Generate' : 'Chat'} Now</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            {provider?.keyUrl && (
                              <a
                                href={provider.keyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-0.5 font-medium"
                              >
                                Mint Key <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                            <Link
                              href={`/connections?provider=${primaryRoute?.providerId || 'google'}`}
                              className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-semibold"
                            >
                              Connect Key
                            </Link>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Privacy alert for free tier training */}
                    {mayTrain && (
                      <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                        <span>Free tier data logging applies by provider. Blocked automatically in Strict Privacy mode.</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-500">
                    <div className="flex items-center gap-1.5">
                      {model.supportsTools && (
                        <span className="px-2 py-0.5 rounded-full bg-white/5 text-zinc-300 text-[10px] border border-white/5 font-medium">
                          Tools
                        </span>
                      )}
                      {model.supportsReasoning && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] border border-amber-500/20 font-medium">
                          Reasoning
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isZeroKey && !isProviderConnected ? (
                        <Link
                          href={`/connections?provider=${primaryRoute?.providerId || 'google'}`}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 shadow-sm"
                        >
                          <KeyRound className="w-3 h-3 text-amber-400" />
                          <span>Connect Key</span>
                        </Link>
                      ) : (
                        <Link
                          href={`/?model=${encodeURIComponent(model.name)}`}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 shadow-sm ${
                            model.outputModality === 'image'
                              ? 'bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 border border-pink-500/30 hover:border-pink-500/50'
                              : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 hover:border-amber-500/40'
                          }`}
                        >
                          {model.outputModality === 'image' ? (
                            <>
                              <Palette className="w-3 h-3 text-pink-400" />
                              <span>Generate</span>
                            </>
                          ) : (
                            <>
                              <span>Chat</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </>
                          )}
                        </Link>
                      )}
                      {primaryRoute?.sourceUrl && (
                        <a
                          href={primaryRoute.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-400 hover:text-amber-400 flex items-center gap-1 transition"
                        >
                          Docs
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

