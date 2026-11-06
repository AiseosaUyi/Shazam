'use client';

import React from 'react';
import {
  ArrowUp, ChevronDown, Plus, Cpu, X, FileText, Folder, FolderOpen,
} from 'lucide-react';
import { SystemStrip } from '@/components/SystemStrip';
import { AgentSuggestion } from '@/components/AgentSuggestion';
import type { Model } from '@/lib/types';
import { ModelDropdown } from '@/components/home/ModelDropdown';

export interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
}

interface HomeHeroProps {
  greeting: string;
  prompt: string;
  setPrompt: (v: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleSend: () => void;
  handleConnectFolder: () => void;
  attachedDocs: Array<{ name: string; content: string }>;
  setAttachedDocs: React.Dispatch<React.SetStateAction<Array<{ name: string; content: string }>>>;
  connectedFolder: { name: string; files: Array<{ path: string; content: string }> } | null;
  setConnectedFolder: (v: null) => void;
  projects: ProjectItem[];
  selectedProject: ProjectItem | null;
  setSelectedProject: (p: ProjectItem | null) => void;
  projectDropdownOpen: boolean;
  setProjectDropdownOpen: (v: boolean) => void;
  attachMenuOpen: boolean;
  setAttachMenuOpen: (v: boolean) => void;
  modelDropdownOpen: boolean;
  setModelDropdownOpen: (v: boolean) => void;
  models: Model[];
  connectedProviders: Record<string, boolean>;
  pinnedModelName: string;
  setPinnedModelName: (v: string) => void;
  getModelButtonLabel: () => string;
}

export function HomeHero({
  greeting, prompt, setPrompt, textareaRef, fileInputRef, handleSend, handleConnectFolder,
  attachedDocs, setAttachedDocs, connectedFolder, setConnectedFolder,
  projects, selectedProject, setSelectedProject, projectDropdownOpen, setProjectDropdownOpen,
  attachMenuOpen, setAttachMenuOpen, modelDropdownOpen, setModelDropdownOpen,
  models, connectedProviders, pinnedModelName, setPinnedModelName, getModelButtonLabel,
}: HomeHeroProps) {
  return (
    <div className="shz-atmosphere -mx-8 -mt-6 h-full flex flex-col items-center justify-center text-center px-8 space-y-8 pt-10 pb-20 [&>*]:w-full [&>*]:max-w-2xl">
      {/* Center Editorial Greeting */}
      <div className="space-y-3">
        <p className="shz-mono text-[11px] tracking-[0.2em] text-brand/80">{greeting}</p>
        <h1 className="text-[30px] font-semibold tracking-[-0.025em] text-ink">What are we making today?</h1>
        <SystemStrip show={['models', 'desktop', 'google']} />
      </div>

      {/* Main Input Box (Matching User's Screenshot Exactly) */}
      <div className="w-full relative">
        <div className="shz-composer p-4 space-y-3">
          {/* Attached Context Capsules */}
          {(attachedDocs.length > 0 || connectedFolder || selectedProject) && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {selectedProject && (
                <span className="px-2.5 py-1 rounded-lg bg-brand/10 border border-brand/20 text-brand-soft text-xs flex items-center gap-1.5">
                  <Folder className="w-3 h-3" />
                  <span>{selectedProject.name}</span>
                  <button onClick={() => setSelectedProject(null)} className="hover:text-ink">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {connectedFolder && (
                <span className="px-2.5 py-1 rounded-lg bg-line/[0.05] border border-line/10 text-ink-2 text-xs flex items-center gap-1.5">
                  <FolderOpen className="w-3 h-3 text-brand" />
                  <span>{connectedFolder.name} ({connectedFolder.files.length} files)</span>
                  <button onClick={() => setConnectedFolder(null)} className="hover:text-ink">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {attachedDocs.map((doc, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded-lg bg-line/[0.05] border border-line/10 text-ink-2 text-xs flex items-center gap-1.5"
                >
                  <FileText className="w-3 h-3 text-emerald-400" />
                  <span>{doc.name}</span>
                  <button
                    onClick={() => setAttachedDocs((prev) => prev.filter((_, i) => i !== idx))}
                    className="hover:text-ink"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <AgentSuggestion prompt={prompt} current="chat" />
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
            rows={2}
            placeholder={
              pinnedModelName?.toLowerCase().includes('flux')
                ? "Describe an image to generate with FLUX.1 (e.g. Cyberpunk samurai in neon Tokyo rain)..."
                : 'Ask anything, or describe an image to create…'
            }
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none resize-none leading-relaxed"
          />

          {/* Inner Bar: "+" attach button on left, model & send on right */}
          <div className="flex items-center justify-between pt-2 border-t border-line/[0.06] text-xs">
            <div className="relative">
              <button
                type="button"
                onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                className="p-1.5 rounded-lg bg-line/[0.04] hover:bg-line/[0.08] text-ink-2 hover:text-ink transition flex items-center gap-1"
                title="Add context (Document, Project, Folder)"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Attach Popover */}
              {attachMenuOpen && (
                <div className="absolute left-0 bottom-full mb-2 w-56 rounded-xl bg-surface border border-line/10 shadow-2xl p-1.5 space-y-1 z-30 text-xs">
                  <button
                    onClick={() => {
                      fileInputRef.current?.click();
                      setAttachMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-line/5 text-ink-2 flex items-center gap-2 transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Upload Document / File</span>
                  </button>

                  <button
                    onClick={handleConnectFolder}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-line/5 text-ink-2 flex items-center gap-2 transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-brand" />
                    <span>Connect Local Folder</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!prompt.trim()}
                className="p-2 bg-brand hover:bg-brand-soft disabled:opacity-30 text-brand-ink font-semibold rounded-xl transition shadow-md flex items-center justify-center"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>

        {/* Sub-bar Below Composer (Matching Screenshot): Project or folder selector & Model Pill */}
        <div className="flex items-center justify-between px-2 pt-3 text-xs text-ink-2">
          <div className="relative">
            <button
              onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
              className="flex items-center gap-1.5 text-ink-2 hover:text-ink transition"
            >
              <Folder className="w-3.5 h-3.5 text-brand" />
              <span>{selectedProject ? selectedProject.name : 'Project or folder'}</span>
              <ChevronDown className="w-3 h-3 text-ink-3" />
            </button>

            {/* Projects Dropdown Menu */}
            {projectDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-surface border border-line/10 shadow-2xl p-1.5 space-y-1 z-30 text-xs">
                <button
                  onClick={() => {
                    setSelectedProject(null);
                    setProjectDropdownOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-line/5 text-ink-2 flex items-center gap-2"
                >
                  <span>None (General Chat)</span>
                </button>

                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    onClick={() => {
                      setSelectedProject(proj);
                      setProjectDropdownOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-line/5 text-ink-2 flex items-center gap-2 truncate"
                  >
                    <Folder className="w-3.5 h-3.5 text-brand shrink-0" />
                    <span className="truncate">{proj.name}</span>
                  </button>
                ))}

                <div className="border-t border-line/5 pt-1 mt-1">
                  <button
                    onClick={() => {
                      setProjectDropdownOpen(false);
                      handleConnectFolder();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-line/5 text-brand-soft flex items-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Connect local folder...</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">

            {/* Model Dropdown Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-line/10 bg-line/[0.03] hover:bg-line/[0.06] text-ink-2 text-xs transition"
              >
                <Cpu className="w-3.5 h-3.5 text-ink-2" />
                <span className="font-mono truncate max-w-[140px]">
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
        </div>
      </div>
    </div>
  );
}
