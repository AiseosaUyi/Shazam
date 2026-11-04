'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

/* ── types matching GET /api/v1/local-ai ─────────────────── */

interface LocalAIStatus {
  connected: boolean;
  error?: string;
  ollama?: { running: boolean; version: string };
  models?: Array<{ name: string; sizeGB: number }>;
  hardware?: { ramGB: number };
  recommended?: { model: string; sizeGB: number; reason: string };
}

type DownloadPhase = 'idle' | 'pulling' | 'progress' | 'setting_up' | 'ready' | 'error';

function isModelInstalled(modelName: string, installedModels: Array<{ name: string; sizeGB: number }>): boolean {
  return (installedModels || []).some(
    (m) => m.name === modelName || m.name === `${modelName}:latest`,
  );
}

/* ──────────────────────────────────────────────────────────── */

export function LocalAICard() {
  const [status, setStatus] = useState<LocalAIStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('idle');
  const [progressData, setProgressData] = useState({ completed: 0, total: 1 });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preferLocalModel, setPreferLocalModel] = useState(true);
  const [settingLoading, setSettingLoading] = useState(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── load status (poll every 15 s) ─────────────────────── */

  async function loadStatus() {
    try {
      const res = await fetch('/api/v1/local-ai');
      if (!res.ok) return;
      const data: LocalAIStatus = await res.json();
      setStatus(data);
      setChecking(false);
    } catch {
      setChecking(false);
    }
  }

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  /* ── load settings (once) ──────────────────────────────── */

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((r) => r.json())
      .then(
        (data: { preferences?: { preferLocalModel?: boolean } }) =>
          setPreferLocalModel(data?.preferences?.preferLocalModel ?? true),
      )
      .catch(() => setPreferLocalModel(true));
  }, []);

  /* ── unmount: clear any polling timer ──────────────────── */

  useEffect(() => () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); }, []);

  /* ── POST start ─────────────────────────────────────────── */

  async function handleStartOllama() {
    setStartError(null);
    try {
      const res = await fetch('/api/v1/local-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data?.error) { setStartError(data.error); return; }
    } catch {
      setStartError('Failed to start Ollama. Please try again.');
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
    loadStatus();
  }

  /* ── download flow ─────────────────────────────────────── */

  async function handleDownload(modelName: string) {
    // Guard: clear any stale timer so retries never stack
    stopPolling();
    setDownloadPhase('pulling');
    setDownloadError(null);

    let pullErrorText: string | undefined;

    try {
      const res = await fetch('/api/v1/local-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', model: modelName }),
      });
      if (!res.ok) {
        try {
          const errBody = await res.json();
          pullErrorText = errBody?.error;
        } catch {}
        throw new Error('Pull failed.');
      }
    } catch {
      setDownloadPhase('error');
      setDownloadError(pullErrorText ?? 'Download failed. Try again; it resumes.');
      return;
    }

    setDownloadPhase('progress');

    let doneFlag = false;

    function stopPolling() {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }

    async function poll() {
      if (doneFlag) return;
      try {
        const res = await fetch('/api/v1/local-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pull-progress', model: modelName }),
        });

        // Parse the actual response shape from the API
        const body = await res.json() as { result?: { status?: string; completed?: number; total?: number; error?: string }; error?: string };
        const data = body?.result ?? {};

        // If HTTP-level failure, show the error text
        if (!res.ok) {
          setDownloadError(body.error ?? 'Download failed. Try again; it resumes.');
          doneFlag = true;
          setDownloadPhase('error');
          stopPolling();
          return;
        }

        const st = data?.status ?? '';
        const pollError = data?.error;

        if (pollError || st === 'error') {
          setDownloadError(pollError ?? 'Download failed. Try again; it resumes.');
          doneFlag = true;
          setDownloadPhase('error');
          stopPolling();
          return;
        }

        setProgressData({ completed: data?.completed ?? 0, total: data?.total ?? 1 });

        if (st === 'success') {
          stopPolling();
          doneFlag = true;
          setDownloadPhase('setting_up');
          try {
            const cRes = await fetch('/api/v1/local-ai', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create', model: modelName }),
            });
            const cBody = await cRes.json() as { result?: string; error?: string };
            if (!cRes.ok || cBody?.error) {
              setDownloadError(cBody.error ?? 'Download failed. Try again; it resumes.');
              doneFlag = true;
              setDownloadPhase('error');
              return;
            }
          } catch {
            setDownloadError('Download failed. Try again; it resumes.');
            doneFlag = true;
            setDownloadPhase('error');
            return;
          }
          setDownloadPhase('ready');
          loadStatus();
        }
      } catch {
        // In-flight error during polling
        if (!doneFlag) {
          setDownloadError('Download failed. Try again; it resumes.');
          doneFlag = true;
          setDownloadPhase('error');
          stopPolling();
        }
      }
    }

    await poll();
    if (!doneFlag) progressTimerRef.current = setInterval(poll, 1500);
  }

  /* ── settings toggle (optimistic) ──────────────────────── */

  async function handleSettingChange(value: boolean) {
    // Optimistic: set BEFORE the PATCH
    const previousValue = preferLocalModel;
    setPreferLocalModel(value);
    setSettingLoading(true);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferLocalModel: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure
      setPreferLocalModel(!value);
    } finally {
      setSettingLoading(false);
    }
  }

  /* ── derived values ─────────────────────────────────────── */

  const installed = status?.models ?? [];
  const recommended = status?.recommended;
  const recommendInstalled = recommended && isModelInstalled(recommended.model, installed);

  /* ── render: "not connected" (connected === false) ──────── */

  if (checking) {
    return (
      <div id="local-ai" className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">Local AI</p>
          <p className="text-xs text-ink-2 mt-1 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Checking your computer…
          </p>
        </div>
      </div>
    );
  }

  if (status && !status.connected) {
    return (
      <div id="local-ai" className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">Local AI</p>
          <p className="text-xs text-ink-2 mt-1">Run a free, private model on your own computer. No usage limits, and your code never leaves your machine.</p>
        </div>
        <p className="text-xs text-ink-2">Connect your computer first.</p>
        <a href="/connect" className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink">
          Connect your computer
        </a>
      </div>
    );
  }

  /* ── render: connected but bridge error (no ollama) ─────── */

  if (status?.ollama === undefined) {
    return (
      <div id="local-ai" className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">Local AI</p>
          <p className="text-xs text-ink-2 mt-1">Run a free, private model on your own computer. No usage limits, and your code never leaves your machine.</p>
        </div>
        <div>
          <p className="text-[11px] text-red-400">{status?.error ?? 'Something went wrong.'}</p>
          <button onClick={loadStatus} className="mt-2 px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink">
            Try again
          </button>
        </div>
      </div>
    );
  }

  /* ── render: ollama not running ─────────────────────────── */

  if (!status.ollama.running) {
    return (
      <div id="local-ai" className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">Local AI</p>
          <p className="text-xs text-ink-2 mt-1">Run a free, private model on your own computer. No usage limits, and your code never leaves your machine.</p>
        </div>
        <div>
          <p className="text-xs text-ink-2">Ollama isn&apos;t running.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleStartOllama}
              className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-soft text-brand-ink text-xs font-semibold"
            >
              Start Ollama
            </button>
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink"
            >
              Install Ollama
            </a>
          </div>
          {startError && <p className="mt-2 text-[11px] text-red-400">{startError}</p>}
        </div>
      </div>
    );
  }

  /* ── render: ollama running ─────────────────────────────── */

  const version = status.ollama.version;
  const ramGB = status.hardware?.ramGB;

  return (
    <div id="local-ai" className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
      {/* Title */}
      <div>
        <p className="text-sm font-semibold text-ink">Local AI</p>
        <p className="text-xs text-ink-2 mt-1">Run a free, private model on your own computer. No usage limits, and your code never leaves your machine.</p>
      </div>

      {/* Status hint */}
      <p className="text-[11px] text-ink-3">
        Ollama {version} &middot; {ramGB ?? 0} GB memory
      </p>

      {/* Installed models */}
      <div>
        {installed.length === 0 && (
          <p className="text-[11px] text-ink-3">No models yet.</p>
        )}
        <ul className="space-y-1">
          {installed.map((m) => (
            <li key={m.name} className="flex items-center gap-2 text-xs text-ink-2">
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              {m.name} ({m.sizeGB} GB)
            </li>
          ))}
        </ul>
      </div>

      {/* Recommendation + download */}
      {recommended && !recommendInstalled && (
        <div className="space-y-2">
          <p className="text-xs text-ink-2">
            Recommended for this computer:{' '}
            <strong>{recommended.model}</strong> ({recommended.sizeGB} GB). {recommended.reason}
          </p>
          {downloadPhase === 'idle' && (
            <button
              onClick={() => handleDownload(recommended.model)}
              className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-soft text-brand-ink text-xs font-semibold"
            >
              Download {recommended.model}
            </button>
          )}
          {(downloadPhase === 'pulling' || downloadPhase === 'progress') && (
            <>
              <div className="h-1.5 rounded-full bg-line/10 overflow-hidden">
                <div
                  style={{ width: `${(progressData.total > 0 ? Math.min(100, Math.round((progressData.completed / progressData.total) * 100)) : 0)}%` }}
                  className="h-full rounded-full bg-brand transition-all duration-300"
                />
              </div>
              <p className="text-[11px] text-ink-3">
                Downloading… {downloadPhase === 'pulling' ? '0%' : `${Math.min(100, Math.round((progressData.completed / progressData.total) * 100))}%`}
              </p>
            </>
          )}
          {downloadPhase === 'setting_up' && (
            <p className="text-[11px] text-ink-3 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Setting up…
            </p>
          )}
          {downloadPhase === 'ready' && (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
              <Check className="w-3 h-3" /> Ready. Arcwork will use {recommended.model} on this computer.
            </p>
          )}
          {downloadPhase === 'error' && (
            <div className="space-y-2">
              <p className="text-[11px] text-red-400">Download failed.</p>
              {downloadError && <p className="text-[11px] text-red-400">{downloadError}</p>}
              <button
                onClick={() => handleDownload(recommended.model)}
                className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toggle row */}
      <div className="pt-2 border-t border-line/[0.06]">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={preferLocalModel}
            disabled={settingLoading}
            onChange={(e) => handleSettingChange(e.target.checked)}
            className="rounded border-line/30 bg-canvas text-brand focus:ring-brand"
          />
          <div>
            <span className="text-xs text-ink-2">Use my local model first</span>
            <p className="text-[11px] text-ink-3">
              When off, Arcwork uses cloud models first and keeps your local model as a backup.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
