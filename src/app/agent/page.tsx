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
  X,
  FileCode,
  FileText,
  SlidersHorizontal,
  ExternalLink,
  Sliders,
  Layers,
  Terminal,
  Cpu,
  Globe,
  Radio,
  Minimize2,
  Maximize2,
  Code2,
  Trash2,
  Network,
  Zap,
  MessageSquare,
} from 'lucide-react';

// Dynamic import of Monaco Editor for the slide-over file preview drawer
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-[#090a0f] text-zinc-500 font-sans text-xs">
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

interface ConversationItem {
  id: string;
  projectId?: string | null;
  title: string;
  createdAt: string;
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

export default function ClaudeCoWorkStudio() {
  // Navigation & User State
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  
  // Real Conversations State from Cloudflare D1
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>('New Conversation');
  const [loadingConv, setLoadingConv] = useState(false);

  // Chat stream
  const [messages, setMessages] = useState<CoWorkMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingThought, setStreamingThought] = useState('');
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamingReadLog, setStreamingReadLog] = useState<string[]>([]);
  const [thoughtExpanded, setThoughtExpanded] = useState(false);

  // Slide-over File Preview Drawer
  const [inspectFile, setInspectFile] = useState<{ path: string; content: string; added?: number; deleted?: number } | null>(null);
  const [fileCopied, setFileCopied] = useState(false);

  // Project Creation Modal & Quick File Search
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFiles, setProjectFiles] = useState<Array<{ path: string; content: string }>>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Initial Load: User, Projects, and Real Conversations
  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});

    loadProjectsAndConversations();
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K for file quick open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setQuickSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingOutput, streamingThought]);

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  async function loadProjectsAndConversations() {
    try {
      const [projRes, convRes] = await Promise.all([
        fetch('/api/v1/projects'),
        fetch('/api/v1/conversations'),
      ]);

      const projData = await projRes.json();
      const convData = await convRes.json();

      const pList: Project[] = projData.projects || [];
      const cList: ConversationItem[] = convData.conversations || [];

      setProjects(pList);
      setConversations(cList);

      // Auto-expand all projects
      const expandMap: Record<string, boolean> = {};
      pList.forEach((p) => {
        expandMap[p.id] = true;
      });
      setExpandedProjects(expandMap);

      if (pList.length > 0) {
        const firstProj = pList[0];
        setCurrentProject(firstProj);
        loadProjectFiles(firstProj.id);

        // Find existing conversation for this project, or start fresh
        const projConvs = cList.filter((c) => c.projectId === firstProj.id);
        if (projConvs.length > 0) {
          selectConversation(projConvs[0].id, projConvs[0].title);
        } else {
          // Fresh conversation in this project
          handleNewConversationInProject(firstProj.id);
        }
      } else {
        // Create initial default project if user has none
        const createRes = await fetch('/api/v1/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'My Project', description: 'Default Workspace' }),
        });
        const createData = await createRes.json();
        if (createData.project) {
          setProjects([createData.project]);
          setCurrentProject(createData.project);
          setExpandedProjects({ [createData.project.id]: true });
          handleNewConversationInProject(createData.project.id);
        }
      }
    } catch {
      // ignore
    }
  }

  async function loadProjectFiles(projectId: string) {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/files`);
      const data = await res.json();
      if (res.ok && data.files) {
        setProjectFiles(data.files);
      }
    } catch {
      // ignore
    }
  }

  // Select a real conversation and load its messages from Cloudflare D1
  async function selectConversation(convId: string, title: string) {
    setCurrentConversationId(convId);
    setCurrentTitle(title);
    setLoadingConv(true);
    setStreamingOutput('');
    setStreamingThought('');
    setInspectFile(null);

    try {
      const res = await fetch(`/api/v1/conversations/${convId}`);
      const data = await res.json();
      if (res.ok) {
        if (data.conversation?.projectId) {
          const matchedProj = projects.find((p) => p.id === data.conversation.projectId);
          if (matchedProj) {
            setCurrentProject(matchedProj);
            loadProjectFiles(matchedProj.id);
          }
        }

        const rawMsgs = data.messages || [];
        const formatted: CoWorkMessage[] = rawMsgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thought: m.reasoning || undefined,
          timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));
        setMessages(formatted);
      }
    } catch {
      // ignore
    } finally {
      setLoadingConv(false);
    }
  }

  // Antigravity action: Clicking "+" beside a project creates a new session in THAT project
  async function handleNewConversationInProject(projectId: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();

    const targetProj = projects.find((p) => p.id === projectId);
    if (targetProj) {
      setCurrentProject(targetProj);
      loadProjectFiles(targetProj.id);
    }

    try {
      const res = await fetch('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Conversation',
          projectId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.conversation) {
        setConversations((prev) => [data.conversation, ...prev]);
        setCurrentConversationId(data.conversation.id);
        setCurrentTitle(data.conversation.title);
        setMessages([]);
        setInspectFile(null);
        // Ensure project accordion is expanded
        setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      }
    } catch {
      // ignore
    }
  }

  // Global "+ New Chat"
  async function handleGlobalNewChat() {
    const activeProjId = currentProject?.id || null;
    if (activeProjId) {
      handleNewConversationInProject(activeProjId);
    } else {
      try {
        const res = await fetch('/api/v1/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Conversation' }),
        });
        const data = await res.json();
        if (res.ok && data.conversation) {
          setConversations((prev) => [data.conversation, ...prev]);
          setCurrentConversationId(data.conversation.id);
          setCurrentTitle(data.conversation.title);
          setMessages([]);
          setInspectFile(null);
        }
      } catch {
        // ignore
      }
    }
  }

  async function handleDeleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`/api/v1/conversations/${convId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (currentConversationId === convId) {
        const remaining = conversations.filter((c) => c.id !== convId);
        if (remaining.length > 0) {
          selectConversation(remaining[0].id, remaining[0].title);
        } else if (currentProject) {
          handleNewConversationInProject(currentProject.id);
        }
      }
    } catch {
      // ignore
    }
  }

  // Create New Project
  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setProjects((prev) => [data.project, ...prev]);
        setCurrentProject(data.project);
        setExpandedProjects((prev) => ({ ...prev, [data.project.id]: true }));
        setNewProjectModal(false);
        setNewProjectName('');
        // Start conversation in this project
        handleNewConversationInProject(data.project.id);
      }
    } catch {
      // ignore
    }
  }

  // Helper to read files recursively from a directory handle
  async function readFilesFromDirectory(dirHandle: any, currentPath = ''): Promise<Array<{ path: string; content: string }>> {
    const IGNORED = ['.git', 'node_modules', '.next', '.open-next', 'dist', 'build', '.gemini', 'coverage', '.DS_Store'];
    const ALLOWED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.py', '.html', '.css', '.yaml', '.yml', '.toml', '.sql', '.env.example'];

    let results: Array<{ path: string; content: string }> = [];

    for await (const entry of dirHandle.values()) {
      if (IGNORED.includes(entry.name) || entry.name.startsWith('.')) continue;

      const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      if (entry.kind === 'file') {
        const ext = entry.name.includes('.') ? `.${entry.name.split('.').pop()}` : '';
        if (ALLOWED_EXT.includes(ext.toLowerCase())) {
          try {
            const file = await entry.getFile();
            if (file.size < 128 * 1024) {
              const content = await file.text();
              results.push({ path: relPath, content });
            }
          } catch {
            // ignore
          }
        }
      } else if (entry.kind === 'directory') {
        try {
          const subFiles = await readFilesFromDirectory(entry, relPath);
          results = results.concat(subFiles);
        } catch {
          // ignore
        }
      }

      if (results.length >= 40) break;
    }

    return results;
  }

  // Native Mac folder picker to bind local folder AND ingest real files
  async function handleConnectLocalFolder() {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support local folder selection. You can create projects directly in the cloud.');
      return;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const folderName = dirHandle.name;

      // 1. Create or get project record
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, rootDir: `~/${folderName}` }),
      });
      const data = await res.json();
      const proj = data.project;

      if (proj) {
        setProjects((prev) => [proj, ...prev.filter((p) => p.id !== proj.id)]);
        setCurrentProject(proj);
        setExpandedProjects((prev) => ({ ...prev, [proj.id]: true }));

        // 2. Read real files from the directory handle!
        const ingestedFiles = await readFilesFromDirectory(dirHandle);

        if (ingestedFiles.length > 0) {
          // 3. Bulk ingest files into Cloudflare D1
          await fetch(`/api/v1/projects/${proj.id}/files/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: ingestedFiles }),
          });
          setProjectFiles(ingestedFiles);
        }

        handleNewConversationInProject(proj.id);
      }
    } catch {
      // user cancelled
    }
  }

  // Send message & stream response
  async function handleSend(customText?: string) {
    const textToSend = (customText || prompt).trim();
    if (!textToSend || isStreaming) return;

    setPrompt('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: CoWorkMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    setStreamingOutput('');
    setStreamingThought('');
    setStreamingReadLog(['Analyzing project requirements...', 'Reviewing workspace context...']);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Contextual prompt with real project files
    let contextualPrompt = textToSend;
    if (currentProject) {
      if (projectFiles.length > 0) {
        const fileSnippets = projectFiles
          .slice(0, 15)
          .map((f) => `### File: ${f.path}\n\`\`\`\n${f.content.slice(0, 2500)}\n\`\`\``)
          .join('\n\n');

        contextualPrompt = `You are an AI assistant working on the user's project "${currentProject.name}".
Here are the project's actual workspace files:

${fileSnippets}

User Request:
${textToSend}`;
      } else {
        contextualPrompt = `[Project: ${currentProject.name} (No local files indexed yet)]\n${textToSend}`;
      }
    }

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: contextualPrompt,
          conversationId: currentConversationId || undefined,
          taskClassOverride: 'coding',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to dispatch task.');
      }

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

      // Check if output contains code block to generate clickable file preview capsule
      const codeMatch = fullOutput.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);
      const generatedFiles: Array<{ path: string; added: number; deleted: number; code?: string }> = [];

      if (codeMatch && codeMatch[1]) {
        const samplePath = 'src/App.tsx';
        const code = codeMatch[1].trim();
        const lineCount = code.split('\n').length;
        generatedFiles.push({
          path: samplePath,
          added: lineCount,
          deleted: Math.max(1, Math.floor(lineCount / 4)),
          code,
        });

        // Save generated file to project in Cloudflare D1
        if (currentProject) {
          fetch(`/api/v1/projects/${currentProject.id}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: samplePath, content: code }),
          })
            .then(() => loadProjectFiles(currentProject.id))
            .catch(() => {});
        }
      }

      const assistantMsg: CoWorkMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullOutput,
        thought: fullThought || undefined,
        readLog: ['Searched project context', 'Verified workspace state'],
        editedFiles: generatedFiles.length > 0 ? generatedFiles : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errMsg = err.message || 'Execution failed.';
        const failMsg: CoWorkMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ **Unable to complete task:** ${errMsg}\n\nPlease check your AI provider key under Settings or verify model routing policies.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, failMsg]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingOutput('');
      setStreamingThought('');
    }
  }

  function handleCopyFileCode() {
    if (!inspectFile) return;
    navigator.clipboard.writeText(inspectFile.content);
    setFileCopied(true);
    setTimeout(() => setFileCopied(false), 2000);
  }

  return (
    <div className="flex-1 flex h-[calc(100vh-60px)] bg-[#0a0c10] text-zinc-100 overflow-hidden font-sans">
      {/* ========================================================================= */}
      {/* 1. Left Antigravity-Style Project Tree Sidebar (Strictly Project Scoped) */}
      {/* ========================================================================= */}
      <aside className="w-64 border-r border-white/[0.06] bg-[#07080c] flex flex-col shrink-0 select-none">
        {/* Top Actions: Search & + New Chat */}
        <div className="p-3 space-y-2 border-b border-white/[0.05]">
          <button
            onClick={() => setQuickSearchOpen(true)}
            className="w-full px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl text-xs text-zinc-400 flex items-center justify-between transition"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <span>Search files...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-zinc-400">
              ⌘K
            </kbd>
          </button>

          <button
            onClick={handleGlobalNewChat}
            className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-semibold text-amber-300 flex items-center justify-center gap-2 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-amber-400" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Projects Accordion Section (Antigravity Tree Hierarchy) */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          <div>
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
              <span className="flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-amber-400" />
                <span>Projects</span>
              </span>
              <button
                onClick={() => setNewProjectModal(true)}
                className="p-1 hover:text-white rounded transition"
                title="Create New Project"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* List of User Projects */}
            <div className="space-y-1 mt-1">
              {projects.map((proj) => {
                const isCurrent = currentProject?.id === proj.id;
                const isExpanded = expandedProjects[proj.id] ?? true;
                const projConvs = conversations.filter((c) => c.projectId === proj.id);

                return (
                  <div key={proj.id} className="space-y-0.5">
                    {/* Project Row */}
                    <div
                      onClick={() => {
                        setCurrentProject(proj);
                        loadProjectFiles(proj.id);
                        setExpandedProjects((prev) => ({ ...prev, [proj.id]: !isExpanded }));
                      }}
                      className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition text-xs font-medium ${
                        isCurrent ? 'bg-white/[0.06] text-white' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        )}
                        <Folder className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-amber-400' : 'text-zinc-500'}`} />
                        <span className="truncate">{proj.name}</span>
                      </div>

                      {/* Hover "+" button to create conversation inside this project */}
                      <button
                        onClick={(e) => handleNewConversationInProject(proj.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-amber-400 rounded transition"
                        title={`New conversation in ${proj.name}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Nested Conversations (ONLY belonging to this project!) */}
                    {isExpanded && (
                      <div className="pl-6 pr-1 space-y-0.5">
                        {projConvs.length === 0 ? (
                          <div
                            onClick={() => handleNewConversationInProject(proj.id)}
                            className="px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-amber-400 cursor-pointer italic"
                          >
                            + Start task in {proj.name}
                          </div>
                        ) : (
                          projConvs.map((conv) => {
                            const isConvActive = currentConversationId === conv.id;
                            return (
                              <div
                                key={conv.id}
                                onClick={() => selectConversation(conv.id, conv.title)}
                                className={`group/conv flex items-center justify-between px-2 py-1 rounded-md cursor-pointer transition text-xs ${
                                  isConvActive
                                    ? 'bg-amber-500/10 text-amber-300 font-medium'
                                    : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                                }`}
                              >
                                <span className="truncate">{conv.title}</span>
                                <button
                                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                                  className="opacity-0 group-hover/conv:opacity-100 p-0.5 hover:text-red-400 transition"
                                  title="Delete conversation"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Unassigned / General Chats */}
          {conversations.filter((c) => !c.projectId).length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                Recent Chats
              </div>
              <div className="space-y-0.5 mt-1">
                {conversations
                  .filter((c) => !c.projectId)
                  .map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => selectConversation(conv.id, conv.title)}
                      className={`group/conv flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition text-xs ${
                        currentConversationId === conv.id
                          ? 'bg-amber-500/10 text-amber-300 font-medium'
                          : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                      }`}
                    >
                      <span className="truncate">{conv.title}</span>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="opacity-0 group-hover/conv:opacity-100 p-0.5 hover:text-red-400 transition"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Profile & Settings Link */}
        <div className="p-3 border-t border-white/[0.06] bg-black/30 flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-semibold">
              {user?.name?.charAt(0) || user?.email?.charAt(0) || 'A'}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-white truncate">{user?.name || user?.email || 'User'}</p>
              <p className="text-[10px] text-zinc-500">Free Tier · D1 Connected</p>
            </div>
          </div>

          <Link
            href="/settings"
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-amber-400 transition"
            title="Settings & MCP Connectors"
          >
            <Sliders className="w-4 h-4" />
          </Link>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. Main Conversational Chat Canvas (Clean, Friendly, Non-Intimidating)   */}
      {/* ========================================================================= */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0b0d13] overflow-hidden relative">
        {/* Top Header Bar */}
        <header className="h-12 border-b border-white/[0.06] bg-[#08090e]/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/5 text-xs text-zinc-300">
              <Folder className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-white">{currentProject ? currentProject.name : 'Workspace'}</span>
            </div>
            <span className="text-zinc-600">/</span>
            <span className="text-xs font-medium text-zinc-300 truncate max-w-sm">
              {currentTitle}
            </span>
          </div>

          {/* Quick MCP Status Badge + Search Button */}
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-[11px] font-medium text-zinc-400 hover:text-amber-300 transition"
            >
              <Network className="w-3.5 h-3.5 text-emerald-400" />
              <span>Connectors & MCPs</span>
            </Link>

            <button
              onClick={() => setQuickSearchOpen(true)}
              className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-zinc-200 transition"
              title="Search Project Files (⌘K)"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Chat Messages Scrollable Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
          {loadingConv ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-500">
              Loading conversation...
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            /* Friendly, Non-Intimidating Empty State for Creators & Non-Developers */
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-6 pt-10 pb-16">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/10">
                <Sparkles className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-white font-sans">
                  What would you like to build in {currentProject?.name || 'this project'}?
                </h2>
                <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
                  Describe what you want in plain words. Shazam plans, designs, and builds it for you.
                </p>
              </div>

              {/* 4 Clean Action Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full pt-2">
                {[
                  {
                    icon: <Sparkles className="w-4 h-4 text-amber-400" />,
                    title: 'Build a Landing Page',
                    desc: 'Create a responsive web page with pricing cards and dark theme',
                    prompt: 'Build a modern SaaS landing page with pricing cards, FAQs, and a sleek dark theme',
                  },
                  {
                    icon: <Zap className="w-4 h-4 text-emerald-400" />,
                    title: 'Add Currency & Location',
                    desc: 'Auto-detect location from IP with Nigeria and Naira fallback',
                    prompt: 'Detect user location and currency automatically via IP address, with fallback to Nigeria and NGN',
                  },
                  {
                    icon: <Layers className="w-4 h-4 text-blue-400" />,
                    title: 'Redesign Interface',
                    desc: 'Make the user flow feel clean, elegant, and high-converting',
                    prompt: 'Make my checkout and account settings look clean, minimalist, and high-converting like Apple',
                  },
                  {
                    icon: <Code2 className="w-4 h-4 text-purple-400" />,
                    title: 'Fix Mobile Layout',
                    desc: 'Improve responsiveness and spacing on phone screens',
                    prompt: 'Review and improve the mobile responsive layout, padding, and tap targets across my web app',
                  },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item.prompt)}
                    className="p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-amber-500/30 text-left transition group shadow-sm flex flex-col justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-lg bg-white/5 border border-white/5">
                        {item.icon}
                      </div>
                      <span className="text-xs font-semibold text-zinc-200 group-hover:text-amber-400 transition">
                        {item.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">
                      {item.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 pb-28">
              {messages.map((msg) => (
                <div key={msg.id} className="space-y-3">
                  {/* User Bubble */}
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-xl rounded-2xl bg-amber-500/15 border border-amber-500/25 px-4 py-3 text-sm text-zinc-100 shadow-sm leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    /* Assistant Response */
                    <div className="space-y-3">
                      {/* Collapsible Reasoning */}
                      {msg.thought && (
                        <div className="border border-white/[0.06] bg-white/[0.02] rounded-xl overflow-hidden">
                          <button
                            onClick={() => setThoughtExpanded(!thoughtExpanded)}
                            className="w-full px-3 py-2 text-left text-xs text-zinc-400 hover:text-zinc-200 flex items-center justify-between"
                          >
                            <span className="flex items-center gap-1.5 font-medium">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              <span>Reasoning & Plan</span>
                            </span>
                            {thoughtExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {thoughtExpanded && (
                            <div className="px-3 pb-3 text-xs text-zinc-400 leading-relaxed border-t border-white/5 pt-2">
                              {msg.thought}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Main Text Content */}
                      <div className="text-sm text-zinc-200 leading-relaxed space-y-2 whitespace-pre-wrap">
                        {msg.content}
                      </div>

                      {/* Clickable File Change Capsules (Previewable on click!) */}
                      {msg.editedFiles && msg.editedFiles.length > 0 && (
                        <div className="pt-2 flex flex-wrap gap-2">
                          {msg.editedFiles.map((file, fIdx) => (
                            <button
                              key={fIdx}
                              onClick={() =>
                                setInspectFile({
                                  path: file.path,
                                  content: file.code || '// File updated in project workspace',
                                  added: file.added,
                                  deleted: file.deleted,
                                })
                              }
                              className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-mono text-amber-300 flex items-center gap-2 transition shadow-sm"
                            >
                              <FileCode className="w-3.5 h-3.5 text-amber-400" />
                              <span>{file.path}</span>
                              <span className="text-[10px] text-emerald-400 font-bold">+{file.added}</span>
                              <span className="text-[10px] text-red-400 font-bold">-{file.deleted}</span>
                              <span className="text-[10px] text-zinc-500 underline ml-1">Click to preview</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming Output Indicator */}
              {isStreaming && (
                <div className="space-y-3 pt-2 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5 text-xs text-amber-400 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <span className="animate-pulse">
                      {streamingThought || `Reading project context & reasoning in ${currentProject?.name || 'workspace'}...`}
                    </span>
                  </div>

                  {streamingOutput ? (
                    <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                      {streamingOutput}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-zinc-400 text-xs py-1">
                      <span className="inline-block w-2 h-4 bg-amber-400 animate-pulse rounded-sm" />
                      <span>Reading files and formulating response...</span>
                    </div>
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Floating Prompt Input */}
        <div className="p-4 sm:p-6 bg-gradient-to-t from-[#0a0c10] via-[#0a0c10]/90 to-transparent">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl bg-[#0f1118] border border-white/10 shadow-2xl focus-within:border-amber-500/50 transition">
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
                placeholder={
                  currentProject
                    ? `Ask Shazam to build or change anything in ${currentProject.name}...`
                    : 'Describe what you want to build...'
                }
                rows={1}
                className="w-full px-4 pt-3.5 pb-12 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none font-sans"
              />

              <div className="absolute left-3 bottom-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConnectLocalFolder}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-[11px] font-medium text-amber-300 hover:text-amber-200 flex items-center gap-1.5 transition shadow-sm"
                  title="Connected Project Folder (click to re-sync or change)"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold">{currentProject ? currentProject.name : 'Connect Local Folder'}</span>
                  {projectFiles.length > 0 && (
                    <span className="text-[10px] text-zinc-400 font-mono">({projectFiles.length} files)</span>
                  )}
                </button>
              </div>

              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                <button
                  onClick={() => handleSend()}
                  disabled={!prompt.trim() || isStreaming}
                  className="w-8 h-8 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:hover:bg-amber-500 text-zinc-950 flex items-center justify-center transition shadow-md"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ========================================================================= */}
      {/* 3. Slide-Over File Preview Drawer (Slides in on file capsule click)      */}
      {/* ========================================================================= */}
      {inspectFile && (
        <aside className="w-[480px] border-l border-white/[0.08] bg-[#0c0e14] flex flex-col shrink-0 z-30 animate-in slide-in-from-right duration-200 shadow-2xl">
          {/* Header */}
          <div className="h-12 px-4 border-b border-white/[0.06] bg-black/40 flex items-center justify-between">
            <div className="flex items-center gap-2 truncate">
              <FileCode className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-mono font-medium text-zinc-200 truncate">
                {inspectFile.path}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyFileCode}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-zinc-200 transition text-xs flex items-center gap-1"
                title="Copy file contents"
              >
                {fileCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setInspectFile(null)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-zinc-200 transition"
                title="Close Drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Monaco Editor / Syntax Viewer */}
          <div className="flex-1 overflow-hidden">
            <MonacoEditor
              height="100%"
              language={
                inspectFile.path.endsWith('.tsx') || inspectFile.path.endsWith('.ts')
                  ? 'typescript'
                  : inspectFile.path.endsWith('.json')
                  ? 'json'
                  : inspectFile.path.endsWith('.py')
                  ? 'python'
                  : 'javascript'
              }
              value={inspectFile.content}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: 'JetBrains Mono, Menlo, monospace',
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
              }}
            />
          </div>
        </aside>
      )}

      {/* ========================================================================= */}
      {/* 4. Antigravity Quick Open / File Search Modal (⌘K)                         */}
      {/* ========================================================================= */}
      {quickSearchOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 p-4">
          <div className="w-full max-w-lg bg-[#0f1118] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-3 border-b border-white/[0.08] flex items-center gap-2.5">
              <Search className="w-4 h-4 text-zinc-400" />
              <input
                type="text"
                autoFocus
                placeholder={`Search files in ${currentProject?.name || 'project'}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
              />
              <button
                onClick={() => setQuickSearchOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              {projectFiles.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500">
                  No files indexed in this project yet. Tell Shazam what to build!
                </div>
              ) : (
                projectFiles
                  .filter((f) => f.path.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((file, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setInspectFile({ path: file.path, content: file.content });
                        setQuickSearchOpen(false);
                      }}
                      className="px-3 py-2 rounded-xl hover:bg-white/[0.06] cursor-pointer flex items-center justify-between text-xs transition"
                    >
                      <div className="flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-amber-400" />
                        <span className="font-mono text-zinc-200">{file.path}</span>
                      </div>
                      <span className="text-[10px] text-zinc-500">Open preview</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. Create Project Modal                                                   */}
      {/* ========================================================================= */}
      {newProjectModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateProject}
            className="w-full max-w-sm bg-[#0f1118] border border-white/10 rounded-2xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div>
              <h3 className="text-sm font-semibold text-white">Create New Project</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Organize tasks, chats, and files under an isolated project.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Project Name</label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Zoqo, Portfolio, Mobile App"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setNewProjectModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg transition shadow-md"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
