'use client';

import Link from 'next/link';
import { Layers, X, Check, Copy, FileText, Folder } from 'lucide-react';

export interface ArtifactItem {
  path: string;
  content: string;
  updated_at?: string;
}

export function ArtifactsModal({
  artifactsList,
  selectedArtifact,
  setSelectedArtifact,
  loadingArtifacts,
  copiedId,
  setCopiedId,
  onClose,
}: {
  artifactsList: ArtifactItem[];
  selectedArtifact: { path: string; content: string } | null;
  setSelectedArtifact: (a: { path: string; content: string } | null) => void;
  loadingArtifacts: boolean;
  copiedId: string | null;
  setCopiedId: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-surface border border-line/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-line/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center text-brand">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Workspace Artifacts</h3>
              <p className="text-[11px] text-ink-2">
                Files, code proposals, and assets generated in your sessions.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              onClose();
              setSelectedArtifact(null);
            }}
            className="p-1.5 rounded-lg hover:bg-line/5 text-ink-2 hover:text-ink transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loadingArtifacts ? (
            <div className="py-12 text-center text-xs text-ink-3">
              <span className="inline-block w-2 h-2 rounded-full bg-brand animate-ping mr-2" />
              Loading workspace artifacts...
            </div>
          ) : selectedArtifact ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedArtifact(null)}
                  className="text-xs text-brand hover:underline flex items-center gap-1"
                >
                  ← Back to Artifacts list
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedArtifact.content);
                    setCopiedId('artifact-copied');
                    setTimeout(() => setCopiedId(null), 2000);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-line/5 hover:bg-line/10 text-xs text-ink-2 flex items-center gap-1 transition"
                >
                  {copiedId === 'artifact-copied' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedId === 'artifact-copied' ? 'Copied' : 'Copy Content'}</span>
                </button>
              </div>
              <div className="p-3 bg-black/50 border border-line/5 rounded-xl font-mono text-xs text-ink overflow-x-auto max-h-96 whitespace-pre">
                {selectedArtifact.content}
              </div>
            </div>
          ) : artifactsList.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-line/[0.03] border border-line/5 flex items-center justify-center mx-auto text-ink-3">
                <FileText className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-ink-2">No workspace artifacts saved yet</p>
              <p className="text-[11px] text-ink-3 max-w-sm mx-auto">
                When you use Code Studio or Co-Work to write code and generate documents, your saved files will appear here.
              </p>
              <Link
                href="/agent"
                onClick={() => onClose()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs transition shadow-sm"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Open Code Studio</span>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-line/[0.04]">
              {artifactsList.map((art, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedArtifact(art)}
                  className="py-2.5 px-3 rounded-xl hover:bg-line/[0.04] cursor-pointer flex items-center justify-between transition group"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText className="w-4 h-4 text-brand shrink-0" />
                    <span className="text-xs font-mono text-ink group-hover:text-brand-soft truncate">
                      {art.path}
                    </span>
                  </div>
                  <span className="text-[10px] text-ink-3 shrink-0">
                    {art.content.length} bytes · Click to view →
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
