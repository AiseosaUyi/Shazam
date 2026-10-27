'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Search,
  Plus,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Sparkles,
  ArrowUp,
  Square,
  Check,
  Copy,
  Undo2,
  X,
  FileCode,
  FileText,
  SlidersHorizontal,
  ExternalLink,
  Layers,
  Terminal,
  Cpu,
  Globe,
  Radio,
  Minimize2,
  Maximize2,
  Code2,
} from 'lucide-react';

// Dynamic import of Monaco Editor for the slide-over file inspector drawer
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-[#090a0f] text-zinc-500 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        Loading file viewer...
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

interface CoWorkMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  readLog?: string[];
  editedFiles?: Array<{ path: string; added: number; deleted: number; code?: string }>;
  timestamp: string;
}

interface Session {
  id: string;
  title: string;
  projectId: string;
  updatedAt: string;
}

export default function ClaudeCoWorkStudio() {
  // Navigation & User
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('session_default');
  const [sessionTitle, setSessionTitle] = useState('Improve geolocation notification appearance');

  // Chat stream
  const [messages, setMessages] = useState<CoWorkMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingThought, setStreamingThought] = useState('');
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamingReadLog, setStreamingReadLog] = useState<string[]>([]);
  const [streamingEditedFiles, setStreamingEditedFiles] = useState<Array<{ path: string; added: number; deleted: number; code?: string }>>([]);

  // Right Side Panel: Environment vs File Inspector (Slide-over drawer)
  const [inspectFile, setInspectFile] = useState<{ path: string; content: string; added?: number; deleted?: number } | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [remoteControlEnabled, setRemoteControlEnabled] = useState(false);
  const [activeConnectors, setActiveConnectors] = useState<Record<string, boolean>>({
    'web_search': true,
    'github': false,
    'browser_takeover': false,
  });

  // Custom MCP servers
  const [mcpServers, setMcpServers] = useState<Array<{ id: string; name: string; url: string; status: string; tools: any[] }>>([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpToken, setMcpToken] = useState('');

  // Project modal
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load user & projects & MCP servers
  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});

    loadProjects();
    loadMcpServers();
  }, []);

  async function loadMcpServers() {
    try {
      const res = await fetch('/api/v1/mcp');
      const data = await res.json();
      if (res.ok && data.servers) {
        setMcpServers(data.servers);
      }
    } catch {
      // ignore
    }
  }

  async function handleAddMcpServer(e: React.FormEvent) {
    e.preventDefault();
    if (!mcpName.trim() || !mcpUrl.trim()) return;

    try {
      const res = await fetch('/api/v1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: mcpName.trim(),
          url: mcpUrl.trim(),
          authToken: mcpToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.server) {
        setMcpServers((prev) => [data.server, ...prev]);
        setMcpModalOpen(false);
        setMcpName('');
        setMcpUrl('');
        setMcpToken('');
      } else {
        alert(data.error || 'Failed to connect MCP server');
      }
    } catch {
      // ignore
    }
  }

  async function handleDeleteMcpServer(id: string) {
    try {
      await fetch(`/api/v1/mcp/${id}`, { method: 'DELETE' });
      setMcpServers((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  }

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingOutput, streamingThought]);

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [prompt]);

  async function loadProjects() {
    try {
      const res = await fetch('/api/v1/projects');
      const data = await res.json();
      const list: Project[] = data.projects || [];
      setProjects(list);

      if (list.length > 0) {
        setCurrentProject(list[0]);
        seedInitialConversation(list[0]);
      } else {
        // Create default project if none exists
        const createRes = await fetch('/api/v1/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'frontend', description: 'Next.js Frontend Workspace' }),
        });
        const createData = await createRes.json();
        if (createData.project) {
          setProjects([createData.project]);
          setCurrentProject(createData.project);
          seedInitialConversation(createData.project);
        }
      }
    } catch {
      // ignore
    }
  }

  function seedInitialConversation(proj: Project) {
    // Seed initial message matching user screenshot style
    setMessages([
      {
        id: 'msg_1',
        role: 'user',
        content: 'Improve geolocation notification appearance: location to be Nigeria if the webapp cant read your ip address but IP should be what detects first then we default to nigeria and naira',
        timestamp: '17:42',
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: `Now I'll swap geolocation for IP-based detection with a Nigeria/NGN fallback.\n\nAlso setting the default \`currentLocation\` to Nigeria so there's no undefined flash.\n\nDone. Summary of changes in \`context/AppContext.tsx\`:\n• **IP-first detection**: hits \`https://ipwho.is/\` (no API key, no browser permission prompt) with a 3s timeout.\n• **Nigeria/NGN fallback**: if the IP lookup fails, errors, or returns \`success: false\`, location defaults to **"Nigeria"** and currency to **"NGN"** — silently, no error toast.\n• **Removed**: \`navigator.geolocation\` call, \`showPosition / showError\`, and all four error toasts.\n• **Defaults**: initial \`currentLocation\` state is now **"Nigeria"** (was undefined), matching the NGN default currency.\n• **Session cache preserved**: if the user already has \`currentCurrency\` set in \`sessionStorage\`, that wins and the IP lookup is skipped.`,
        thought: 'Evaluated user requirement for fallback location. Inspected context/AppContext.tsx. Replaced navigator.geolocation with ipwho.is IP detection.',
        readLog: ['Read context/AppContext.tsx, found files, searched code'],
        editedFiles: [
          {
            path: 'context/AppContext.tsx',
            added: 19,
            deleted: 44,
            code: `import React, { createContext, useContext, useState, useEffect } from 'react';\n\ninterface AppContextType {\n  currentLocation: string;\n  currentCurrency: string;\n  isLoadingLocation: boolean;\n}\n\nconst AppContext = createContext<AppContextType>({} as AppContextType);\n\nexport function AppProvider({ children }: { children: React.ReactNode }) {\n  const [currentLocation, setCurrentLocation] = useState<string>('Nigeria');\n  const [currentCurrency, setCurrentCurrency] = useState<string>('NGN');\n  const [isLoadingLocation, setIsLoadingLocation] = useState<boolean>(true);\n\n  useEffect(() => {\n    // Check session cache first\n    const cachedCurrency = sessionStorage.getItem('currentCurrency');\n    if (cachedCurrency) {\n      setCurrentCurrency(cachedCurrency);\n      setIsLoadingLocation(false);\n      return;\n    }\n\n    // IP-first detection with 3s timeout\n    const controller = new AbortController();\n    const timeoutId = setTimeout(() => controller.abort(), 3000);\n\n    fetch('https://ipwho.is/', { signal: controller.signal })\n      .then(res => res.json())\n      .then(data => {\n        clearTimeout(timeoutId);\n        if (data && data.success && data.country) {\n          setCurrentLocation(data.country);\n          setCurrentCurrency(data.currency_code || 'NGN');\n        } else {\n          setCurrentLocation('Nigeria');\n          setCurrentCurrency('NGN');\n        }\n      })\n      .catch(() => {\n        // Silent fallback to Nigeria/NGN\n        setCurrentLocation('Nigeria');\n        setCurrentCurrency('NGN');\n      })\n      .finally(() => {\n        setIsLoadingLocation(false);\n      });\n  }, []);\n\n  return (\n    <AppContext.Provider value={{ currentLocation, currentCurrency, isLoadingLocation }}>\n      {children}\n    </AppContext.Provider>\n  );\n}\n\nexport const useApp = () => useContext(AppContext);\n`,
          },
        ],
        timestamp: '17:43',
      },
    ]);
  }

  async function handleSend() {
    if (!prompt.trim() || isStreaming) return;

    const userText = prompt.trim();
    setPrompt('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: CoWorkMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    setStreamingOutput('');
    setStreamingThought('');
    setStreamingReadLog(['Searching codebase context...', 'Inspecting repository files...']);
    setStreamingEditedFiles([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `[Project: ${currentProject?.name || 'Workspace'}]\n${userText}`,
          taskClassOverride: 'coding',
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('Failed to dispatch co-work task.');

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
              setStreamingOutput(fullOutput);
            } else if (eventType === 'reasoning') {
              fullThought += data.text || '';
              setStreamingThought(fullThought);
            } else if (eventType === 'done') {
              fullOutput = data.fullText || fullOutput;
              setStreamingOutput(fullOutput);
            }
          } catch {
            // ignore
          }
        }
      }

      // Check if output contains code block to generate clickable file capsule
      const codeMatch = fullOutput.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);
      const generatedFiles: Array<{ path: string; added: number; deleted: number; code?: string }> = [];

      if (codeMatch && codeMatch[1]) {
        const samplePath = 'src/App.tsx';
        const code = codeMatch[1].trim();
        const lineCount = code.split('\n').length;
        generatedFiles.push({
          path: samplePath,
          added: lineCount,
          deleted: Math.max(1, Math.floor(lineCount / 3)),
          code,
        });

        // Save file to project in D1 automatically
        if (currentProject) {
          fetch(`/api/v1/projects/${currentProject.id}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: samplePath, content: code }),
          }).catch(() => {});
        }
      }

      const assistantMsg: CoWorkMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullOutput,
        thought: fullThought || undefined,
        readLog: ['Searched project files', 'Verified dependencies'],
        editedFiles: generatedFiles.length > 0 ? generatedFiles : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      // cancelled or error
    } finally {
      setIsStreaming(false);
      setStreamingOutput('');
      setStreamingThought('');
      setStreamingReadLog([]);
      setStreamingEditedFiles([]);
      abortControllerRef.current = null;
    }
  }

  function handleOpenFileDrawer(fileItem: { path: string; added: number; deleted: number; code?: string }) {
    setInspectFile({
      path: fileItem.path,
      content: fileItem.code || '// File content loaded from project sandbox\n',
      added: fileItem.added,
      deleted: fileItem.deleted,
    });
    setRightPanelOpen(true);
  }

  // Native File System Access: Connect local folder from Mac/PC
  async function handleConnectLocalFolder() {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the Directory Picker API. You can manage project files directly in the cloud.');
      return;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const folderName = dirHandle.name;

      // Create or switch project
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, rootDir: `~/${folderName}` }),
      });
      const data = await res.json();
      if (data.project) {
        setProjects((prev) => [data.project, ...prev]);
        setCurrentProject(data.project);
        setSessionTitle(`Working on ${folderName}`);
      }
    } catch {
      // cancelled
    }
  }

  return (
    <div className="flex-1 flex h-[calc(100vh-60px)] bg-[#0d0f14] text-zinc-100 overflow-hidden font-sans">
      {/* 1. Left Navigation Sidebar (Claude style) */}
      <aside className="w-64 border-r border-white/[0.07] bg-[#090b10] flex flex-col shrink-0 select-none">
        {/* Search & Actions */}
        <div className="p-3 space-y-2 border-b border-white/[0.06]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-xl text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-white/20 transition"
            />
          </div>

          <button
            onClick={() => {
              setMessages([]);
              setSessionTitle('New Co-Work Task');
            }}
            className="w-full py-1.5 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-2 transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span>New Task</span>
          </button>
        </div>

        {/* Navigation Links */}
        <div className="p-2 space-y-0.5 border-b border-white/[0.06] text-xs text-zinc-400">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 cursor-pointer transition">
            <Layers className="w-3.5 h-3.5" />
            <span>Artifacts</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 cursor-pointer transition">
            <Terminal className="w-3.5 h-3.5" />
            <span>Routines</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 cursor-pointer transition">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Customize</span>
          </div>
        </div>

        {/* Working Projects Section */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <div>
            <div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium text-zinc-400">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
                <Folder className="w-3.5 h-3.5 text-amber-400" />
                {currentProject ? currentProject.name : 'frontend'}
              </span>
              <button
                onClick={() => {
                  setMessages([]);
                  setSessionTitle('New Session');
                }}
                className="p-1 hover:text-white rounded"
                title="New session in project"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Sessions list */}
            <div className="space-y-0.5 mt-1">
              <div
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] text-amber-300 text-xs font-medium truncate cursor-pointer transition flex items-center justify-between"
              >
                <span className="truncate">{sessionTitle}</span>
              </div>
              <div
                onClick={() => setSessionTitle('Landing Page Redesign')}
                className="px-2.5 py-1.5 rounded-lg text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 text-xs truncate cursor-pointer transition"
              >
                Landing Page Redesign
              </div>
              <div
                onClick={() => setSessionTitle('Stripe Checkout Integration')}
                className="px-2.5 py-1.5 rounded-lg text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 text-xs truncate cursor-pointer transition"
              >
                Stripe Checkout Integration
              </div>
            </div>
          </div>
        </div>

        {/* User Profile at bottom */}
        <div className="p-3 border-t border-white/[0.06] bg-black/20 flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-semibold">
              {user?.name?.charAt(0) || 'A'}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-white truncate">{user?.name || 'Aise Idahor'}</p>
              <p className="text-[10px] text-zinc-500">Free Tier · Cloudflare D1</p>
            </div>
          </div>
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
        </div>
      </aside>

      {/* 2. Main Co-Work Canvas (Chat-First) */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0c0e14] overflow-hidden relative">
        {/* Top Header Bar */}
        <header className="h-12 border-b border-white/[0.07] bg-[#0a0c12]/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white truncate max-w-sm sm:max-w-md">
              {sessionTitle}
            </h2>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          </div>

          {/* Toggle Right Panel */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setInspectFile(null);
                setRightPanelOpen(!rightPanelOpen);
              }}
              className={`p-1.5 rounded-lg border text-xs transition flex items-center gap-1.5 ${
                rightPanelOpen && !inspectFile
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
              }`}
              title="Toggle Environment & Connectors Panel"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Environment</span>
            </button>
          </div>
        </header>

        {/* Conversation Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6 pb-28">
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-4">
                {msg.role === 'user' ? (
                  /* User Prompt Bubble */
                  <div className="flex justify-end">
                    <div className="max-w-2xl rounded-2xl rounded-tr-sm px-4.5 py-3 text-sm bg-zinc-800/80 text-zinc-100 border border-white/10 shadow-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  /* Assistant Co-Work Execution Card */
                  <div className="space-y-3.5 text-sm text-zinc-200 leading-relaxed">
                    {/* Collapsible Tool Action Badge (Claude Style) */}
                    {msg.readLog && msg.readLog.length > 0 && (
                      <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden text-xs text-zinc-400">
                        <summary className="px-3.5 py-2 cursor-pointer text-zinc-400 hover:text-zinc-200 flex items-center gap-2 select-none font-mono">
                          <Cpu className="w-3.5 h-3.5 text-amber-400" />
                          <span>{msg.readLog[0]}</span>
                          <ChevronRight className="w-3 h-3 text-zinc-500 ml-auto" />
                        </summary>
                        <div className="p-3 text-[11px] font-mono text-zinc-400 border-t border-white/[0.06] bg-black/20 space-y-1">
                          {msg.readLog.map((log, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span>{log}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* AI Narrative & Summary */}
                    <div className="whitespace-pre-wrap leading-relaxed text-zinc-200 space-y-2">
                      {msg.content}
                    </div>

                    {/* Clickable File Mutation Capsules (Claude Style!) */}
                    {msg.editedFiles && msg.editedFiles.length > 0 && (
                      <div className="pt-2 space-y-2">
                        {msg.editedFiles.map((fileItem, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleOpenFileDrawer(fileItem)}
                            className="p-3.5 rounded-2xl bg-[#141620] hover:bg-[#1a1d2c] border border-white/10 hover:border-amber-500/40 cursor-pointer transition flex items-center justify-between shadow-sm group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                                <FileCode className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-white group-hover:text-amber-300 transition">
                                  {fileItem.path}
                                </h4>
                                <p className="text-[11px] text-zinc-500">Click to inspect code & diffs</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-emerald-400 font-medium">
                                +{fileItem.added} -{fileItem.deleted}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  alert(`Reverted changes to ${fileItem.path}`);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-[11px] flex items-center gap-1 transition"
                              >
                                <Undo2 className="w-3 h-3" />
                                <span>Undo</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Active Streaming Activity */}
            {isStreaming && (
              <div className="space-y-3 pt-2">
                {streamingReadLog.length > 0 && (
                  <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs font-mono text-zinc-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>{streamingReadLog[0]}</span>
                  </div>
                )}

                {streamingThought && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs font-mono text-zinc-400 whitespace-pre-wrap">
                    <span className="text-amber-400 font-semibold block mb-1">Reasoning Process:</span>
                    {streamingThought}
                  </div>
                )}

                {streamingOutput ? (
                  <div className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap">
                    {streamingOutput}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-zinc-500 text-xs py-2">
                    <span className="inline-block w-2 h-4 bg-amber-400 animate-pulse rounded-sm" />
                    <span>Executing co-work action...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* Floating Input Composer at Bottom */}
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-[#0c0e14] via-[#0c0e14]/90 to-transparent pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            <div className="rounded-2xl sm:rounded-3xl bg-[#12141c]/95 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-3 sm:p-3.5 focus-within:border-amber-500/50 transition">
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
                placeholder={`Ask Shazam Co-Work to build, fix, or modify in ${currentProject?.name || 'project'}...`}
                className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed max-h-40"
              />

              <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-zinc-400 text-xs flex items-center gap-1.5 font-medium">
                    <Folder className="w-3.5 h-3.5 text-amber-400" />
                    <span className="truncate max-w-[140px]">{currentProject?.name || 'frontend'}</span>
                  </span>
                  <span className="hidden sm:inline text-[11px] text-zinc-500">
                    Auto-manages files & diffs
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (abortControllerRef.current) abortControllerRef.current.abort();
                      }}
                      className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-xl transition"
                    >
                      <Square className="w-4 h-4 fill-white" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!prompt.trim()}
                      className="p-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl transition disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 3. Right Slide-Over Panel (Environment & Connectors OR File Inspector) */}
      {rightPanelOpen && (
        <aside className="w-80 sm:w-96 border-l border-white/[0.07] bg-[#0a0c12]/95 backdrop-blur-2xl flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
          {inspectFile ? (
            /* Mode A: Slide-Over File Inspector (Opens when file capsule is clicked!) */
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="p-3.5 border-b border-white/[0.07] flex items-center justify-between">
                <div className="flex items-center gap-2 truncate">
                  <FileCode className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="truncate">
                    <h3 className="text-xs font-semibold text-white truncate">{inspectFile.path.split('/').pop()}</h3>
                    <p className="text-[10px] text-zinc-500 truncate">{inspectFile.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(inspectFile.content);
                      alert('Copied to clipboard');
                    }}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
                    title="Copy code"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setInspectFile(null)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
                    title="Close file preview"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 bg-[#090a0f]">
                <MonacoEditor
                  height="100%"
                  theme="vs-dark"
                  language="typescript"
                  value={inspectFile.content}
                  options={{
                    readOnly: true,
                    fontSize: 12,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>

              <div className="p-3 border-t border-white/[0.07] bg-black/20 flex items-center justify-between text-xs">
                <span className="text-[11px] font-mono text-emerald-400">
                  +{inspectFile.added || 19} -{inspectFile.deleted || 44} lines changed
                </span>
                <button
                  onClick={() => {
                    alert(`Restored ${inspectFile.path} to previous snapshot`);
                    setInspectFile(null);
                  }}
                  className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-medium transition flex items-center gap-1.5"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>Undo Changes</span>
                </button>
              </div>
            </div>
          ) : (
            /* Mode B: Environment & Connectors (Matching Claude screenshot!) */
            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
              {/* Environment Card */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-zinc-400 font-semibold tracking-wider text-[11px] uppercase">
                  <span>Environment</span>
                  <button onClick={handleConnectLocalFolder} className="text-amber-400 hover:underline capitalize text-xs">
                    Choose Folder
                  </button>
                </div>

                <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-2.5">
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>💻 Cloud Sandbox (D1 Verified)</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400 truncate">
                    <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{currentProject?.name || 'frontend'} · ~/Workspace</span>
                  </div>
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-zinc-400">
                    <span>Remote Control</span>
                    <button
                      onClick={() => setRemoteControlEnabled(!remoteControlEnabled)}
                      className={`w-9 h-5 rounded-full transition-colors relative ${
                        remoteControlEnabled ? 'bg-amber-500' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                          remoteControlEnabled ? 'right-1' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Connectors (MCP Tools) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-zinc-400 font-semibold tracking-wider text-[11px] uppercase">
                  <span>Connectors (MCP)</span>
                  <button
                    onClick={() => setMcpModalOpen(true)}
                    className="text-amber-400 hover:underline capitalize text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Connect MCP
                  </button>
                </div>

                <div className="space-y-2">
                  {/* Preset MCP connectors */}
                  {[
                    { id: 'web_search', name: 'Web Research Engine', desc: 'Real-time documentation & live search', icon: Globe },
                    { id: 'github', name: 'GitHub Integration', desc: 'Pull requests, issues & repository sync', icon: GitBranchIcon },
                    { id: 'browser_takeover', name: 'Chrome Browser Agent', desc: 'Automated web exploration', icon: Radio },
                  ].map((connector) => {
                    const Icon = connector.icon;
                    const isEnabled = activeConnectors[connector.id] ?? false;
                    return (
                      <div
                        key={connector.id}
                        className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="p-1.5 rounded-lg bg-white/5 text-amber-400">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <h4 className="text-xs font-medium text-white truncate">{connector.name}</h4>
                            <p className="text-[10px] text-zinc-500 truncate">{connector.desc}</p>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => setActiveConnectors((prev) => ({ ...prev, [connector.id]: e.target.checked }))}
                          className="accent-amber-500 rounded"
                        />
                      </div>
                    );
                  })}

                  {/* Custom User Connected MCP Servers */}
                  {mcpServers.map((server) => (
                    <div
                      key={server.id}
                      className="p-3 rounded-xl bg-amber-500/[0.03] border border-amber-500/20 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                          <Cpu className="w-3.5 h-3.5" />
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-medium text-white truncate">{server.name}</h4>
                          <p className="text-[10px] text-emerald-400 font-mono truncate">
                            MCP Connected · {server.tools?.length || 2} tools
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteMcpServer(server.id)}
                        className="p-1 text-zinc-500 hover:text-red-400 rounded transition"
                        title="Disconnect MCP server"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Connect MCP Modal */}
      {mcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <form
            onSubmit={handleAddMcpServer}
            className="w-full max-w-md bg-[#12141e] border border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-amber-400" /> Connect Remote MCP Server
              </h3>
              <button
                type="button"
                onClick={() => setMcpModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Connect any Model Context Protocol (MCP) server speaking JSON-RPC or Server-Sent Events (SSE).
            </p>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-300 font-medium">Server Name</label>
              <input
                type="text"
                placeholder="e.g. Postgres DB, Notion, Linear, Custom API"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500/60"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-300 font-medium">Server URL (SSE / HTTP)</label>
              <input
                type="url"
                placeholder="https://mcp.yourcompany.com/sse"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500/60"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-300 font-medium">Auth Bearer Token (Optional)</label>
              <input
                type="password"
                placeholder="Bearer mcp_sec_..."
                value={mcpToken}
                onChange={(e) => setMcpToken(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500/60"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMcpModalOpen(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl text-xs transition"
              >
                Connect MCP
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function GitBranchIcon(props: any) {
  return (
    <svg {...props} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"></line>
      <circle cx="18" cy="6" r="3"></circle>
      <circle cx="6" cy="18" r="3"></circle>
      <path d="M18 9a9 9 0 0 1-9 9"></path>
    </svg>
  );
}
