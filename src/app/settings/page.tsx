'use client';

import React, { useState, useEffect } from 'react';
import { Sliders, Save, CheckCircle2, Shield, Lock } from 'lucide-react';
import { UserPreference } from '@/types/user';

export default function SettingsPage() {
  const [pref, setPref] = useState<UserPreference | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setPref(json.data);
      });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pref) return;

    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pref),
      });
      const json = await res.json();
      if (json.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!pref) return null;

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Sliders className="w-6 h-6 text-sky-400" />
          Routing Policies & Cost Limits
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure default cost policy, spend ceilings, privacy sensitivity, and failover behavior.
        </p>
      </div>

      {saved && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Preferences successfully saved to account.
        </div>
      )}

      <form onSubmit={handleSave} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Default Cost Policy
            </label>
            <select
              value={pref.defaultCostPolicy}
              onChange={(e) => setPref({ ...pref, defaultCostPolicy: e.target.value as any })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-sky-400 font-bold focus:outline-none focus:border-sky-500"
            >
              <option value="balanced">Balanced (Optimal balance between quality and cost)</option>
              <option value="free_only">Free Only (Strict $0 guarantee, zero paid calls)</option>
              <option value="lowest_cost">Lowest Cost (Prioritize cheapest capable route)</option>
              <option value="best_quality">Best Quality (Maximum evaluation benchmark ratings)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Used when no per-task override is specified in the task composer.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Max Spend Per Task ($ USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={pref.maxCostPerTaskUSD}
                onChange={(e) => setPref({ ...pref, maxCostPerTaskUSD: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Tasks projected over this cap are blocked.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Monthly Budget Ceiling ($ USD)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={pref.monthlyBudgetUSD}
                onChange={(e) => setPref({ ...pref, monthlyBudgetUSD: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Total spend warning & enforcement ceiling.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Privacy Mode
            </label>
            <select
              value={pref.privacyMode}
              onChange={(e) => setPref({ ...pref, privacyMode: e.target.value as any })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="standard">Standard (Allows public aggregator routes and opt-in free tiers)</option>
              <option value="high">High (Excludes models that train on inputs; requires zero retention)</option>
              <option value="strict">Strict (Only private enterprise BYOK routes permitted)</option>
            </select>
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-slate-800">
            <div>
              <span className="text-xs font-bold text-white block">Resilient Auto-Fallback</span>
              <span className="text-[11px] text-slate-400">
                Automatically failover to the next compatible route on 429 rate limit or outage.
              </span>
            </div>
            <input
              type="checkbox"
              checked={pref.autoFallbackEnabled}
              onChange={(e) => setPref({ ...pref, autoFallbackEnabled: e.target.checked })}
              className="w-4 h-4 rounded text-sky-600 bg-slate-950 border-slate-800 focus:ring-0 cursor-pointer"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-500/20 flex items-center gap-1.5 transition"
          >
            <Save className="w-4 h-4" />
            Save Preferences
          </button>
        </div>
      </form>
    </div>
  );
}
