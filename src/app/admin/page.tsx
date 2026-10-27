'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, Power, CheckCircle2, AlertTriangle, Activity, Lock } from 'lucide-react';
import { Provider } from '@/types/provider';
import { AuditEvent } from '@/types/user';

export default function AdminPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const res = await fetch('/api/v1/providers');
      const json = await res.json();
      if (json.success) setProviders(json.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleKillSwitch = async (providerId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled';
    try {
      const res = await fetch(`/api/v1/admin/providers/${providerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (json.success) {
        setActionStatus(`Provider ${providerId} status changed to ${nextStatus}.`);
        setTimeout(() => setActionStatus(null), 3000);
        loadData();
      }
    } catch (e: any) {
      setActionStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-rose-400" />
          Administrative Control Center & Kill Switches
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Operational control, provider emergency kill switches, and security audit log inspection.
        </p>
      </div>

      {actionStatus && (
        <div className="p-3.5 rounded-xl bg-sky-950/40 border border-sky-800 text-sky-300 text-xs">
          {actionStatus}
        </div>
      )}

      {/* Provider Kill Switches Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Power className="w-4 h-4 text-sky-400" />
          Global Provider Kill Switches
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="pb-3">Provider</th>
                <th className="pb-3">Category</th>
                <th className="pb-3">Last Verified</th>
                <th className="pb-3">Operational Status</th>
                <th className="pb-3 text-right">Emergency Switch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans text-slate-300">
              {providers.map((p) => (
                <tr key={p.id} className="hover:bg-slate-950/40 transition">
                  <td className="py-3 font-bold text-white">{p.name}</td>
                  <td className="py-3 capitalize text-slate-400">{p.category}</td>
                  <td className="py-3 font-mono text-[11px] text-slate-400">
                    {new Date(p.lastVerifiedAt).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        p.status === 'enabled'
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                          : p.status === 'degraded'
                          ? 'bg-amber-950/80 text-amber-400 border border-amber-800'
                          : 'bg-rose-950/80 text-rose-400 border border-rose-800'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => handleToggleKillSwitch(p.id, p.status)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        p.status === 'enabled'
                          ? 'bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300'
                          : 'bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-300'
                      }`}
                    >
                      {p.status === 'enabled' ? 'Kill Route' : 'Restore Route'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
