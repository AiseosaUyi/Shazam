'use client';

import { useState, useEffect } from 'react';
import { Cpu, ExternalLink, ShieldAlert, Sparkles, Search, Check, AlertTriangle } from 'lucide-react';
import type { Model, Provider, CatalogRoute } from '@/lib/types';

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [routes, setRoutes] = useState<CatalogRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');

  useEffect(() => {
    fetch('/api/v1/catalog')
      .then((res) => (res.ok ? res.json() : { models: [], providers: [], routes: [] }))
      .then((data) => {
        setModels(data.models || []);
        setProviders(data.providers || []);
        setRoutes(data.routes || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const routeMap = new Map(routes.map((r) => [r.modelId, r]));

  const filteredModels = models.filter((m) => {
    const route = routeMap.get(m.id);
    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase());
    const matchesProvider =
      selectedProvider === 'all' || route?.providerId === selectedProvider;
    return matchesSearch && matchesProvider;
  });

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.07] pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">Model Intelligence Catalog</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-zinc-300 border border-white/10 tracking-wide uppercase">
              Verified 2026
            </span>
          </div>
          <p className="text-sm text-zinc-400">
            Real-time verified pricing, token context windows, quality benchmark priors, and privacy terms.
          </p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="pl-9 pr-3.5 py-1.5 text-xs bg-white/[0.03] border border-white/10 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 transition w-56"
            />
          </div>

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

      {loading ? (
        <div className="text-center py-20 text-zinc-500 text-sm">Loading verified catalog...</div>
      ) : filteredModels.length === 0 ? (
        <div className="text-center py-20 text-zinc-500 text-sm">No models matching filter criteria.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModels.map((model) => {
            const route = routeMap.get(model.id);
            const provider = route ? providerMap.get(route.providerId) : undefined;
            const isFree = route?.costClass === 'verified_free';
            const isUnknown = route?.costClass === 'unknown';
            const mayTrain = route?.privacy.providerMayTrainOnData === true;

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
                      {isFree ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          100% FREE
                        </span>
                      ) : isUnknown ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 font-medium">
                          UNKNOWN
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] text-zinc-300 bg-white/5 border border-white/10 font-medium">
                          PAID
                        </span>
                      )}

                      {route?.status === 'disabled' && (
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
                        {route?.pricing ? `$${route.pricing.inputPer1M}` : isFree ? '$0.00' : 'unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Output / 1M</span>
                      <span className="font-mono text-zinc-200 font-medium">
                        {route?.pricing ? `$${route.pricing.outputPer1M}` : isFree ? '$0.00' : 'unknown'}
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

                  {/* Privacy alert for free tier training */}
                  {mayTrain && (
                    <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                      <span>Free tier training terms apply by provider. Blocked automatically in Strict Privacy mode.</span>
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
                  {route?.sourceUrl && (
                    <a
                      href={route.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-amber-400 flex items-center gap-1 transition"
                    >
                      Official docs <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

