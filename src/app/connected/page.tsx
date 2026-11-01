'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, AlertTriangle } from 'lucide-react';
import { KEY_CHANNEL } from '@/lib/providers/key-setup';

/** Landing page for connect popups: tells the Shazam tab what happened, then closes itself. */
function Connected() {
  const params = useSearchParams();
  const provider = params.get('provider') || '';
  const status = params.get('status') || 'error';
  const ok = status === 'connected';

  useEffect(() => {
    try {
      const ch = new BroadcastChannel(KEY_CHANNEL);
      ch.postMessage({ type: 'key-connected', provider, status });
      ch.close();
    } catch {
      /* older browsers: the opener also refreshes on focus */
    }
    if (ok) {
      const t = setTimeout(() => window.close(), 900);
      return () => clearTimeout(t);
    }
  }, [provider, status, ok]);

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 py-16 text-center">
      <div className="max-w-xs">
        <div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl ${ok ? 'bg-brand/10 text-brand' : 'bg-red-500/10 text-red-300'}`}>
          {ok ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <h1 className="mt-4 text-[18px] font-semibold text-ink">{ok ? 'Connected' : status === 'denied' ? 'Not connected' : 'Something went wrong'}</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          {ok ? 'You can close this window and go back to Shazam.' : status === 'denied' ? 'Access was not approved. Close this window to try again.' : 'We could not finish connecting. Close this window and try again, or paste a key instead.'}
        </p>
        <button onClick={() => window.close()} className="mt-5 rounded-xl px-3.5 py-2 text-[13px] text-ink-2 ring-1 ring-line/10 hover:bg-surface-2 hover:text-ink">
          Close window
        </button>
      </div>
    </div>
  );
}

export default function ConnectedPage() {
  return (
    <Suspense>
      <Connected />
    </Suspense>
  );
}
