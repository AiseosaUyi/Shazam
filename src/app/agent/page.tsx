'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Code2,
  FileCode,
  FolderTree,
  FolderPlus,
  Plus,
  Trash2,
  Check,
  X,
  History,
  RotateCcw,
  Sparkles,
  Send,
  Upload,
  FolderDown,
  ChevronDown,
  Layers,
  ArrowUp,
  Square,
  Cpu,
  FileText,
  AlertCircle,
  ShieldAlert,
  Copy,
  ChevronRight,
  SplitSquareVertical,
  CheckCircle2,
} from 'lucide-react';
import { unzipSync } from 'fflate';

// Dynamically import Monaco Editor to avoid SSR window issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-[#090a0f] text-zinc-500 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        Initializing Monaco Editor...
      </div>
    </div>
  ),
});

interface Project {
  id: string;
  name: string;
  description: string | null;
  rootDir: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceFile {
  path: string;
  content: string;
  updatedAt: string;
}

interface Checkpoint {
  id: string;
  description: string;
  createdAt: string;
}

export default function CodingStudioPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');

  // Files & Tabs
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [fileContentMap, setFileContentMap] = useState<Record<string, string>>({});
  const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});

  // Snapshots
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [snapshotDesc, setSnapshotDesc] = useState('');

  // New file modal
  const [newFileModal, setNewFileModal] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');

  // AI Copilot state
  const [agentPrompt, setAgentPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentThought, setAgentThought] = useState('');
  const [agentOutput, setAgentOutput] = useState('');
  const [proposedCode, setProposedCode] = useState<string | null>(null);
  const [proposedTargetFile, setProposedTargetFile] = useState<string | null>(null);

  // Status & loading
  const [loading, setLoading] = useState(true);
  const [bannerMessage, setBannerMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const agentAbortRef = useRef<AbortController | null>(null);

  // Load Projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/projects');
      if (res.status === 401) {
        setBannerMessage({ text: 'Please sign in to access your projects.', type: 'error' });
        setLoading(false);
        return;
      }
      const data = await res.json();
      const list: Project[] = data.projects || [];
      setProjects(list);

      if (list.length > 0) {
        selectProject(list[0]);
      } else {
        // Auto-create a default project for seamless onboarding
        createDefaultProject();
      }
    } catch {
      setLoading(false);
    }
  }

  async function createDefaultProject() {
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Workspace',
          description: 'Default project workspace',
        }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setProjects([data.project]);
        selectProject(data.project);
        // Seed starter file
        await fetch(`/api/v1/projects/${data.project.id}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'src/index.ts',
            content: `// Welcome to Shazam AI Coding Studio!\n// Ask the Co-Work Agent on the right to build features, inspect logic, or refactor.\n\nexport function main() {\n  console.log("Shazam AI Web IDE is live!");\n}\n\nmain();\n`,
          }),
        });
        loadProjectFiles(data.project.id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function selectProject(proj: Project) {
    setCurrentProject(proj);
    setProjectMenuOpen(false);
    setOpenTabs([]);
    setActiveTab(null);
    setFileContentMap({});
    await loadProjectFiles(proj.id);
  }

  async function loadProjectFiles(projectId: string) {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/files`);
      const data = await res.json();
      if (res.ok) {
        const fileList: WorkspaceFile[] = data.files || [];
        setFiles(fileList);

        const contentMap: Record<string, string> = {};
        fileList.forEach((f) => {
          contentMap[f.path] = f.content;
        });
        setFileContentMap(contentMap);

        if (fileList.length > 0 && openTabs.length === 0) {
          openFileInTab(fileList[0].path);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName.trim(),
          description: newProjectDesc.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setProjects((prev) => [data.project, ...prev]);
        selectProject(data.project);
        setNewProjectModal(false);
        setNewProjectName('');
        setNewProjectDesc('');
        setBannerMessage({ text: `Project "${data.project.name}" created!`, type: 'success' });
      }
    } catch {
      // ignore
    }
  }

  async function handleDeleteProject(projId: string) {
    if (!confirm('Are you sure you want to delete this project and all its files?')) return;
    try {
      await fetch(`/api/v1/projects/${projId}`, { method: 'DELETE' });
      const remaining = projects.filter((p) => p.id !== projId);
      setProjects(remaining);
      if (currentProject?.id === projId) {
        if (remaining.length > 0) {
          selectProject(remaining[0]);
        } else {
          setCurrentProject(null);
          setFiles([]);
          setOpenTabs([]);
          setActiveTab(null);
        }
      }
      setBannerMessage({ text: 'Project deleted.', type: 'success' });
    } catch {
      // ignore
    }
  }

  function openFileInTab(path: string) {
    if (!openTabs.includes(path)) {
      setOpenTabs((prev) => [...prev, path]);
    }
    setActiveTab(path);
  }

  function closeTab(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    const nextTabs = openTabs.filter((t) => t !== path);
    setOpenTabs(nextTabs);
    if (activeTab === path) {
      setActiveTab(nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null);
    }
  }

  function handleEditorChange(newVal: string | undefined) {
    if (!activeTab || newVal === undefined || !currentProject) return;

    // Update local state immediately
    setFileContentMap((prev) => ({ ...prev, [activeTab]: newVal }));
    setSavedStatus((prev) => ({ ...prev, [activeTab]: false }));

    // Debounced persist to D1 (800ms)
    if (saveTimeoutRef.current[activeTab]) {
      clearTimeout(saveTimeoutRef.current[activeTab]);
    }

    saveTimeoutRef.current[activeTab] = setTimeout(async () => {
      try {
        await fetch(`/api/v1/projects/${currentProject.id}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeTab, content: newVal }),
        });
        setSavedStatus((prev) => ({ ...prev, [activeTab]: true }));
      } catch {
        // error
      }
    }, 800);
  }

  async function handleCreateFile(e: React.FormEvent) {
    e.preventDefault();
    if (!newFilePath.trim() || !currentProject) return;

    const path = newFilePath.trim();
    try {
      const res = await fetch(`/api/v1/projects/${currentProject.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '' }),
      });
      if (res.ok) {
        setFiles((prev) => [...prev, { path, content: '', updatedAt: new Date().toISOString() }]);
        setFileContentMap((prev) => ({ ...prev, [path]: '' }));
        openFileInTab(path);
        setNewFileModal(false);
        setNewFilePath('');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create file');
      }
    } catch {
      // ignore
    }
  }

  async function handleDeleteFile(filePath: string) {
    if (!currentProject || !confirm(`Delete file "${filePath}"?`)) return;
    try {
      await fetch(`/api/v1/projects/${currentProject.id}/files?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      });
      setFiles((prev) => prev.filter((f) => f.path !== filePath));
      closeTab({ stopPropagation: () => {} } as any, filePath);
    } catch {
      // ignore
    }
  }

  // Native File System Access API: Pick local directory from disk
  async function handlePickLocalDirectory() {
    if (!currentProject) return;
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the Directory Picker API. Please use "Upload ZIP" instead.');
      return;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const filesToUpload: Array<{ path: string; content: string }> = [];

      async function scanDir(handle: any, prefix = '') {
        for await (const entry of handle.values()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
          }
          if (entry.kind === 'file') {
            try {
              const file = await entry.getFile();
              if (file.size < 250 * 1024) {
                const text = await file.text();
                filesToUpload.push({
                  path: prefix ? `${prefix}/${entry.name}` : entry.name,
                  content: text,
                });
              }
            } catch {
              // skip binary or unreadable
            }
          } else if (entry.kind === 'directory') {
            await scanDir(entry, prefix ? `${prefix}/${entry.name}` : entry.name);
          }
        }
      }

      await scanDir(dirHandle);

      if (filesToUpload.length === 0) {
        alert('No readable text files found in selected folder.');
        return;
      }

      const res = await fetch(`/api/v1/projects/${currentProject.id}/files/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToUpload.slice(0, 150) }),
      });
      const data = await res.json();
      if (res.ok) {
        await loadProjectFiles(currentProject.id);
        setBannerMessage({ text: `Imported ${data.importedCount} files from folder!`, type: 'success' });
      }
    } catch {
      // user cancelled
    }
  }

  // Handle Drag & Drop of ZIP or folder
  async function handleDropFiles(e: React.DragEvent) {
    e.preventDefault();
    if (!currentProject) return;

    const droppedFiles = Array.from(e.dataTransfer.files);
    const zipFile = droppedFiles.find((f) => f.name.endsWith('.zip'));

    if (zipFile) {
      try {
        const buffer = await zipFile.arrayBuffer();
        const unzipped = unzipSync(new Uint8Array(buffer));
        const filesToUpload: Array<{ path: string; content: string }> = [];

        for (const [rawPath, bytes] of Object.entries(unzipped)) {
          if (rawPath.endsWith('/') || rawPath.includes('__MACOSX') || rawPath.includes('node_modules')) {
            continue;
          }
          if (bytes.length < 250 * 1024) {
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              filesToUpload.push({ path: rawPath, content: text });
            } catch {
              // skip non-text
            }
          }
        }

        if (filesToUpload.length > 0) {
          const res = await fetch(`/api/v1/projects/${currentProject.id}/files/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesToUpload.slice(0, 150) }),
          });
          const data = await res.json();
          if (res.ok) {
            await loadProjectFiles(currentProject.id);
            setBannerMessage({ text: `Imported ${data.importedCount} files from ZIP!`, type: 'success' });
          }
        }
      } catch {
        alert('Failed to parse dropped ZIP file.');
      }
    }
  }

  // Autonomous Co-Work Agent execution
  async function handleSendAgentPrompt(presetPrompt?: string) {
    const textToSend = (presetPrompt || agentPrompt).trim();
    if (!textToSend || isStreaming) return;

    setAgentPrompt('');
    setIsStreaming(true);
    setAgentThought('');
    setAgentOutput('');
    setProposedCode(null);
    setProposedTargetFile(null);

    const controller = new AbortController();
    agentAbortRef.current = controller;

    // Inject active file context into prompt
    const activeCodeContext = activeTab && fileContentMap[activeTab]
      ? `\n\n[Active Open File: ${activeTab}]\n\`\`\`\n${fileContentMap[activeTab].slice(0, 3000)}\n\`\`\``
      : '';

    const enrichedPrompt = `[Workspace Coding Studio]\n${textToSend}${activeCodeContext}`;

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: enrichedPrompt,
          taskClassOverride: 'coding',
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('Agent failed to connect.');

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let fullOutput = '';
      let fullThought = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;
          let eventType = 'message';
          let dataStr = '';

          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }

          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            if (eventType === 'delta') {
              fullOutput += data.text || '';
              setAgentOutput(fullOutput);
            } else if (eventType === 'reasoning') {
              fullThought += data.text || '';
              setAgentThought(fullThought);
            } else if (eventType === 'done') {
              fullOutput = data.fullText || fullOutput;
              setAgentOutput(fullOutput);
            }
          } catch {
            // ignore
          }
        }
      }

      // Check if output contains code block to offer 1-click apply
      const codeMatch = fullOutput.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        setProposedCode(codeMatch[1].trim());
        setProposedTargetFile(activeTab || 'src/index.ts');
      }
    } catch {
      // cancelled or error
    } finally {
      setIsStreaming(false);
      agentAbortRef.current = null;
    }
  }

  // 1-Click apply proposed code to active editor
  async function handleApplyCodeToEditor() {
    if (!proposedCode || !proposedTargetFile || !currentProject) return;

    handleEditorChange(proposedCode);
    setBannerMessage({ text: `Applied changes to ${proposedTargetFile}!`, type: 'success' });
    setProposedCode(null);
  }

  function getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'mjs':
        return 'javascript';
      case 'py':
        return 'python';
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'css':
      case 'scss':
        return 'css';
      case 'sql':
        return 'sql';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'rs':
        return 'rust';
      case 'go':
        return 'go';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'sh':
      case 'bash':
        return 'shell';
      default:
        return 'plaintext';
    }
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-60px)] bg-[#090a0f] text-zinc-100 overflow-hidden">
      {/* Studio Header Bar */}
      <header className="h-12 border-b border-white/[0.08] bg-[#0c0e15]/90 backdrop-blur-xl px-4 flex items-center justify-between shrink-0 z-30">
        {/* Project Switcher */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-semibold text-white transition shadow-sm"
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span className="truncate max-w-[160px] sm:max-w-[220px]">
                {currentProject ? currentProject.name : 'Select Project'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {projectMenuOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 rounded-2xl bg-[#11131c]/95 border border-white/10 shadow-2xl p-2 z-50 text-xs space-y-1 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150">
                <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Projects ({projects.length})
                </div>
                {projects.map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => selectProject(proj)}
                    className={`flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition ${
                      currentProject?.id === proj.id
                        ? 'bg-amber-500/10 text-amber-300 font-medium'
                        : 'text-zinc-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="truncate">{proj.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(proj.id);
                      }}
                      className="p-1 text-zinc-500 hover:text-red-400 rounded transition"
                      title="Delete project"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="pt-1.5 mt-1 border-t border-white/5">
                  <button
                    onClick={() => {
                      setProjectMenuOpen(false);
                      setNewProjectModal(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 flex items-center gap-2 font-medium transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create New Project</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="hidden sm:inline px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            D1 Sandbox Active
          </span>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2">
          {/* Pick local folder button */}
          <button
            onClick={handlePickLocalDirectory}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-300 text-xs font-medium transition"
            title="Open local folder from disk via File System API"
          >
            <FolderDown className="w-3.5 h-3.5 text-blue-400" />
            <span>Open Folder</span>
          </button>

          {/* New file button */}
          <button
            onClick={() => setNewFileModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-300 text-xs font-medium transition"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span>New File</span>
          </button>
        </div>
      </header>

      {/* Banner Notifications */}
      {bannerMessage && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-red-950/40 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{bannerMessage.text}</span>
          </div>
          <button onClick={() => setBannerMessage(null)} className="p-1 hover:opacity-80">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3-Pane Studio Canvas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Project File Tree (20%) */}
        <aside
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropFiles}
          className="w-56 sm:w-64 border-r border-white/[0.08] bg-[#0a0b12]/95 flex flex-col shrink-0 select-none"
        >
          <div className="p-3 border-b border-white/[0.06] flex items-center justify-between text-xs text-zinc-400 font-semibold tracking-wider uppercase text-[10px]">
            <span className="flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-amber-400" /> Files ({files.length})
            </span>
            <button
              onClick={() => setNewFileModal(true)}
              className="p-1 hover:text-white rounded"
              title="Add file"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {files.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-500 space-y-2">
                <p>No files in project.</p>
                <p className="text-[11px] text-zinc-600">Drag & drop a ZIP or click &ldquo;New File&rdquo; above.</p>
              </div>
            ) : (
              files.map((file) => {
                const isActive = activeTab === file.path;
                return (
                  <div
                    key={file.path}
                    onClick={() => openFileInTab(file.path)}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                      isActive
                        ? 'bg-amber-500/10 text-amber-300 font-medium'
                        : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2">
                      <FileCode className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-amber-400' : 'text-zinc-500'}`} />
                      <span className="truncate">{file.path}</span>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.path);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition rounded"
                      title="Delete file"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Drag & Drop Hint */}
          <div className="p-3 border-t border-white/[0.06] bg-black/20 text-center">
            <p className="text-[10px] text-zinc-500">Drop .zip or files here to import</p>
          </div>
        </aside>

        {/* Center Pane: Multi-Tab Monaco Editor (50%) */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#090a0f] overflow-hidden">
          {/* Tab Bar */}
          <div className="h-9 border-b border-white/[0.08] bg-[#0c0e14] flex items-center overflow-x-auto px-2 gap-1 shrink-0 no-scrollbar">
            {openTabs.map((tabPath) => {
              const isActive = activeTab === tabPath;
              const isSaved = savedStatus[tabPath] ?? true;
              return (
                <div
                  key={tabPath}
                  onClick={() => setActiveTab(tabPath)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-mono border-t border-x cursor-pointer transition shrink-0 ${
                    isActive
                      ? 'bg-[#10121a] border-white/10 text-amber-300 font-semibold shadow-sm'
                      : 'bg-transparent border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="truncate max-w-[140px]">{tabPath.split('/').pop()}</span>
                  {!isSaved && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
                  <button
                    onClick={(e) => closeTab(e, tabPath)}
                    className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Active Monaco Editor */}
          {activeTab ? (
            <div className="flex-1 flex flex-col min-h-0 relative">
              <MonacoEditor
                height="100%"
                theme="vs-dark"
                language={getLanguageFromPath(activeTab)}
                value={fileContentMap[activeTab] || ''}
                onChange={handleEditorChange}
                options={{
                  fontSize: 13,
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  cursorBlinking: 'smooth',
                  padding: { top: 12, bottom: 12 },
                }}
              />

              {/* Status footer inside editor */}
              <div className="h-6 border-t border-white/[0.06] bg-[#0a0b10] px-3 flex items-center justify-between text-[11px] font-mono text-zinc-500 shrink-0">
                <div className="flex items-center gap-3">
                  <span>{activeTab}</span>
                  <span>{getLanguageFromPath(activeTab)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {savedStatus[activeTab] === false ? (
                    <span className="text-amber-400">Saving...</span>
                  ) : (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Saved to D1
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-3">
              <FileCode className="w-10 h-10 opacity-30 text-amber-500" />
              <p className="text-sm font-medium">No file open</p>
              <p className="text-xs text-zinc-600 max-w-sm">
                Select a file from the explorer on the left or create one to begin coding.
              </p>
            </div>
          )}
        </main>

        {/* Right Pane: Shazam Co-Work Agent (30%) */}
        <aside className="w-80 sm:w-96 border-l border-white/[0.08] bg-[#0a0b12]/95 flex flex-col shrink-0">
          <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-white">Shazam Co-Work</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Active Context
            </span>
          </div>

          {/* Quick Action Presets */}
          <div className="p-2.5 border-b border-white/[0.06] grid grid-cols-2 gap-1.5">
            {[
              { label: '✦ Refactor & Clean', prompt: 'Refactor the active file for readability, type safety, and optimal performance.' },
              { label: '✦ Explain Code', prompt: 'Explain the architecture, design choices, and flow of this file clearly.' },
              { label: '✦ Write Test Suite', prompt: 'Write comprehensive unit tests covering all functions and edge cases in this file.' },
              { label: '✦ Fix Bugs / Lint', prompt: 'Review this file for security vulnerabilities, syntax bugs, and runtime errors.' },
            ].map((action, idx) => (
              <button
                key={idx}
                onClick={() => handleSendAgentPrompt(action.prompt)}
                disabled={isStreaming || !activeTab}
                className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-left text-[11px] text-zinc-300 hover:text-amber-300 transition disabled:opacity-40"
              >
                {action.label}
              </button>
            ))}
          </div>

          {/* Agent Output & Proposal Review */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs leading-relaxed">
            {/* Thought Drawer */}
            {agentThought && (
              <details className="rounded-xl bg-white/[0.02] border border-white/[0.06] overflow-hidden text-zinc-400">
                <summary className="px-3 py-1.5 cursor-pointer text-[11px] font-mono text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 select-none">
                  <Cpu className="w-3.5 h-3.5 text-amber-400" />
                  <span>Agent Thought Process</span>
                </summary>
                <div className="p-3 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap border-t border-white/[0.06] bg-black/30">
                  {agentThought}
                </div>
              </details>
            )}

            {/* Response Stream */}
            {agentOutput ? (
              <div className="space-y-3">
                <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-zinc-200 whitespace-pre-wrap leading-relaxed text-[13px]">
                  {agentOutput}
                </div>

                {/* 1-Click Apply Code Proposal */}
                {proposedCode && (
                  <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-500/30 space-y-2.5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5" /> Proposed Code Ready
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[120px]">
                        {proposedTargetFile}
                      </span>
                    </div>
                    <button
                      onClick={handleApplyCodeToEditor}
                      className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" /> Apply Code Directly to Editor
                    </button>
                  </div>
                )}
              </div>
            ) : isStreaming ? (
              <div className="p-4 text-center text-zinc-500 space-y-2">
                <span className="inline-block w-2 h-4 bg-amber-400 animate-pulse rounded-sm" />
                <p className="text-xs">Evaluating codebase & generating proposal...</p>
              </div>
            ) : (
              <div className="p-6 text-center text-zinc-500 space-y-2">
                <Sparkles className="w-6 h-6 mx-auto opacity-30 text-amber-400" />
                <p className="text-xs font-medium">Ready to co-work</p>
                <p className="text-[11px] text-zinc-600">
                  Ask questions, request new features, or click an action pill above to inspect the open file.
                </p>
              </div>
            )}
          </div>

          {/* Co-Work Prompt Composer */}
          <div className="p-3 border-t border-white/[0.06] bg-[#0c0e14]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendAgentPrompt();
              }}
              className="relative"
            >
              <textarea
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendAgentPrompt();
                  }
                }}
                rows={2}
                placeholder="Ask Co-Work to write code or modify this file..."
                className="w-full pr-10 p-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 resize-none leading-relaxed"
              />
              <div className="absolute right-2 bottom-3">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (agentAbortRef.current) agentAbortRef.current.abort();
                    }}
                    className="p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition"
                    title="Stop"
                  >
                    <Square className="w-3.5 h-3.5 fill-white" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!agentPrompt.trim()}
                    className="p-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg transition disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </aside>
      </div>

      {/* New Project Modal */}
      {newProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <form
            onSubmit={handleCreateProject}
            className="w-full max-w-md bg-[#12141e] border border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-amber-400" /> Create New Project
              </h3>
              <button
                type="button"
                onClick={() => setNewProjectModal(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Project Name</label>
              <input
                type="text"
                placeholder="e.g. NextJS App, Payment API"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500/60"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Description (Optional)</label>
              <input
                type="text"
                placeholder="Short summary of this codebase"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500/60"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewProjectModal(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl text-xs transition"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New File Modal */}
      {newFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <form
            onSubmit={handleCreateFile}
            className="w-full max-w-sm bg-[#12141e] border border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" /> Create File
              </h3>
              <button
                type="button"
                onClick={() => setNewFileModal(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Relative Path</label>
              <input
                type="text"
                placeholder="src/components/Header.tsx"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500/60"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewFileModal(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl text-xs transition"
              >
                Add File
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
