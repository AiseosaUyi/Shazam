'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, DollarSign, Activity, ArrowRightLeft } from 'lucide-react';

export default function UsagePage() {
  const [usage, setUsage] = useState<any>(null);

  useEffect(() => {
    fetch('/api/v1/usage')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setUsage(json.data);
      });
  }, []);

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-sky-400" />
          Usage Ledger & Cost Tracking
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Auditable ledger of executed tasks, token volumes, estimated spend, and failover history.
        </p>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Total Invocations</span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">
            {usage?.totalRequests ?? 0}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">
            {usage?.successfulRequests ?? 0} completed successfully
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Total Tokens</span>
            <TrendingUp className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">
            {(usage?.totalTokens ?? 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">Input + Output Tokens</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Estimated Spend</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-400">
            ${(usage?.totalEstimatedCostUSD ?? 0).toFixed(4)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Monthly budget: ${(usage?.monthlyBudgetUSD ?? 25).toFixed(2)}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Resilient Failovers</span>
            <ArrowRightLeft className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-extrabold text-amber-400">
            {usage?.fallbacks ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Quota / Rate-limit cascades</div>
        </div>
      </div>

      {/* Provider & Model Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Spend by Provider
          </h3>
          <div className="space-y-2">
            {usage?.byProvider && Object.keys(usage.byProvider).length > 0 ? (
              Object.entries(usage.byProvider).map(([prov, data]: [string, any]) => (
                <div
                  key={prov}
                  className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <span className="font-semibold text-white capitalize">{prov}</span>
                  <div className="flex items-center gap-4 text-slate-400 font-mono">
                    <span>{data.requests} reqs</span>
                    <span>{data.tokens.toLocaleString()} tok</span>
                    <strong className="text-emerald-400">${data.costUSD.toFixed(4)}</strong>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No provider usage recorded yet.</p>
            )}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Spend by Model
          </h3>
          <div className="space-y-2">
            {usage?.byModel && Object.keys(usage.byModel).length > 0 ? (
              Object.entries(usage.byModel).map(([mod, data]: [string, any]) => (
                <div
                  key={mod}
                  className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <span className="font-mono text-sky-400">{mod}</span>
                  <div className="flex items-center gap-4 text-slate-400 font-mono">
                    <span>{data.requests} reqs</span>
                    <strong className="text-emerald-400">${data.costUSD.toFixed(4)}</strong>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No model usage recorded yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Append-only Event Ledger */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Append-Only Task Ledger (Latest 50 Events)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="pb-2.5">Time</th>
                <th className="pb-2.5">Task ID</th>
                <th className="pb-2.5">Route</th>
                <th className="pb-2.5">Policy</th>
                <th className="pb-2.5">Tokens</th>
                <th className="pb-2.5">Est. Cost</th>
                <th className="pb-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {usage?.events && usage.events.length > 0 ? (
                usage.events.map((evt: any) => (
                  <tr key={evt.id} className="hover:bg-slate-950/60 transition">
                    <td className="py-2.5 font-sans text-slate-400 text-[11px]">
                      {new Date(evt.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 text-sky-400 truncate max-w-[120px]">{evt.taskId}</td>
                    <td className="py-2.5 text-slate-200">{evt.routeId}</td>
                    <td className="py-2.5 text-[11px] font-sans capitalize text-slate-400">
                      {evt.costPolicy}
                    </td>
                    <td className="py-2.5">{evt.totalTokens.toLocaleString()}</td>
                    <td className="py-2.5 text-emerald-400">${evt.estimatedCostUSD.toFixed(4)}</td>
                    <td className="py-2.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-400">
                        {evt.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500 font-sans">
                    No transactions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
