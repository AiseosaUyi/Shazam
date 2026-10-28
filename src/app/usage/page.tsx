'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart3, TrendingUp, DollarSign, Activity, AlertCircle, Lock } from 'lucide-react';

export default function UsagePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/usage')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load usage data. Sign in may be required.');
        return res.json();
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-zinc-500 text-sm">
        Loading usage ledger...
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="flex-1 max-w-md w-full mx-auto p-8 flex flex-col items-center justify-center text-center">
        <div className="p-6 rounded-2xl bg-[#10131d] border border-white/10 text-center space-y-4 shadow-xl w-full">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Sign In Required</h2>
            <p className="text-xs text-zinc-400 mt-1">Please sign in to view your token consumption and budget ledger.</p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition shadow-md"
          >
            Sign In to View Ledger
          </Link>
        </div>
      </div>
    );
  }

  const summary = data?.summary;
  const monthlyBudget = data?.monthlyBudgetUSD ?? 10.0;
  const monthlySpend = data?.monthlySpendUSD ?? 0.0;
  const budgetRemaining = data?.budgetRemainingUSD ?? 10.0;
  const percentUsed = Math.min(100, (monthlySpend / (monthlyBudget || 1)) * 100);

  return (
    <div className="flex-1 h-full min-h-0 overflow-y-auto">
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#232736] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono">Usage Ledger</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
              D1 Append-Only Ledger
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Exact token counts, cost classification (zero, estimated, unknown), and monthly budget consumption.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Monthly Budget Bar */}
      <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-400 font-semibold">MONTHLY BUDGET CONSUMPTION</span>
          <span className="text-zinc-200">
            ${monthlySpend.toFixed(4)} / ${monthlyBudget.toFixed(2)} USD ({percentUsed.toFixed(1)}%)
          </span>
        </div>
        <div className="w-full bg-[#181d2a] rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-2.5 rounded-full transition-all duration-500 ${
              percentUsed > 90 ? 'bg-red-500' : percentUsed > 70 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-zinc-500">
          <span>Remaining: ${budgetRemaining.toFixed(4)} USD</span>
          <span>Resets on 1st of next month</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Total Invocations</span>
            <Activity className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {summary?.totalRequests ?? 0}
          </div>
          <div className="text-[11px] text-emerald-400">
            {summary?.successfulRequests ?? 0} succeeded
          </div>
        </div>

        <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Total Tokens</span>
            <TrendingUp className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {(summary?.totalTokens ?? 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-zinc-500">Prompt + Completion Tokens</div>
        </div>

        <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>All-time Cost</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            ${(summary?.totalEstimatedCostUSD ?? 0).toFixed(4)}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">USD Estimated</div>
        </div>

        <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Success Rate</span>
            <BarChart3 className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {summary?.totalRequests
              ? `${Math.round((summary.successfulRequests / summary.totalRequests) * 100)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-zinc-500">Across all providers</div>
        </div>
      </div>

      {/* Usage Events Table */}
      <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold font-mono text-white">Recent Execution Events</h3>

        {loading ? (
          <div className="text-center py-10 text-zinc-500 text-xs font-mono">Loading events...</div>
        ) : summary?.recentEvents?.length === 0 ? (
          <div className="text-center py-10 text-zinc-500 text-xs">No execution events recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#232736] text-[11px] font-mono uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 font-semibold">Time</th>
                  <th className="pb-3 font-semibold">Task</th>
                  <th className="pb-3 font-semibold">Route</th>
                  <th className="pb-3 font-semibold">Policy</th>
                  <th className="pb-3 font-semibold">Tokens</th>
                  <th className="pb-3 font-semibold">Cost</th>
                  <th className="pb-3 font-semibold">Latency</th>
                  <th className="pb-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b1f2e] text-zinc-300 font-mono">
                {summary?.recentEvents?.map((ev: any) => (
                  <tr key={ev.id} className="hover:bg-[#141824] transition">
                    <td className="py-2.5 text-zinc-400 text-[11px]">
                      {new Date(ev.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 capitalize">{ev.task_class}</td>
                    <td className="py-2.5 text-zinc-200">
                      <div>{ev.model_id}</div>
                      <div className="text-[10px] text-zinc-500">{ev.provider_id}</div>
                    </td>
                    <td className="py-2.5 text-zinc-400 text-[11px]">{ev.cost_policy}</td>
                    <td className="py-2.5">
                      <div>{(ev.prompt_tokens + ev.completion_tokens).toLocaleString()}</div>
                      <div className="text-[10px] text-zinc-500">{ev.tokens_kind}</div>
                    </td>
                    <td className="py-2.5">
                      {ev.cost_kind === 'zero' ? (
                        <span className="text-emerald-400">$0.00</span>
                      ) : ev.cost_kind === 'unknown' ? (
                        <span className="text-amber-400">unknown</span>
                      ) : (
                        <span>${Number(ev.cost_usd).toFixed(4)}</span>
                      )}
                    </td>
                    <td className="py-2.5 text-zinc-400">{ev.latency_ms ? `${ev.latency_ms}ms` : '—'}</td>
                    <td className="py-2.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          ev.status === 'succeeded'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-red-950 text-red-400 border border-red-800'
                        }`}
                      >
                        {ev.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  </div>
  );
}
