'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardPaste, ExternalLink, Loader2, Lock, X, Zap } from 'lucide-react';
import { KEY_CHANNEL, detectProviderFromKey, getKeyProvider, looksLikeCompleteKey, openSidePopup, type KeyProvider } from '@/lib/providers/key-setup';

/**
 * Guided "get a key" flow. The provider's key page opens in a small popup over Shazam (key
 * pages refuse iframes), the steps stay visible here, and the key saves itself the moment a
 * complete one is pasted. OpenRouter connects in one click via OAuth.
 */
export function KeySetupModal({ providerId, onClose, onSaved }: { providerId: string; onClose: () => void; onSaved: (providerId: string) => void }) {
  const p = getKeyProvider(providerId) as KeyProvider;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [done, setDone] = useState(false);
  const [waitingOAuth, setWaitingOAuth] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // OAuth popup reports back on a BroadcastChannel (window.opener is often severed by COOP).
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(KEY_CHANNEL);
      ch.onmessage = (e) => {
        if (e.data?.type !== 'key-connected' || e.data.provider !== providerId) return;
        setWaitingOAuth(false);
        if (e.data.status === 'connected') succeed();
        else setError(e.data.status === 'denied' ? 'Access was not approved. Try again, or paste a key instead.' : 'Could not finish connecting. Try again, or paste a key instead.');
      };
    } catch {
      /* unsupported: user can still paste */
    }
    return () => ch?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  // Coming back from the popup: put the cursor in the paste field.
  useEffect(() => {
    const onFocus = () => opened && !p.oneClick && inputRef.current?.focus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [opened, p.oneClick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function succeed() {
    setDone(true);
    setTimeout(() => onSaved(providerId), 700);
  }

  async function save(value: string, asProvider = providerId) {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: asProvider, apiKey: trimmed }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error || 'Could not save this key.');
      setKey('');
      if (asProvider !== providerId) onSaved(asProvider);
      else succeed();
    } catch {
      setError('Network problem. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function onPasteText(text: string) {
    setKey(text);
    if (looksLikeCompleteKey(providerId, text)) void save(text);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onPasteText(text);
      else setError('Your clipboard is empty. Copy the key first.');
    } catch {
      inputRef.current?.focus();
      setError('Press ⌘V (or Ctrl+V) to paste the key into the box.');
    }
  }

  function openKeyPage() {
    setOpened(true);
    setError(null);
    if (p.oneClick) {
      setWaitingOAuth(true);
      openSidePopup(`/api/v1/oauth/${p.id}/start`, `shazam-${p.id}`);
    } else {
      openSidePopup(p.keyUrl, `shazam-${p.id}`);
    }
  }

  const detected = key.trim() ? detectProviderFromKey(key) : null;
  const mismatch = detected && detected !== providerId ? getKeyProvider(detected) : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="shz-key-title" className="relative w-full max-w-md rounded-t-2xl border border-line/10 bg-surface p-5 shadow-2xl animate-shz-in sm:rounded-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink">
          <X className="h-4 w-4" />
        </button>

        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Check className="h-5 w-5" />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-ink">{p.name} connected</p>
            <p className="mt-1 text-[12px] text-ink-3">Shazam will use it automatically.</p>
          </div>
        ) : (
          <>
            <div className="pr-8">
              <h2 id="shz-key-title" className="text-[15px] font-semibold text-ink">
                Connect {p.name}
                {p.free && <span className="ml-2 rounded-md bg-brand/10 px-1.5 py-0.5 align-middle text-[11px] font-medium text-brand">Free</span>}
              </h2>
              <p className="mt-1 text-[12px] text-ink-2">{p.unlocks}.</p>
            </div>

            <ol className="mt-4 space-y-2.5">
              {p.steps.map((s, i) => (
                <li key={s} className="flex items-start gap-3">
                  <span className={`shz-mono mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${opened && i === 0 ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2'}`}>{i + 1}</span>
                  <span className="text-[13px] text-ink">{s}</span>
                </li>
              ))}
            </ol>

            <button
              onClick={openKeyPage}
              disabled={waitingOAuth}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-60"
            >
              {p.oneClick ? (
                waitingOAuth ? <><Loader2 className="h-4 w-4 animate-spin" /> Waiting for {p.name}…</> : <><Zap className="h-4 w-4" /> Connect {p.name} in one click</>
              ) : (
                <>{opened ? 'Open it again' : `Get my ${p.free ? 'free ' : ''}key`} <ExternalLink className="h-3.5 w-3.5" /></>
              )}
            </button>
            {opened && !p.oneClick && <p className="mt-2 text-center text-[11px] text-ink-3">{p.name} opened in a small window. Come back here when you&apos;ve copied the key.</p>}

            <div className="mt-5">
              <p className="mb-1.5 text-[12px] text-ink-3">{p.oneClick ? 'Or paste a key you already have' : 'Paste your key'}</p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    if (text) {
                      e.preventDefault();
                      onPasteText(text);
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && save(key)}
                  placeholder={p.prefix ? `${p.prefix}` : 'Paste key'}
                  className="shz-mono min-w-0 flex-1 rounded-xl border border-line/10 bg-canvas px-3 py-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none"
                />
                {key.trim() ? (
                  <button disabled={busy} onClick={() => save(key)} className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-40">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                  </button>
                ) : (
                  <button onClick={pasteFromClipboard} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">
                    <ClipboardPaste className="h-3.5 w-3.5" /> Paste
                  </button>
                )}
              </div>
              {busy && <p className="mt-2 text-[12px] text-ink-2">Checking the key with {p.name}…</p>}
              {mismatch && !busy && (
                <p className="mt-2 text-[12px] text-ink-2">
                  That looks like a {mismatch.name} key.{' '}
                  <button onClick={() => save(key, mismatch.id)} className="font-medium text-brand underline-offset-2 hover:underline">Save it as {mismatch.name}</button>
                </p>
              )}
              {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
            </div>

            <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
              <Lock className="mt-px h-3 w-3 shrink-0" />
              <span>We check the key with {p.name} before saving and store it encrypted. It is only used for your requests.{p.note ? ` ${p.note}` : ''}</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
