'use client';

import React from 'react';
import { ArrowUp, Square, ChevronDown, Cpu, Folder, Paperclip } from 'lucide-react';
import { AgentSuggestion } from '@/components/AgentSuggestion';
import type { Model } from '@/lib/types';
import { ModelDropdown } from '@/components/home/ModelDropdown';
import type { ProjectItem } from '@/components/home/HomeHero';

interface ChatComposerProps {
  prompt: string;
  setPrompt: (v: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleSend: () => void;
  handleStop: () => void;
  isStreaming: boolean;
  selectedProject: ProjectItem | null;
  projectDropdownOpen: boolean;
  setProjectDropdownOpen: (v: boolean) => void;
  modelDropdownOpen: boolean;
  setModelDropdownOpen: (v: boolean) => void;
  models: Model[];
  connectedProviders: Record<string, boolean>;
  pinnedModelName: string;
  setPinnedModelName: (v: string) => void;
  getModelButtonLabel: () => string;
}

export function ChatComposer({
  prompt, setPrompt, textareaRef, fileInputRef, handleSend, handleStop, isStreaming,
  selectedProject, projectDropdownOpen, setProjectDropdownOpen, modelDropdownOpen, setModelDropdownOpen,
  models, connectedProviders, pinnedModelName, setPinnedModelName, getModelButtonLabel,
}: ChatComposerProps) {
  return (
  <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-canvas via-canvas/90 to-transparent pointer-events-none">
    <div className="max-w-3xl mx-auto pointer-events-auto relative">
      <AgentSuggestion prompt={prompt} current="chat" />
      <div className="shz-composer p-3 sm:p-3.5">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder={
            pinnedModelName?.toLowerCase().includes('banana') || pinnedModelName?.toLowerCase().includes('imagen')
              ? "Describe an image to generate with Google Nano Banana (e.g. Cyberpunk samurai in neon Lagos)..."
              : pinnedModelName?.toLowerCase().includes('flux')
              ? "Describe an image to generate with FLUX.1 (e.g. Cyberpunk samurai in neon Tokyo rain)..."
              : 'Ask anything, or describe an image to create…'
          }
          className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none resize-none leading-relaxed max-h-48"
        />

        <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-line/[0.06]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg hover:bg-line/5 text-ink-2 hover:text-ink"
              title="Attach file"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
              className="text-xs text-ink-2 hover:text-ink flex items-center gap-1"
            >
              <Folder className="w-3.5 h-3.5 text-ink-2" />
              <span>{selectedProject ? selectedProject.name : 'Context'}</span>
            </button>

            <div className="h-3 w-px bg-line/10" />

            <div className="relative">
              <button
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-line/10 bg-line/[0.03] hover:bg-line/[0.06] text-ink-2 text-xs transition"
              >
                <Cpu className="w-3.5 h-3.5 text-ink-2" />
                <span className="font-mono truncate max-w-[130px]">
                  {getModelButtonLabel()}
                </span>
                <ChevronDown className="w-3 h-3 text-ink-3" />
              </button>

              {modelDropdownOpen && (
                <ModelDropdown
                  models={models}
                  connectedProviders={connectedProviders}
                  pinnedModelName={pinnedModelName}
                  setPinnedModelName={setPinnedModelName}
                  onClose={() => setModelDropdownOpen(false)}
                />
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-2 bg-red-600 hover:bg-red-500 text-ink rounded-xl transition shadow-md"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!prompt.trim()}
                className="p-2 bg-brand hover:bg-brand-soft text-brand-ink font-semibold rounded-xl transition shadow-md disabled:opacity-30"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
