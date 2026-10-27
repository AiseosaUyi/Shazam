'use client';

import React, { useState, useEffect } from 'react';
import { Cpu, ExternalLink, Filter, Search, CheckCircle2, XCircle, ShieldCheck, Zap } from 'lucide-react';
import { Model, Provider, Route } from '@/types/provider';

export default function CataloguePage() {
  const [models, setModels] = useState<Model[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [search, setSearch] = useState('');
  const [costClassFilter, setCostClassFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/v1/catalog')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setModels(json.data.models || []);
          setRoutes(json.data.routes || []);
          setProviders(json.data.providers || []);
        }
      });
  }, []);

  const routeByModelId = new Map(routes.map((r) => [r.modelId, r]));
  const providerById = new Map(providers.map((p) => [p.id, p]));

  const filteredModels = models.filter((m) => {
    const route = routeByModelId.get(m.id);
    const provider = providerById.get(m.providerId);

    const matchesSearch =
      m.canonicalName.toLowerCase().includes(search.toLowerCase()) ||
      m.providerModelId.toLowerCase().includes(search.toLowerCase()) ||
      provider?.name.toLowerCase().includes(search.toLowerCase());

    const matchesCost =
      costClassFilter === 'all' || route?.costClass === costClassFilter;

    const matchesProvider =
      providerFilter === 'all' || m.providerId === providerFilter;

    return matchesSearch && matchesCost && matchesProvider;
  });

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Cpu className="w-6 h-6 text-sky-400" />
          Model & Route Catalogue
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Verified models, endpoints, capability scores, and pricing schedules. Unverified models are kept disabled.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models or providers..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Cost:</span>
            <select
              value={costClassFilter}
              onChange={(e) => setCostClassFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-sky-400 rounded-lg px-2 py-1 font-semibold focus:outline-none"
            >
              <option value="all">All Classes</option>
              <option value="verified_free">Verified Free ($0)</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Provider:</span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-sky-400 rounded-lg px-2 py-1 font-semibold focus:outline-none"
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
      </div>

      {/* Model Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredModels.map((model) => {
          const route = routeByModelId.get(model.id);
          const provider = providerById.get(model.providerId);
          const isEnabled = route?.status === 'enabled';

          return (
            <div
              key={model.id}
              className={`rounded-2xl p-5 border flex flex-col justify-between transition-all shadow-lg ${
                isEnabled
                  ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                  : 'bg-slate-950/60 border-slate-900 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-bold text-base text-white">{model.canonicalName}</h3>
                    <div className="font-mono text-[11px] text-sky-400 mt-0.5">
                      {model.providerModelId}
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      route?.costClass === 'verified_free'
                        ? 'bg-emerald-950/80 border border-emerald-800/60 text-emerald-400'
                        : route?.costClass === 'paid'
                        ? 'bg-amber-950/80 border border-amber-800/60 text-amber-400'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {route?.costClass || 'unknown'}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs px-2 py-0.5 bg-slate-950 border border-slate-800 rounded font-medium text-slate-300">
                    {provider?.name || model.providerId}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {route?.accessMode}
                  </span>
                </div>

                {/* Capability Badges */}
                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl mb-4 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-sans">Context Window</span>
                    <strong className="text-slate-200">
                      {model.contextWindowTokens.toLocaleString()} tokens
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-sans">Max Output</span>
                    <strong className="text-slate-200">
                      {model.maxOutputTokens.toLocaleString()} tokens
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-sans">Input Pricing</span>
                    <strong className="text-emerald-400">
                      ${route?.pricing.inputPer1MTokensUSD ?? 0} / 1M
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-sans">Output Pricing</span>
                    <strong className="text-emerald-400">
                      ${route?.pricing.outputPer1MTokensUSD ?? 0} / 1M
                    </strong>
                  </div>
                </div>

                {/* Quality Score Meter */}
                <div className="space-y-1.5 mb-4 text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>Reasoning Score:</span>
                    <span className="font-mono text-slate-200 font-semibold">
                      {model.qualityScores.reasoning}/100
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Coding Score:</span>
                    <span className="font-mono text-slate-200 font-semibold">
                      {model.qualityScores.coding}/100
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Writing Score:</span>
                    <span className="font-mono text-slate-200 font-semibold">
                      {model.qualityScores.writing}/100
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span
                  className={`flex items-center gap-1 font-semibold ${
                    isEnabled ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {isEnabled ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  {isEnabled ? 'Verified & Enabled' : 'Disabled / Unverified'}
                </span>

                {route?.officialDocReference && (
                  <a
                    href={route.officialDocReference}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium"
                  >
                    Docs <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
