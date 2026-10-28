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
  GitBranch,
  Play,
  RotateCcw,
  CheckCircle2,
  FilePlus,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { parsePatchesFromText, applySearchReplace } from '@/lib/agent/patcher';
import { buildProjectIndex } from '@/lib/agent/indexer';

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
  steps?: Array<{
    step: number;
    thought: string;
    tool: string;
    args?: any;
    observation?: string;
    isError?: boolean;
  }>;
  readLog?: string[];
  editedFiles?: Array<{ path: string; added: number; deleted: number; code?: string }>;
  timestamp: string;
}

function ReActStepper({
  steps,
  isLive,
}: {
  steps: Array<{
    step: number;
    thought: string;
    tool: string;
    args?: any;
    observation?: string;
    isError?: boolean;
  }>;
  isLive?: boolean;
}) {
  const [expanded, setExpanded] = useState(isLive || false);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const toggleStep = (stepNum: number) => {
    setExpandedSteps((prev) => ({ ...prev, [stepNum]: !prev[stepNum] }));
  };

  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'read_file':
        return <Search className="w-3.5 h-3.5 text-blue-400" />;
      case 'edit_file':
        return <FileCode className="w-3.5 h-3.5 text-amber-400" />;
      case 'create_file':
        return <FilePlus className="w-3.5 h-3.5 text-emerald-400" />;
      case 'run_command':
        return <Terminal className="w-3.5 h-3.5 text-purple-400" />;
      case 'finish_task':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Zap className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  const formatArgs = (tool: string, args: any) => {
    if (!args) return '';
    if (tool === 'read_file') return args.path || '';
    if (tool === 'edit_file') return args.path || '';
    if (tool === 'create_file') return args.path || '';
    if (tool === 'run_command') return `$ ${args.command || ''}`;
    if (tool === 'finish_task') return args.summary ? (args.summary.length > 60 ? `${args.summary.slice(0, 60)}...` : args.summary) : 'Task completed';
    return JSON.stringify(args);
  };

  return (
    <div className="border border-white/[0.08] bg-black/40 rounded-xl overflow-hidden shadow-sm my-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:text-white bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-between transition select-none"
      >
        <span className="flex items-center gap-2 font-medium">
          <Zap className={`w-3.5 h-3.5 ${isLive ? 'text-amber-400 animate-pulse' : 'text-amber-400'}`} />
          <span className="font-semibold text-zinc-200">Autonomous ReAct Execution</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
          {isLive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse font-mono">
              Running
            </span>
          )}
        </span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
      </button>

      {expanded && (
        <div className="p-3 space-y-2 border-t border-white/[0.06] bg-[#080a0f]">
          {steps.map((st, idx) => {
            const isStepExpanded = expandedSteps[st.step] ?? (isLive && idx === steps.length - 1);
            return (
              <div
                key={st.step || idx}
                className={`rounded-lg border text-xs transition ${
                  st.isError
                    ? 'border-red-500/30 bg-red-950/20'
                    : isLive && idx === steps.length - 1
                    ? 'border-amber-500/40 bg-amber-500/[0.04]'
                    : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div
                  onClick={() => toggleStep(st.step)}
                  className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] select-none"
                >
                  <div className="flex items-center gap-2 overflow-hidden truncate">
                    <span className="text-[10px] font-mono text-zinc-500">#{st.step}</span>
                    <span className="p-1 rounded bg-white/5">{getToolIcon(st.tool)}</span>
                    <span className="font-mono font-medium text-amber-300">{st.tool}</span>
                    <span className="font-mono text-zinc-400 truncate text-[11px]">{formatArgs(st.tool, st.args)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {st.isError && (
                      <span className="text-[10px] text-red-400 font-mono bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                        Error
                      </span>
                    )}
                    {st.observation && !st.isError && (
                      <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        Done
                      </span>
                    )}
                    {isStepExpanded ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
                  </div>
                </div>

                {isStepExpanded && (
                  <div className="px-2.5 pb-2 pt-1 border-t border-white/[0.04] space-y-1.5">
                    {st.thought && (
                      <div className="text-[11px] text-zinc-400 italic">
                        <span className="text-zinc-500 font-semibold not-italic">Thought: </span>
                        {st.thought}
                      </div>
                    )}
                    {st.observation && (
                      <div className="rounded bg-black/60 p-2 font-mono text-[10px] text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap border border-white/5">
                        {st.observation}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

  // Model Selection Pill
  const [selectedModel, setSelectedModel] = useState<string>('auto');

  // Chat stream
  const [messages, setMessages] = useState<CoWorkMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingThought, setStreamingThought] = useState('');
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamingSteps, setStreamingSteps] = useState<Array<{
    step: number;
    thought: string;
    tool: string;
    args?: any;
    observation?: string;
    isError?: boolean;
  }>>([]);
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
  const [syncingFiles, setSyncingFiles] = useState(false);
  const [syncBannerMessage, setSyncBannerMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Local Companion Bridge Daemon State (localhost:4040)
  const [daemonStatus, setDaemonStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [daemonInfo, setDaemonInfo] = useState<{ cwd: string; projectName: string } | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<Array<{ type: string; text: string; id: string }>>([
    { type: 'info', text: 'Shazam AI Execution Terminal ready. Run "npm run daemon" in your local project to link terminal commands.', id: 'init-1' }
  ]);
  const [customCmd, setCustomCmd] = useState('');
  const [executingCmd, setExecutingCmd] = useState(false);
  const [gitPushing, setGitPushing] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [daemonToken, setDaemonToken] = useState<string>('');
  const [isDesktopApp, setIsDesktopApp] = useState<boolean>(false);
  const terminalLogsEndRef = useRef<HTMLDivElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

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

  // Auto scroll terminal logs
  useEffect(() => {
    if (terminalOpen) {
      terminalLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs, terminalOpen]);

  // Check local companion daemon health & manage security token
  const checkDaemon = async (customToken?: string) => {
    // 0. Native Desktop App detection (Zero-config automated bridge)
    if (typeof window !== 'undefined' && (window as any).shazamDesktop) {
      setIsDesktopApp(true);
      try {
        const config = await (window as any).shazamDesktop.getDaemonConfig();
        if (config && config.token) {
          setDaemonToken(config.token);
          setDaemonStatus('connected');
          setDaemonInfo({ cwd: config.cwd, projectName: config.cwd.split('/').pop() || 'Project' });
          return true;
        }
      } catch {}
    }

    const candidate = customToken !== undefined
      ? customToken
      : daemonToken || (typeof window !== 'undefined' ? localStorage.getItem('shazam_daemon_token') || '' : '');

    try {
      const res = await fetch('http://localhost:4040/api/health', {
        method: 'GET',
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(2000) : undefined,
      });

      if (res.ok) {
        const data = await res.json();
        setDaemonStatus('connected');
        setDaemonInfo(data);

        // Auto-fetch token when developing on localhost
        if (!candidate && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          try {
            const tokRes = await fetch('http://localhost:4040/api/auth/token');
            if (tokRes.ok) {
              const tokData = await tokRes.json();
              if (tokData.token) {
                setDaemonToken(tokData.token);
                localStorage.setItem('shazam_daemon_token', tokData.token);
                return true;
              }
            }
          } catch {}
        } else if (candidate) {
          setDaemonToken(candidate);
          if (typeof window !== 'undefined') localStorage.setItem('shazam_daemon_token', candidate);
        }

        return true;
      }
    } catch {
      // offline
    }
    setDaemonStatus('disconnected');
    return false;
  };

  useEffect(() => {
    checkDaemon();
    const interval = setInterval(() => checkDaemon(), 8000);
    return () => clearInterval(interval);
  }, [daemonToken]);

  // Execute terminal command on user's machine via local companion daemon
  async function runLocalCommand(cmd: string) {
    if (!cmd.trim() || executingCmd) return;
    setExecutingCmd(true);
    setTerminalOpen(true);

    const cmdId = crypto.randomUUID();
    setTerminalLogs((prev) => [
      ...prev,
      { type: 'cmd', text: `$ ${cmd}`, id: cmdId },
    ]);

    try {
      const activeToken = daemonToken || (typeof window !== 'undefined' ? localStorage.getItem('shazam_daemon_token') || '' : '');
      const res = await fetch('http://localhost:4040/api/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shazam-token': activeToken,
        },
        body: JSON.stringify({ command: cmd }),
      });

      if (res.status === 401) {
        throw new Error('Unauthorized: Invalid or missing Security Token. Click "Local Bridge" to set token.');
      }

      if (!res.ok) {
        throw new Error(`Companion daemon returned status ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'stdout' || data.type === 'stderr') {
              setTerminalLogs((prev) => [
                ...prev,
                { type: data.type, text: data.text, id: crypto.randomUUID() },
              ]);
            } else if (data.type === 'exit') {
              setTerminalLogs((prev) => [
                ...prev,
                { type: 'exit', text: `[Process completed with exit code ${data.code}]`, id: crypto.randomUUID() },
              ]);
            } else if (data.type === 'error') {
              setTerminalLogs((prev) => [
                ...prev,
                { type: 'error', text: `Error: ${data.error}`, id: crypto.randomUUID() },
              ]);
            }
          } catch {
            // ignore parse chunk
          }
        }
      }
    } catch (err: any) {
      setTerminalLogs((prev) => [
        ...prev,
        {
          type: 'error',
          text: `Execution failed: ${err.message}.\nMake sure "npm run daemon" is running in your terminal on port 4040.`,
          id: crypto.randomUUID(),
        },
      ]);
    } finally {
      setExecutingCmd(false);
      setCustomCmd('');
    }
  }

  // Push local repository changes to GitHub via companion daemon
  async function handleGitPush() {
    if (gitPushing) return;
    setGitPushing(true);
    setTerminalOpen(true);
    setTerminalLogs((prev) => [
      ...prev,
      { type: 'cmd', text: '$ git add -A && git commit && git push', id: crypto.randomUUID() },
    ]);

    try {
      const activeToken = daemonToken || (typeof window !== 'undefined' ? localStorage.getItem('shazam_daemon_token') || '' : '');
      const res = await fetch('http://localhost:4040/api/git/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shazam-token': activeToken,
        },
        body: JSON.stringify({ message: `chore: update from Shazam AI (${new Date().toLocaleTimeString()})` }),
      });

      if (res.status === 401) {
        throw new Error('Unauthorized: Invalid or missing Security Token.');
      }

      const data = await res.json();
      if (data.success) {
        setTerminalLogs((prev) => [
          ...prev,
          { type: 'stdout', text: data.output || 'Push successful!', id: crypto.randomUUID() },
          { type: 'exit', text: '[Git push completed successfully]', id: crypto.randomUUID() },
        ]);
      } else {
        setTerminalLogs((prev) => [
          ...prev,
          { type: 'error', text: `Git push failed: ${data.error}`, id: crypto.randomUUID() },
        ]);
      }
    } catch (err: any) {
      setTerminalLogs((prev) => [
        ...prev,
        { type: 'error', text: `Git push failed: ${err.message}`, id: crypto.randomUUID() },
      ]);
    } finally {
      setGitPushing(false);
    }
  }

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

  const IGNORED_DIRS = ['.git', 'node_modules', '.next', '.open-next', 'dist', 'build', '.gemini', 'coverage', '.DS_Store', '.cache', '.turbo'];
  const ALLOWED_FILE_EXT = [
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.py', '.html', '.css',
    '.yaml', '.yml', '.toml', '.sql', '.env.example', '.dart', '.rs', '.go',
    '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.sh', '.csv', '.graphql', '.prisma'
  ];
  const ALLOWED_EXACT_FILES = ['Dockerfile', 'Makefile', 'README', 'LICENSE', 'Procfile', '.env.example', 'pubspec.yaml', 'Cargo.toml', 'package.json'];

  // Helper to read files recursively from a directory handle (Chrome / Edge)
  async function readFilesFromDirectory(dirHandle: any, currentPath = ''): Promise<Array<{ path: string; content: string }>> {
    let results: Array<{ path: string; content: string }> = [];

    for await (const entry of dirHandle.values()) {
      if (IGNORED_DIRS.includes(entry.name) || (entry.name.startsWith('.') && !ALLOWED_EXACT_FILES.includes(entry.name))) continue;

      const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      if (entry.kind === 'file') {
        const ext = entry.name.includes('.') ? `.${entry.name.split('.').pop()}` : '';
        if (ALLOWED_FILE_EXT.includes(ext.toLowerCase()) || ALLOWED_EXACT_FILES.includes(entry.name)) {
          try {
            const file = await entry.getFile();
            if (file.size < 256 * 1024) {
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

      if (results.length >= 100) break;
    }

    return results;
  }

  // Helper to read files from a standard browser FileList (Safari, Firefox, Mobile, Drag-and-Drop)
  async function readFilesFromFileList(fileList: FileList): Promise<Array<{ path: string; content: string }>> {
    const results: Array<{ path: string; content: string }> = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const relPath = file.webkitRelativePath || file.name;
      const isIgnored = IGNORED_DIRS.some((ig) => relPath.includes(`/${ig}/`) || relPath.startsWith(`${ig}/`));
      if (isIgnored) continue;

      const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
      if (ALLOWED_FILE_EXT.includes(ext.toLowerCase()) || ALLOWED_EXACT_FILES.includes(file.name)) {
        if (file.size < 256 * 1024) {
          try {
            const content = await file.text();
            results.push({ path: relPath, content });
          } catch {
            // ignore
          }
        }
      }
      if (results.length >= 100) break;
    }

    return results;
  }

  // Bulk ingest files directly into the target project in Cloudflare D1
  async function ingestFilesIntoProject(targetProj: Project, files: Array<{ path: string; content: string }>) {
    if (files.length === 0) {
      alert('No supported source or text files found in the selected folder.');
      return;
    }

    setSyncingFiles(true);
    try {
      const res = await fetch(`/api/v1/projects/${targetProj.id}/files/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save files.');
      }

      setProjectFiles(files);
      setSyncBannerMessage(`✓ Successfully synced ${files.length} files from "${targetProj.name}" into cloud workspace!`);
      setTimeout(() => setSyncBannerMessage(null), 5000);
    } catch (err: any) {
      alert(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncingFiles(false);
    }
  }

  // Sync or bind local folder (Works across Chrome, Edge, Safari, Firefox, and Electron Desktop)
  async function handleConnectOrSyncFolder(targetProjectId?: string) {
    const activeTargetProj = targetProjectId
      ? projects.find((p) => p.id === targetProjectId) || currentProject
      : currentProject;

    // 0. Native Desktop App Folder Picker (Electron)
    if (typeof window !== 'undefined' && (window as any).shazamDesktop) {
      try {
        const selectedDir = await (window as any).shazamDesktop.selectFolder();
        if (selectedDir) {
          const folderName = selectedDir.split('/').pop() || 'Workspace';
          let proj = activeTargetProj;
          if (!proj || proj.name !== folderName) {
            const existing = projects.find((p) => p.name.toLowerCase() === folderName.toLowerCase());
            if (existing) {
              proj = existing;
            } else {
              const res = await fetch('/api/v1/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: folderName, rootDir: selectedDir }),
              });
              const data = await res.json();
              if (data.project) {
                proj = data.project;
                setProjects((prev) => [data.project, ...prev]);
              }
            }
          }
          if (proj) {
            setCurrentProject(proj);
            setExpandedProjects((prev) => ({ ...prev, [proj.id]: true }));
            setSyncBannerMessage(`✓ Bound native desktop folder: "${selectedDir}"`);
            setTimeout(() => setSyncBannerMessage(null), 4000);
          }
          return;
        }
      } catch {}
    }

    // A. Native File System Access API (Chrome, Edge, Opera)
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        const folderName = dirHandle.name;

        let proj = activeTargetProj;

        // If no active project or folder name differs and target isn't explicitly set, match or create
        if (!proj || (!targetProjectId && proj.name !== folderName)) {
          const existing = projects.find((p) => p.name.toLowerCase() === folderName.toLowerCase());
          if (existing) {
            proj = existing;
          } else {
            const res = await fetch('/api/v1/projects', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: folderName, rootDir: `~/${folderName}` }),
            });
            const data = await res.json();
            const createdProj: Project | undefined = data.project;
            if (createdProj) {
              proj = createdProj;
              setProjects((prev) => [createdProj, ...prev]);
            }
          }
        }

        if (proj) {
          setCurrentProject(proj);
          setExpandedProjects((prev) => ({ ...prev, [proj.id]: true }));

          const files = await readFilesFromDirectory(dirHandle);
          await ingestFilesIntoProject(proj, files);
        }
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled dialog
        // Fallback to hidden HTML file input
      }
    }

    // B. Universal Fallback via HTML5 webkitdirectory input (Safari, Firefox, Mobile)
    folderInputRef.current?.click();
  }

  // Handle standard HTML folder input change
  async function handleFolderInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Detect folder name from webkitRelativePath
    const firstRel = files[0].webkitRelativePath || '';
    const folderName = firstRel.split('/')[0] || currentProject?.name || 'Workspace';

    let proj: Project | null = currentProject;
    if (!proj || proj.name !== folderName) {
      const existing = projects.find((p) => p.name.toLowerCase() === folderName.toLowerCase());
      if (existing) {
        proj = existing;
      } else {
        const res = await fetch('/api/v1/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, rootDir: `~/${folderName}` }),
        });
        const data = await res.json();
        const createdProj: Project | undefined = data.project;
        if (createdProj) {
          proj = createdProj;
          setProjects((prev) => [createdProj, ...prev]);
        }
      }
    }

    if (proj) {
      setCurrentProject(proj);
      setExpandedProjects((prev) => ({ ...prev, [proj.id]: true }));
      const parsedFiles = await readFilesFromFileList(files);
      await ingestFilesIntoProject(proj, parsedFiles);
    }

    // Reset input
    e.target.value = '';
  }

  // Handle single/multi file upload input change
  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !currentProject) return;

    const parsedFiles = await readFilesFromFileList(files);
    await ingestFilesIntoProject(currentProject, parsedFiles);
    e.target.value = '';
  }

  // Handle Drag & Drop of files/folder
  async function handleDropFiles(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);

    if (!currentProject) {
      alert('Please select or create a project first before dropping files.');
      return;
    }

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const parsedFiles = await readFilesFromFileList(files);
    await ingestFilesIntoProject(currentProject, parsedFiles);
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
    setStreamingSteps([]);
    setStreamingReadLog(['Analyzing project requirements...', 'Reviewing workspace context...']);

    const currentTurnSteps: Array<{
      step: number;
      thought: string;
      tool: string;
      args?: any;
      observation?: string;
      isError?: boolean;
    }> = [];

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Contextual prompt with real project files
    let contextualPrompt = textToSend;
    if (currentProject) {
      if (projectFiles.length > 0) {
        const index = buildProjectIndex(projectFiles);

        contextualPrompt = `You are an expert AI software engineer working on the user's project "${currentProject.name}".
Codebase Architecture & Symbols:
${index.summaryPrompt}

Instructions:
- When modifying EXISTING files, ALWAYS use surgical search-and-replace blocks (preserves file integrity):
<<<< SEARCH: path/to/file.ext
[exact lines of code to replace]
====
[new replacement code]
>>>>
- When creating a BRAND NEW file, output:
### File: path/to/file.ext
\`\`\`language
...code...
\`\`\`
- If the user asks how to run, test, build, or deploy the project locally (e.g. "run local"), inspect the project's package managers, entrypoints, and scripts to give clear, copy-pasteable terminal commands step-by-step.
- You can reference and update multiple files in a single response.

User Request:
${textToSend}`;
      } else {
        contextualPrompt = `You are an expert AI software engineer and product architect working with the user on their project "${currentProject.name}".
The user has bound this project in Shazam.
Provide a clear, high-level analysis of what "${currentProject.name}" represents, recommend architectural patterns and implementation steps, and invite the user to sync local files or upload specs whenever they want granular file-level edits.

User Request:
${textToSend}`;
      }
    }

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: contextualPrompt,
          conversationId: currentConversationId || undefined,
          projectId: currentProject?.id || undefined,
          taskClassOverride: 'coding',
          pinnedModelName: selectedModel === 'auto' ? undefined : selectedModel,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error('Your session has expired. Please sign in to run tasks.');
        } else if (res.status === 429) {
          throw new Error('Task rate limit reached. Please wait a moment before sending more requests.');
        } else if (res.status >= 500) {
          throw new Error('Execution engine is temporarily unavailable. Please retry in a few moments.');
        }
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
            } else if (eventType === 'react_step') {
              currentTurnSteps.push({
                step: data.step,
                thought: data.thought || '',
                tool: data.tool || '',
                args: data.args || {},
              });
              setStreamingSteps([...currentTurnSteps]);
            } else if (eventType === 'react_observation') {
              const existing = currentTurnSteps.find((s) => s.step === data.step);
              if (existing) {
                existing.observation = data.observation;
                existing.isError = data.isError;
              } else {
                currentTurnSteps.push({
                  step: data.step,
                  thought: '',
                  tool: 'observation',
                  observation: data.observation,
                  isError: data.isError,
                });
              }
              setStreamingSteps([...currentTurnSteps]);
            } else if (eventType === 'done') {
              fullOutput = data.fullText || fullOutput;
              setStreamingOutput(fullOutput);
            }
          } catch {
            // ignore
          }
        }
      }

      // Parse surgical code patches & new file creations (Claude Code / Antigravity standard)
      const parsedPatches = parsePatchesFromText(fullOutput);
      const generatedFiles: Array<{ path: string; added: number; deleted: number; code?: string }> = [];
      const activeToken = daemonToken || (typeof window !== 'undefined' ? localStorage.getItem('shazam_daemon_token') || '' : '');

      for (const patch of parsedPatches) {
        if (patch.type === 'search_replace') {
          // Surgical Search & Replace
          const existing = projectFiles.find(
            (f) => f.path.toLowerCase() === patch.path.toLowerCase() ||
                   f.path.toLowerCase().endsWith(patch.path.toLowerCase())
          );

          if (existing) {
            const applyRes = applySearchReplace(existing.content, patch);
            if (applyRes.success && applyRes.updatedContent) {
              const mergedCode = applyRes.updatedContent;
              generatedFiles.push({
                path: patch.path,
                added: applyRes.linesAdded,
                deleted: applyRes.linesDeleted,
                code: mergedCode,
              });

              if (currentProject) {
                fetch(`/api/v1/projects/${currentProject.id}/files`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: patch.path, content: mergedCode }),
                })
                  .then(() => loadProjectFiles(currentProject.id))
                  .catch(() => {});
              }
            }
          }

          // Apply surgical patch to local disk via companion daemon
          if (daemonStatus === 'connected') {
            fetch('http://localhost:4040/api/files/patch', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-shazam-token': activeToken,
              },
              body: JSON.stringify({
                filePath: patch.path,
                searchBlock: patch.searchBlock,
                replaceBlock: patch.replaceBlock,
              }),
            }).catch(console.error);
          }
        } else if (patch.type === 'full_file') {
          // Full File Creation
          const lineCount = patch.content.split('\n').length;
          generatedFiles.push({
            path: patch.path,
            added: lineCount,
            deleted: 0,
            code: patch.content,
          });

          if (currentProject) {
            fetch(`/api/v1/projects/${currentProject.id}/files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: patch.path, content: patch.content }),
            })
              .then(() => loadProjectFiles(currentProject.id))
              .catch(() => {});
          }

          if (daemonStatus === 'connected') {
            fetch('http://localhost:4040/api/files/write', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-shazam-token': activeToken,
              },
              body: JSON.stringify({ filePath: patch.path, content: patch.content }),
            }).catch(console.error);
          }
        }
      }

      // Backward-compatible Fallback: If model wrote generic code block without explicit headers
      if (generatedFiles.length === 0) {
        const genericCodeRegex = /```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
        const singleMatch = genericCodeRegex.exec(fullOutput);
        if (singleMatch && singleMatch[1]) {
          const code = singleMatch[1].trim();
          const firstLine = code.split('\n')[0] || '';
          const commentPathMatch = firstLine.match(/^(?:\/\/|#|\/\*)\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)/);
          const detectedPath = commentPathMatch ? commentPathMatch[1].trim() : 'src/App.tsx';
          const lineCount = code.split('\n').length;

          generatedFiles.push({
            path: detectedPath,
            added: lineCount,
            deleted: Math.max(1, Math.floor(lineCount / 4)),
            code,
          });

          if (currentProject) {
            fetch(`/api/v1/projects/${currentProject.id}/files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: detectedPath, content: code }),
            })
              .then(() => loadProjectFiles(currentProject.id))
              .catch(() => {});
          }

          if (daemonStatus === 'connected') {
            fetch('http://localhost:4040/api/files/write', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-shazam-token': activeToken,
              },
              body: JSON.stringify({ filePath: detectedPath, content: code }),
            }).catch(console.error);
          }
        }
      }

      const assistantMsg: CoWorkMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullOutput,
        thought: fullThought || undefined,
        steps: currentTurnSteps.length > 0 ? currentTurnSteps : undefined,
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
      setStreamingSteps([]);
    }
  }

  function handleCopyFileCode() {
    if (!inspectFile) return;
    navigator.clipboard.writeText(inspectFile.content);
    setFileCopied(true);
    setTimeout(() => setFileCopied(false), 2000);
  }

  // Open file in viewer drawer from clickable link in markdown or search
  function handleOpenFile(targetPath: string) {
    if (!projectFiles || projectFiles.length === 0) return;
    const cleanTarget = targetPath.trim().replace(/^['"`]|['"`]$/g, '');
    const found = projectFiles.find(
      (f) =>
        f.path.toLowerCase() === cleanTarget.toLowerCase() ||
        f.path.toLowerCase().endsWith(cleanTarget.toLowerCase()) ||
        cleanTarget.toLowerCase().endsWith(f.path.toLowerCase())
    );

    if (found) {
      setInspectFile({ path: found.path, content: found.content });
    } else {
      setInspectFile({ path: cleanTarget, content: `// File "${cleanTarget}" referenced in conversation.` });
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={handleDropFiles}
      className="flex-1 h-full min-h-0 min-w-0 flex bg-[#0a0c10] text-zinc-100 overflow-hidden font-sans relative"
    >
      {/* Hidden File & Directory Inputs (Safari, Firefox, Chrome universal) */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard across modern browsers
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFolderInputChange}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Drag & Drop Visual Dropzone Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center border-2 border-dashed border-amber-400 text-amber-300 space-y-3 pointer-events-none">
          <FolderOpen className="w-14 h-14 text-amber-400 animate-bounce" />
          <p className="text-base font-semibold text-white">Drop your files or folder to sync</p>
          <p className="text-xs text-zinc-400">
            Files will be parsed and indexed directly into {currentProject?.name || 'this workspace'}.
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. Left Antigravity-Style Project Tree Sidebar (Strictly Project Scoped) */}
      {/* ========================================================================= */}
      <aside className="w-64 h-full shrink-0 border-r border-white/[0.06] bg-[#07080c] flex flex-col select-none overflow-hidden z-20">
        {/* Top Actions: Search & + New Chat */}
        <div className="p-3 space-y-2 border-b border-white/[0.05] shrink-0">
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
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-4">
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
      <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col bg-[#0b0d13] overflow-hidden relative">
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

          {/* Actions & Local Bridge Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Desktop Native App Badge */}
            {isDesktopApp && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-mono text-amber-300 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="font-semibold">Native Desktop</span>
              </div>
            )}

            {/* Local Bridge Status Pill */}
            {daemonStatus === 'connected' ? (
              <button
                onClick={() => setTerminalOpen(!terminalOpen)}
                className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-[11px] font-medium text-emerald-300 transition shadow-sm"
                title={`Connected to local project at ${daemonInfo?.cwd || 'localhost:4040'}. Click to toggle terminal.`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="font-mono">Local: Connected</span>
                <Terminal className="w-3 h-3 text-emerald-400 ml-0.5" />
              </button>
            ) : (
              <button
                onClick={() => setShowBridgeModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition"
                title="Connect local companion daemon to run code and push to GitHub directly"
              >
                <span className="w-2 h-2 rounded-full bg-zinc-600"></span>
                <span className="hidden sm:inline">Local Bridge:</span>
                <span>Offline</span>
                <span className="text-[10px] text-amber-400 font-mono ml-0.5">(Connect)</span>
              </button>
            )}

            {/* Quick Terminal Drawer Toggle Button */}
            <button
              onClick={() => setTerminalOpen(!terminalOpen)}
              className={`p-1.5 rounded-lg border transition text-xs flex items-center gap-1 ${
                terminalOpen
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/5 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Toggle Terminal Console"
            >
              <Terminal className="w-4 h-4" />
            </button>

            {/* Quick Git Push Button if daemon is connected */}
            {daemonStatus === 'connected' && (
              <button
                onClick={handleGitPush}
                disabled={gitPushing}
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[11px] font-medium text-zinc-200 transition"
                title="Push changes to GitHub repository via local git"
              >
                <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                <span>{gitPushing ? 'Pushing...' : 'Git Push'}</span>
              </button>
            )}

            <Link
              href="/settings"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-[11px] font-medium text-zinc-400 hover:text-amber-300 transition"
            >
              <Network className="w-3.5 h-3.5 text-emerald-400" />
              <span>Connectors</span>
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

        {/* Chat Messages Scrollable Area (min-h-0 ensures strictly this container scrolls) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
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

                      {/* Autonomous Multi-Step ReAct Stepper */}
                      {msg.steps && msg.steps.length > 0 && (
                        <ReActStepper steps={msg.steps} />
                      )}

                      {/* Main Text Content */}
                      <MarkdownRenderer content={msg.content} onOpenFile={handleOpenFile} />

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

                  {/* Live Autonomous ReAct Stepper */}
                  {streamingSteps.length > 0 && (
                    <ReActStepper steps={streamingSteps} isLive={true} />
                  )}

                  {streamingOutput ? (
                    <MarkdownRenderer content={streamingOutput} onOpenFile={handleOpenFile} />
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

        {/* ========================================================================= */}
        {/* Terminal Console Panel (Docked directly into the chat & execution canvas) */}
        {/* ========================================================================= */}
        {terminalOpen && (
          <div className="shrink-0 border-t border-white/10 bg-[#07090e] flex flex-col z-20 animate-in slide-in-from-bottom duration-150 h-72">
            {/* Terminal Header */}
            <div className="h-9 px-3 bg-black/60 border-b border-white/[0.06] flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-mono font-semibold text-zinc-200">
                  Terminal
                </span>
                {daemonStatus === 'connected' ? (
                  <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    localhost:4040 · {daemonInfo?.projectName || 'live'}
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-500 font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                    Bridge Offline
                  </span>
                )}
              </div>

              {/* Quick Action Commands */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => runLocalCommand('npm run dev')}
                  disabled={daemonStatus !== 'connected' || executingCmd}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 border border-white/10 text-[10px] font-mono text-amber-300 flex items-center gap-1 transition"
                  title="Run local development server"
                >
                  <Play className="w-2.5 h-2.5 text-amber-400" />
                  <span>npm run dev</span>
                </button>

                <button
                  onClick={() => runLocalCommand('npm test')}
                  disabled={daemonStatus !== 'connected' || executingCmd}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 border border-white/10 text-[10px] font-mono text-zinc-300 flex items-center gap-1 transition"
                  title="Run test suite"
                >
                  <span>npm test</span>
                </button>

                <button
                  onClick={handleGitPush}
                  disabled={daemonStatus !== 'connected' || gitPushing}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 border border-white/10 text-[10px] font-mono text-blue-300 flex items-center gap-1 transition"
                  title="Commit and push changes to GitHub"
                >
                  <GitBranch className="w-2.5 h-2.5 text-blue-400" />
                  <span>{gitPushing ? 'pushing...' : 'git push'}</span>
                </button>

                <button
                  onClick={() => setTerminalLogs([])}
                  className="p-1 rounded hover:bg-white/5 text-zinc-500 hover:text-zinc-300 text-[10px] font-mono transition"
                  title="Clear logs"
                >
                  Clear
                </button>

                <button
                  onClick={() => setTerminalOpen(false)}
                  className="p-1 rounded hover:bg-white/5 text-zinc-400 hover:text-white transition"
                  title="Close Terminal"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Terminal Body / Output */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed space-y-1 bg-[#050608]">
              {daemonStatus !== 'connected' && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] mb-2 flex items-center justify-between">
                  <span>Companion daemon is not running on localhost:4040. Run <b>npm run daemon</b> in your terminal to enable local commands.</span>
                  <button onClick={() => setShowBridgeModal(true)} className="underline font-bold hover:text-white">Setup</button>
                </div>
              )}
              {terminalLogs.map((log) => (
                <div
                  key={log.id}
                  className={
                    log.type === 'cmd'
                      ? 'text-amber-400 font-semibold'
                      : log.type === 'stderr' || log.type === 'error'
                      ? 'text-red-400'
                      : log.type === 'exit'
                      ? 'text-emerald-400 font-semibold'
                      : log.type === 'info'
                      ? 'text-zinc-500 italic'
                      : 'text-zinc-300'
                  }
                >
                  <pre className="whitespace-pre-wrap font-mono break-all">{log.text}</pre>
                </div>
              ))}
              <div ref={terminalLogsEndRef} />
            </div>

            {/* Terminal Input Bar */}
            <div className="h-9 px-3 bg-black/60 border-t border-white/[0.06] flex items-center gap-2">
              <span className="text-zinc-500 font-mono text-xs font-bold">$</span>
              <input
                type="text"
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customCmd.trim()) {
                    runLocalCommand(customCmd.trim());
                  }
                }}
                disabled={daemonStatus !== 'connected' || executingCmd}
                placeholder={
                  daemonStatus === 'connected'
                    ? 'Type shell command and press Enter (e.g. npm run dev, git status, ls)...'
                    : 'Start companion daemon ("npm run daemon") to run commands...'
                }
                className="flex-1 bg-transparent text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
              {executingCmd && (
                <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  Running...
                </span>
              )}
            </div>
          </div>
        )}

        {/* Bottom Floating Prompt Input (shrink-0 ensures it stays permanently fixed at the bottom!) */}
        <div className="shrink-0 p-4 sm:p-6 bg-gradient-to-t from-[#0a0c10] via-[#0a0c10]/95 to-transparent z-20">
          <div className="max-w-3xl mx-auto space-y-2">
            {/* Sync Feedback Alert */}
            {syncBannerMessage && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between shadow-lg animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{syncBannerMessage}</span>
                </div>
                <button onClick={() => setSyncBannerMessage(null)} className="hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Zero-Files Helper Banner for Connected Project */}
            {currentProject && projectFiles.length === 0 && !syncBannerMessage && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-lg animate-in fade-in duration-150">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-100">
                      Project <span className="text-amber-300 font-mono">&ldquo;{currentProject.name}&rdquo;</span> is connected
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Sync your local folder or upload code files so Shazam can read and digest the codebase.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleConnectOrSyncFolder(currentProject.id)}
                    disabled={syncingFiles}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs flex items-center gap-1.5 transition shadow-sm"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>{syncingFiles ? 'Syncing...' : 'Sync Local Folder'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => filesInputRef.current?.click()}
                    disabled={syncingFiles}
                    className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs flex items-center gap-1.5 transition border border-white/10"
                  >
                    <FileText className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Upload Files</span>
                  </button>
                </div>
              </div>
            )}

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
                  onClick={() => handleConnectOrSyncFolder(currentProject?.id)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-[11px] font-medium text-amber-300 hover:text-amber-200 flex items-center gap-1.5 transition shadow-sm"
                  title="Connected Project Folder (click to re-sync or change)"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold">{currentProject ? currentProject.name : 'Connect Local Folder'}</span>
                  {projectFiles.length > 0 ? (
                    <span className="text-[10px] text-emerald-400 font-mono">({projectFiles.length} files synced)</span>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-mono">(Sync files)</span>
                  )}
                </button>

                {/* Model Selector Dropdown Pill */}
                <div className="relative inline-flex items-center">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="appearance-none px-2.5 py-1 pr-6 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 text-[11px] font-medium text-zinc-300 focus:outline-none focus:border-amber-500/40 transition cursor-pointer select-none"
                    title="Choose AI Model or Auto-Route"
                  >
                    <option value="auto" className="bg-[#0f1118] text-zinc-200">⚡ Auto (Smart Route)</option>
                    <option value="claude-sonnet-5-5" className="bg-[#0f1118] text-zinc-200">🟣 Claude 3.5 Sonnet</option>
                    <option value="gpt-6.1-terra" className="bg-[#0f1118] text-zinc-200">🟢 GPT-4o</option>
                    <option value="gemini-3.8-flash" className="bg-[#0f1118] text-zinc-200">🔵 Gemini 2.0 Flash</option>
                    <option value="deepseek-flash" className="bg-[#0f1118] text-zinc-200">🧠 DeepSeek V3</option>
                  </select>
                  <ChevronDown className="w-3 h-3 text-zinc-400 pointer-events-none absolute right-2" />
                </div>
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
        <aside className="w-[480px] h-full shrink-0 border-l border-white/[0.08] bg-[#0c0e14] flex flex-col z-30 animate-in slide-in-from-right duration-200 shadow-2xl overflow-hidden">
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
                placeholder="e.g. My Next.js App, SaaS, Mobile App"
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

      {/* ========================================================================= */}
      {/* 6. Local Companion Bridge Setup Modal                                      */}
      {/* ========================================================================= */}
      {showBridgeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f1118] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Local Companion Bridge</h3>
                  <p className="text-xs text-zinc-400">Run code, edit disk files, & push to Git</p>
                </div>
              </div>
              <button
                onClick={() => setShowBridgeModal(false)}
                className="p-1 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300">
              <p>
                To enable <b>real terminal execution</b> (e.g. <code className="text-amber-300 font-mono">npm run dev</code>, tests, git push) directly from the web interface, run the local daemon in your project directory:
              </p>

              <div className="p-3 rounded-xl bg-black/60 border border-white/10 font-mono text-[11px] text-amber-300 space-y-1">
                <div className="text-zinc-500"># Start local loopback companion daemon (port 4040)</div>
                <div className="flex items-center justify-between">
                  <span>npm run daemon</span>
                  <button
                    onClick={() => navigator.clipboard.writeText('npm run daemon')}
                    className="p-1 hover:text-white"
                    title="Copy command"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1 text-zinc-400 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Updates code files directly on your local machine</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Streams live terminal output to the web console</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>1-click Git Push to your GitHub repository</span>
                </div>
              </div>

              {/* Security Token Input */}
              <div className="pt-2 border-t border-white/5 space-y-1.5">
                <label className="block text-[11px] font-semibold text-zinc-300">
                  Security Token <span className="text-zinc-500 font-normal">(Printed by daemon upon startup)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder="Enter security token (e.g. 8f2c...)"
                    value={daemonToken}
                    onChange={(e) => {
                      setDaemonToken(e.target.value);
                      localStorage.setItem('shazam_daemon_token', e.target.value);
                    }}
                    className="flex-1 px-3 py-1.5 bg-black/50 border border-white/10 rounded-xl font-mono text-xs text-amber-300 placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => checkDaemon(daemonToken)}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-zinc-200 border border-white/10"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/10">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className={`w-2 h-2 rounded-full ${daemonStatus === 'connected' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                <span className={daemonStatus === 'connected' ? 'text-emerald-400' : 'text-zinc-400'}>
                  {daemonStatus === 'connected' ? 'Connected!' : 'Waiting for connection...'}
                </span>
              </div>

              <button
                type="button"
                onClick={async () => {
                  const ok = await checkDaemon();
                  if (ok) {
                    setShowBridgeModal(false);
                    setTerminalOpen(true);
                  }
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl transition shadow-md flex items-center gap-1.5"
              >
                <span>{daemonStatus === 'connected' ? 'Open Terminal' : 'Check Connection'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
