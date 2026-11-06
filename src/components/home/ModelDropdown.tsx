'use client';

import { Check, Palette, Sparkles, Zap } from 'lucide-react';
import type { Model } from '@/lib/types';

export function ModelDropdown({
  models,
  connectedProviders,
  pinnedModelName,
  setPinnedModelName,
  onClose,
}: {
  models: Model[];
  connectedProviders: Record<string, boolean>;
  pinnedModelName: string;
  setPinnedModelName: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 bottom-full mb-2 w-72 max-h-80 overflow-y-auto rounded-2xl bg-[#12131a] border border-line/10 shadow-2xl p-2 space-y-1 z-50 text-xs font-sans backdrop-blur-2xl">
      <div className="px-2 py-0.5 text-[10px] font-semibold text-ink-3">
        Intelligent Routing
      </div>

      <button
        type="button"
        onClick={() => {
          setPinnedModelName('');
          try { localStorage.removeItem('shazam_pinned_model'); } catch {}
          onClose();
        }}
        className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
          !pinnedModelName ? 'bg-line/10 text-ink font-medium border border-line/15' : 'text-ink-2 hover:bg-line/5'
        }`}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-ink-2" />
          <div>
            <div className="font-medium text-ink">Auto Routing</div>
            <div className="text-[10px] text-ink-3">Automatically routes per task</div>
          </div>
        </div>
        <span className="text-[10px] text-ink-2 font-mono shrink-0 ml-1">
          {connectedProviders['google'] ? 'Gemini Ready' : 'Auto'}
        </span>
      </button>

      <div className="border-t border-line/5 my-1" />
      <div className="px-2 py-0.5 text-[10px] font-semibold text-ink-3">
        Image Generation
      </div>

      <button
        type="button"
        onClick={() => {
          const target = 'Google Nano Banana 2.1';
          setPinnedModelName(target);
          try { localStorage.setItem('shazam_pinned_model', target); } catch {}
          onClose();
        }}
        className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
          pinnedModelName?.toLowerCase().includes('banana') || pinnedModelName?.toLowerCase().includes('imagen')
            ? 'bg-line/10 text-ink font-medium border border-line/15'
            : 'text-ink-2 hover:bg-line/5'
        }`}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-ink-2 shrink-0" />
          <div className="truncate">
            <div className="font-medium text-ink truncate">Google Nano Banana 2.1</div>
            <div className="text-[10px] text-ink-3 truncate">AI Studio key with billing (no free tier)</div>
          </div>
        </div>
        <span className="text-[10px] text-ink-2 font-mono shrink-0 ml-1">
          BYOK · paid
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          const target = 'FLUX.1 Schnell (Free)';
          setPinnedModelName(target);
          try { localStorage.setItem('shazam_pinned_model', target); } catch {}
          onClose();
        }}
        className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
          pinnedModelName?.toLowerCase().includes('flux')
            ? 'bg-line/10 text-ink font-medium border border-line/15'
            : 'text-ink-2 hover:bg-line/5'
        }`}
      >
        <div className="flex items-center gap-2">
          <Palette className="w-3.5 h-3.5 text-ink-2 shrink-0" />
          <div className="truncate">
            <div className="font-medium text-ink truncate">FLUX.1 Schnell</div>
            <div className="text-[10px] text-ink-3 truncate">Free · Fast · No Key Needed</div>
          </div>
        </div>
        <span className="text-[10px] text-ink-2 font-mono shrink-0 ml-1">
          Free
        </span>
      </button>

      <div className="border-t border-line/5 my-1" />
      <div className="px-2 py-0.5 text-[10px] font-semibold text-ink-3">
        Google Gemini
      </div>

      {models
        .filter((m) => (m.providerModelId?.includes('gemini') || m.id.includes('gemini') || m.name.toLowerCase().includes('gemini')) && m.outputModality !== 'image')
        .map((m) => {
          const isModelConnected = connectedProviders['google'];
          const isPinned = pinnedModelName === m.name;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setPinnedModelName(m.name);
                try { localStorage.setItem('shazam_pinned_model', m.name); } catch {}
                onClose();
              }}
              className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition truncate ${
                isPinned ? 'bg-line/10 text-ink font-medium border border-line/15' : 'text-ink-2 hover:bg-line/5'
              }`}
            >
              <span className="truncate text-ink">{m.name}</span>
              {isModelConnected && (
                <span className="text-[9px] text-ink-2 font-mono shrink-0 ml-1 flex items-center gap-0.5">
                  <Check className="w-2.5 h-2.5" /> Connected
                </span>
              )}
            </button>
          );
        })}

      {models.some((m) => m.providerId === 'ollama') && (
        <>
          <div className="border-t border-line/5 my-1" />
          <div className="px-2 py-0.5 text-[10px] font-semibold text-ink-3">
            Local Compute
          </div>
          {models
            .filter((m) => m.providerId === 'ollama')
            .map((m) => {
              const isPinned = pinnedModelName === m.name;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setPinnedModelName(m.name);
                    try { localStorage.setItem('shazam_pinned_model', m.name); } catch {}
                    onClose();
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition truncate ${
                    isPinned ? 'bg-line/10 text-ink font-medium border border-line/15' : 'text-ink-2 hover:bg-line/5'
                  }`}
                >
                  <span className="truncate text-ink">{m.name}</span>
                  <span className="text-[9px] text-ink-2 font-mono">Local</span>
                </button>
              );
            })}
        </>
      )}
    </div>
  );
}
