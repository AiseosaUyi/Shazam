'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, Power, CheckCircle2, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import type { Provider, CatalogRoute } from '@/lib/types';

export default function AdminPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [routes, setRoutes] = useState<CatalogRoute[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, overRes, auditRes] = await Promise.all([
        fetch('/api/v1/catalog'),
        fetch('/api/v1/admin/overrides'),
        fetch('/api/v1/admin/audit'),
      ]);

      if (overRes.status === 403 || auditRes.status === 403) {
        throw new Error('Access Denied: Admin role required to view this page.');
      }
      if (overRes.status === 401 || auditRes.status === 401) {
        throw new Error('Please sign in with an admin account.');
      }

      const catJson = await catRes.json();
      const overJson = await overRes.json();
      const auditJson = await auditRes.json();

      setProviders(catJson.providers || []);
      setRoutes(catJson.routes || []);
      setOverrides(overJson.overrides || []);
      setAuditEvents(auditJson.auditEvents || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleOverride = async (targetType: 'provider' | 'route', targetId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled';
    try {
      const res = await fetch('/api/v1/admin/overrides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          status: nextStatus,
          reason: `Admin toggle to ${nextStatus}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update kill switch.');

      setActionStatus(`Updated ${targetType} "${targetId}" to ${nextStatus}.`);
      setTimeout(() => setActionStatus(null), 3000);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (error) {
    return (
      <div className="flex-1 max-w-4xl w-full mx-auto p-8 flex items-center justify-center">
        <div className="bg-[#10131d] border border-red-900/50 rounded-xl p-6 text-center space-y-3">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
          <h2 className="text-base font-bold text-white font-mono">Restricted Area</h2>
          <p className="text-xs text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }

  const overrideMap = new Map(overrides.map((o) => [`${o.targetType}:${o.targetId}`, o.status]));

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#232736] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono">Admin Control Center</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-950 text-amber-400 border border-amber-800">
              ROLE: ADMIN
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Global provider and route kill switches, tenant audit log inspection, and security events.
          </p>
        </div>

        <button
          onClick={loadData}
          className="px-3 py-1.5 rounded-lg bg-[#141824] border border-[#232736] text-xs text-zinc-300 hover:text-white flex items-center gap-1.5 transition self-start"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {actionStatus && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {actionStatus}
        </div>
      )}

      {/* Provider Kill Switches */}
      <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold font-mono text-white flex items-center gap-2">
          <Power className="w-4 h-4 text-amber-500" /> Provider Kill Switches
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {providers.map((p) => {
            const overrideStatus = overrideMap.get(`provider:${p.id}`);
            const effectiveStatus = overrideStatus || p.defaultStatus;
            const isEnabled = effectiveStatus === 'enabled';

            return (
              <div
                key={p.id}
                className="p-3.5 rounded-lg bg-[#141824] border border-[#232736] flex items-center justify-between"
              >
                <div>
                  <h4 className="text-xs font-bold text-white">{p.name}</h4>
                  <p className="text-[10px] font-mono text-zinc-400">ID: {p.id}</p>
                </div>
                <button
                  onClick={() => handleToggleOverride('provider', p.id, effectiveStatus)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition flex items-center gap-1.5 ${
                    isEnabled
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800 hover:bg-red-950 hover:text-red-400 hover:border-red-800'
                      : 'bg-red-950 text-red-400 border border-red-800 hover:bg-emerald-950 hover:text-emerald-400 hover:border-emerald-800'
                  }`}
                >
                  <Power className="w-3 h-3" />
                  {isEnabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold font-mono text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-500" /> Security & Admin Audit Log ({auditEvents.length})
        </h2>

        {auditEvents.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-xs font-mono">No audit events recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="border-b border-[#232736] text-[11px] uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 font-semibold">Timestamp</th>
                  <th className="pb-3 font-semibold">Action</th>
                  <th className="pb-3 font-semibold">Actor</th>
                  <th className="pb-3 font-semibold">Target</th>
                  <th className="pb-3 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b1f2e] text-zinc-300">
                {auditEvents.map((ev: any) => (
                  <tr key={ev.id} className="hover:bg-[#141824] transition">
                    <td className="py-2.5 text-zinc-400 text-[11px]">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 font-semibold text-zinc-100">{ev.action}</td>
                    <td className="py-2.5 text-zinc-400 truncate max-w-[120px]">{ev.actor_id}</td>
                    <td className="py-2.5 text-zinc-300">
                      {ev.target_type}: {ev.target_id}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          ev.outcome === 'success'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-red-950 text-red-400 border border-red-800'
                        }`}
                      >
                        {ev.outcome}
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
  );
}
