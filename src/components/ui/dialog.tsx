'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

/**
 * App-wide dialogs that replace window.alert / confirm / prompt with branded, accessible
 * modals: `const dialog = useDialog(); if (await dialog.confirm({...})) …`
 */

interface BaseOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}
interface PromptOptions extends BaseOptions {
  placeholder?: string;
  defaultValue?: string;
}
type Request =
  | { kind: 'confirm'; opts: BaseOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: BaseOptions; resolve: () => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

interface DialogApi {
  confirm: (opts: BaseOptions) => Promise<boolean>;
  alert: (opts: BaseOptions) => Promise<void>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const api: DialogApi = {
    confirm: useCallback((opts) => new Promise<boolean>((resolve) => setReq({ kind: 'confirm', opts, resolve })), []),
    alert: useCallback((opts) => new Promise<void>((resolve) => setReq({ kind: 'alert', opts, resolve })), []),
    prompt: useCallback((opts) => new Promise<string | null>((resolve) => {
      setValue(opts.defaultValue || '');
      setReq({ kind: 'prompt', opts, resolve });
    }), []),
  };

  const close = useCallback((ok: boolean) => {
    if (!req) return;
    if (req.kind === 'confirm') req.resolve(ok);
    else if (req.kind === 'alert') req.resolve();
    else req.resolve(ok ? value : null);
    setReq(null);
  }, [req, value]);

  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => (req.kind === 'prompt' ? inputRef.current?.focus() : confirmRef.current?.focus()), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [req, close]);

  const danger = req?.opts.tone === 'danger';

  return (
    <DialogContext.Provider value={api}>
      {children}
      {req && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => close(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="shz-dialog-title" className="relative w-full max-w-sm rounded-2xl border border-line/10 bg-surface p-5 shadow-2xl animate-shz-in">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-red-500/10 text-red-300' : 'bg-brand/10 text-brand'}`}>
                {danger ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="shz-dialog-title" className="text-sm font-semibold text-ink">{req.opts.title}</h2>
                {req.opts.body && <div className="mt-1 text-[13px] leading-relaxed text-ink-2">{req.opts.body}</div>}
              </div>
            </div>
            {req.kind === 'prompt' && (
              <form onSubmit={(e) => { e.preventDefault(); close(true); }}>
                <input
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={req.opts.placeholder}
                  className="mt-4 w-full rounded-xl border border-line/10 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand/50 focus:outline-none"
                />
              </form>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {req.kind !== 'alert' && (
                <button onClick={() => close(false)} className="rounded-xl px-3.5 py-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                  {req.opts.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                ref={confirmRef}
                onClick={() => close(true)}
                className={`rounded-xl px-3.5 py-2 text-[13px] font-semibold ${danger ? 'bg-red-500 text-ink hover:bg-red-400' : 'bg-brand text-brand-ink hover:bg-brand-soft'}`}
              >
                {req.opts.confirmLabel || (req.kind === 'alert' ? 'OK' : 'Continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
