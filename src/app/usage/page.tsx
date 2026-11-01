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
      <div className="flex-1 flex items-center justify-center p-12 text-ink-3 text-sm">
        Loading usage ledger...
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="flex-1 max-w-md w-full mx-auto p-8 flex flex-col items-center justify-center text-center">
        <div className="p-6 rounded-2xl bg-surface border border-line/10 text-center space-y-4 shadow-xl w-full">
          <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">Sign In Required</h2>
            <p className="text-xs text-ink-2 mt-1">Please sign in to view your token consumption and budget ledger.</p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs transition shadow-md"
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-line/10 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Usage</h1>
          </div>
          <p className="text-sm text-ink-2 mt-1">
            What Arcwork has cost you, and how close you are to your limits. Free models cost $0.
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
      <div className="bg-surface border border-line/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-ink-2 font-semibold">Monthly budget used</span>
          <span className="text-ink">
            ${monthlySpend.toFixed(2)} of ${monthlyBudget.toFixed(2)}
          </span>
        </div>
        <div className="w-full bg-[#181d2a] rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-2.5 rounded-full transition-all duration-500 ${
              percentUsed > 90 ? 'bg-red-500' : percentUsed > 70 ? 'bg-brand' : 'bg-emerald-500'
            }`}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-ink-3">
          <span>${budgetRemaining.toFixed(2)} left this month</span>
          <span>Resets on 1st of next month</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-line/10 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-ink-2 text-xs">
            <span>Chat requests</span>
            <Activity className="w-4 h-4 text-brand" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">
            {summary?.totalRequests ?? 0}
          </div>
          <div className="text-[11px] text-emerald-400">
            {summary?.successfulRequests ?? 0} succeeded
          </div>
        </div>

        <div className="bg-surface border border-line/10 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-ink-2 text-xs">
            <span>Tokens</span>
            <TrendingUp className="w-4 h-4 text-ink-2" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">
            {(summary?.totalTokens ?? 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-ink-3">Prompt + Completion Tokens</div>
        </div>

        <div className="bg-surface border border-line/10 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-ink-2 text-xs">
            <span>Spent all-time</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">
            ${(summary?.totalEstimatedCostUSD ?? 0).toFixed(2)}
          </div>
          <div className="text-[11px] text-ink-3 font-mono">USD Estimated</div>
        </div>

        <div className="bg-surface border border-line/10 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-ink-2 text-xs">
            <span>Success rate</span>
            <BarChart3 className="w-4 h-4 text-brand" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">
            {summary?.totalRequests
              ? `${Math.round((summary.successfulRequests / summary.totalRequests) * 100)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-ink-3">Across all providers</div>
        </div>
      </div>

      {/* Usage Events Table */}

    </div>
  </div>
  );
}
