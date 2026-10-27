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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#232736] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono">Model Catalogue</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
              Verified 2026-10-27
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Official benchmark priors, verified pricing, token context windows, and privacy terms.
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
              className="pl-9 pr-3 py-1.5 text-xs bg-[#10131d] border border-[#232736] rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[#10131d] border border-[#232736] rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
          >
            <option value="all">All Providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-zinc-500 text-sm font-mono">Loading verified catalogue...</div>
      ) : filteredModels.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">No models matching filter criteria.</div>
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
                className="bg-[#10131d] border border-[#232736] rounded-xl p-5 flex flex-col justify-between hover:border-zinc-700 transition"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        {provider?.name || 'Unknown Provider'}
                      </span>
                      <h3 className="text-base font-bold text-white tracking-tight">{model.name}</h3>
                      <p className="text-[11px] font-mono text-zinc-400 mt-0.5">{model.providerModelId}</p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {isFree ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          FREE TIER
                        </span>
                      ) : isUnknown ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800">
                          UNKNOWN COST
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-300 bg-zinc-800 border border-zinc-700">
                          PAID
                        </span>
                      )}

                      {route?.status === 'disabled' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-red-950 text-red-400 border border-red-800">
                          DISABLED
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-2">{model.description}</p>

                  {/* Pricing and specs */}
                  <div className="pt-2 border-t border-[#1e2333] grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-zinc-500 block">Input / 1M</span>
                      <span className="font-mono text-zinc-200">
                        {route?.pricing ? `$${route.pricing.inputPer1M}` : isFree ? '$0.00' : 'unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Output / 1M</span>
                      <span className="font-mono text-zinc-200">
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
                    <div className="p-2 rounded bg-amber-950/40 border border-amber-900/60 text-[11px] text-amber-300 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                      <span>Free tier data is used by provider to improve products. Blocked in Strict Privacy mode.</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-[#1e2333] flex items-center justify-between text-[11px] text-zinc-500">
                  <div className="flex items-center gap-1.5">
                    {model.supportsTools && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Tools</span>}
                    {model.supportsReasoning && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400">Reasoning</span>}
                  </div>
                  {route?.sourceUrl && (
                    <a
                      href={route.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-amber-400 flex items-center gap-1"
                    >
                      Official source <ExternalLink className="w-3 h-3" />
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
