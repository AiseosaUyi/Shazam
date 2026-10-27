'use client';

import React, { useState, useEffect } from 'react';
import { Sliders, Save, CheckCircle2, Shield, Lock, AlertCircle } from 'lucide-react';
import type { UserPreferences } from '@/lib/types';

export default function SettingsPage() {
  const [pref, setPref] = useState<UserPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Please sign in to view and edit settings.');
        return res.json();
      })
      .then((json) => {
        if (json.preferences) setPref(json.preferences);
      })
      .catch((err) => setError(err.message));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pref) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultCostPolicy: pref.defaultCostPolicy,
          maxCostPerTaskUSD: Number(pref.maxCostPerTaskUSD),
          monthlyBudgetUSD: Number(pref.monthlyBudgetUSD),
          privacyMode: pref.privacyMode,
          autoFallbackEnabled: pref.autoFallbackEnabled,
          allowPaidFallback: pref.allowPaidFallback,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save settings.');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!pref) {
    return (
      <div className="flex-1 max-w-4xl w-full mx-auto p-8">
        {error ? (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm font-mono text-center py-16">Loading settings...</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-white font-mono">Routing & Budget Policies</h1>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
            D1 Policy Engine
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-1">
          Configure default task routing behavior, spend caps, strict privacy, and fallback policies.
        </p>
      </div>

      {saved && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Settings successfully saved.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="bg-[#10131d] border border-[#232736] rounded-xl p-6 shadow-xl space-y-6">
        {/* Cost Policy Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
            Default Cost Policy
          </label>
          <p className="text-xs text-zinc-500">
            Governs candidate filtering and route scoring. Free-only strictly blocks any route with cost or unknown pricing.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {[
              { id: 'free_only', title: 'Free Only', desc: 'Verified $0 routes only. Zero paid API calls guaranteed.' },
              { id: 'lowest_cost', title: 'Lowest Cost', desc: 'Prioritizes free & lowest cost routes while maintaining quality.' },
              { id: 'balanced', title: 'Balanced (Default)', desc: 'Optimizes quality-to-cost ratio for best overall value.' },
              { id: 'best_quality', title: 'Best Quality', desc: 'Picks the highest-rated eligible model regardless of price.' },
              { id: 'manual_pin', title: 'Manual Pin', desc: 'Only runs models you explicitly specify in prompt or pin.' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPref({ ...pref, defaultCostPolicy: p.id as any })}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between ${
                  pref.defaultCostPolicy === p.id
                    ? 'border-amber-500 bg-amber-500/10 text-white'
                    : 'border-[#232736] bg-[#0c0e14] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="text-xs font-semibold">{p.title}</span>
                <span className="text-[10px] text-zinc-500 mt-1">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Financial Ceilings */}
        <div className="pt-4 border-t border-[#1e2333] grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono mb-1">
              Max Cost Per Task (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.001"
              max="50"
              value={pref.maxCostPerTaskUSD}
              onChange={(e) => setPref({ ...pref, maxCostPerTaskUSD: parseFloat(e.target.value) || 0.01 })}
              className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Routes exceeding this ceiling are excluded.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono mb-1">
              Monthly Budget Cap (USD)
            </label>
            <input
              type="number"
              step="1"
              min="1"
              max="5000"
              value={pref.monthlyBudgetUSD}
              onChange={(e) => setPref({ ...pref, monthlyBudgetUSD: parseFloat(e.target.value) || 1.0 })}
              className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Stops paid routing once spend reaches cap.</p>
          </div>
        </div>

        {/* Privacy Mode */}
        <div className="pt-4 border-t border-[#1e2333] space-y-2">
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
            Privacy Mode
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPref({ ...pref, privacyMode: 'standard' })}
              className={`flex-1 p-3 rounded-lg border text-left transition ${
                pref.privacyMode === 'standard'
                  ? 'border-amber-500 bg-amber-500/10 text-white'
                  : 'border-[#232736] bg-[#0c0e14] text-zinc-400'
              }`}
            >
              <div className="text-xs font-semibold">Standard</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Allows free tier routes (including Gemini free tier with training notice).</div>
            </button>
            <button
              type="button"
              onClick={() => setPref({ ...pref, privacyMode: 'strict' })}
              className={`flex-1 p-3 rounded-lg border text-left transition ${
                pref.privacyMode === 'strict'
                  ? 'border-amber-500 bg-amber-500/10 text-white'
                  : 'border-[#232736] bg-[#0c0e14] text-zinc-400'
              }`}
            >
              <div className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Strict Privacy
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Excludes any route where data may be used for model training or training status is unknown.</div>
            </button>
          </div>
        </div>

        {/* Fallback Rules */}
        <div className="pt-4 border-t border-[#1e2333] space-y-3">
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
            Failover Rules
          </label>
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={pref.autoFallbackEnabled}
                onChange={(e) => setPref({ ...pref, autoFallbackEnabled: e.target.checked })}
                className="rounded border-[#232736] bg-[#090b10] text-amber-500 focus:ring-0"
              />
              <span>Enable automatic quota & rate-limit fallback on retryable provider errors</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={pref.allowPaidFallback}
                onChange={(e) => setPref({ ...pref, allowPaidFallback: e.target.checked })}
                className="rounded border-[#232736] bg-[#090b10] text-amber-500 focus:ring-0"
              />
              <span>Allow fallback to alternate paid routes when a paid route exhausts quota</span>
            </label>
            <p className="text-[11px] text-zinc-500 pl-6">
              Note: Free-only requests NEVER fall back to paid routes regardless of this setting.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-[#1e2333] flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg transition flex items-center gap-1.5 shadow-md disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </form>
    </div>
  );
}
