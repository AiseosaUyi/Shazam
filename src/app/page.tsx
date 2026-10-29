'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowUp,
  Square,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Info,
  ChevronRight,
  ChevronDown,
  Plus,
  MessageSquare,
  Trash2,
  Sparkles,
  AlertCircle,
  Cpu,
  Layers,
  ArrowRightLeft,
  X,
  Code2,
  SlidersHorizontal,
  Compass,
  FileText,
  Zap,
  CheckCircle2,
  Folder,
  FolderOpen,
  Paperclip,
  Clock,
  Palette,
  Sliders,
  Search,
  Pin,
  Mic,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { CostPolicy, TaskClass, Model } from '@/lib/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  taskId?: string | null;
  routeInfo?: any;
}

interface ConversationItem {
  id: string;
  title: string;
  projectId?: string | null;
  updatedAt: string;
}

interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
}

export default function WorkspacePage() {
  const [user, setUser] = useState<{ email: string; name?: string; role?: string } | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [costPolicy, setCostPolicy] = useState<CostPolicy>('balanced');
  const [taskClassOverride, setTaskClassOverride] = useState<string>('auto');
  const [pinnedModelName, setPinnedModelName] = useState<string>('');

  // Context & Projects State
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<{ name: string; files: Array<{ path: string; content: string }> } | null>(null);
  const [attachedDocs, setAttachedDocs] = useState<Array<{ name: string; content: string }>>([]);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  const [models, setModels] = useState<Model[]>([]);
  const [connectedProviders, setConnectedProviders] = useState<Record<string, boolean>>({});
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');
  const [activeRouteInfo, setActiveRouteInfo] = useState<any>(null);
  const [selectedDisclosure, setSelectedDisclosure] = useState<any>(null);
  const [routingMenuOpen, setRoutingMenuOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, number>>({});
  const [errorBanner, setErrorBanner] = useState<{
    message: string;
    subtext?: string;
    details?: string;
    fixAction?: string;
    fixHref?: string;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Real Workspace Artifacts State
  const [showArtifactsModal, setShowArtifactsModal] = useState(false);
  const [artifactsList, setArtifactsList] = useState<Array<{ path: string; content: string; updated_at?: string }>>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<{ path: string; content: string } | null>(null);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);

  async function loadArtifacts() {
    setLoadingArtifacts(true);
    setShowArtifactsModal(true);
    try {
      const res = await fetch('/api/v1/workspace/files');
      if (res.ok) {
        const data = await res.json();
        setArtifactsList(data.files || []);
      }
    } catch {} finally {
      setLoadingArtifacts(false);
    }
  }

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Time of day greeting (Morning, Afternoon, Evening, Night)
  function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Morning, how are things?';
    if (hour >= 12 && hour < 17) return 'Afternoon, how are things?';
    if (hour >= 17 && hour < 22) return 'Evening, how are things?';
    return 'Good evening, how are things?';
  }

  // Load conversations, catalog & user projects
  useEffect(() => {
    fetch('/api/v1/conversations')
      .then((res) => (res.ok ? res.json() : { conversations: [] }))
      .then((data) => setConversations(data.conversations || []))
      .catch(() => {});

    fetch('/api/v1/projects')
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data) => {
        const pList = data.projects || [];
        setProjects(pList);
      })
      .catch(() => {});

    fetch('/api/v1/catalog')
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => setModels(data.models || []))
      .catch(() => {});

    // Hydrate connected providers cache and fetch live status
    try {
      const raw = localStorage.getItem('shazam_connections_cache');
      if (raw) {
        const cache = JSON.parse(raw);
        const map: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(cache)) {
          if ((v as any)?.isConnected) map[k] = true;
        }
        setConnectedProviders(map);
      }
    } catch {}

    fetch('/api/v1/providers')
      .then((res) => (res.ok ? res.json() : { providers: [] }))
      .then((data) => {
        const map: Record<string, boolean> = {};
        for (const p of data.providers || []) {
          if (p.isConnected) map[p.id] = true;
        }
        setConnectedProviders(map);
      })
      .catch(() => {});

    // Check URL query parameters for model pinning or local storage cache
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const m = params.get('model');
      if (m) {
        setPinnedModelName(m);
        try { localStorage.setItem('shazam_pinned_model', m); } catch {}
      } else {
        try {
          const cached = localStorage.getItem('shazam_pinned_model');
          if (cached) setPinnedModelName(cached);
        } catch {}
      }
    }

    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingReasoning]);

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  async function loadConversation(id: string) {
    setCurrentConvId(id);
    setStreamingText('');
    setStreamingReasoning('');
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/v1/conversations/${id}`);
      const data = await res.json();
      if (res.ok) {
        setMessages(data.messages || []);
      }
    } catch {
      // ignore
    }
  }

  async function handleNewChat() {
    setCurrentConvId(null);
    setMessages([]);
    setStreamingText('');
    setStreamingReasoning('');
    setErrorBanner(null);
    setActiveRouteInfo(null);
  }

  async function handleDeleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await fetch(`/api/v1/conversations/${id}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConvId === id) {
        handleNewChat();
      }
    } catch {
      // ignore
    }
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (currentTaskId) {
      fetch(`/api/v1/tasks/${currentTaskId}/cancel`, { method: 'POST' }).catch(() => {});
    }
    setIsStreaming(false);
  }

  // Handle document upload
  function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          setAttachedDocs((prev) => [...prev, { name: file.name, content: text.slice(0, 10000) }]);
        }
      };
      reader.readAsText(file);
    });

    setAttachMenuOpen(false);
  }

  // Native folder picker for context reading
  async function handleConnectFolder() {
    setAttachMenuOpen(false);
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support local folder picker. You can choose a project from the dropdown.');
      return;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const files: Array<{ path: string; content: string }> = [];

      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          try {
            const file = await entry.getFile();
            if (file.size < 256000 && !file.name.startsWith('.')) {
              const text = await file.text();
              files.push({ path: file.name, content: text.slice(0, 8000) });
            }
          } catch {
            // ignore
          }
        }
        if (files.length >= 8) break;
      }

      setConnectedFolder({ name: dirHandle.name, files });
    } catch {
      // cancelled
    }
  }

  async function handleSend(promptText = prompt) {
    if (!promptText.trim() || isStreaming) return;

    setErrorBanner(null);
    const userPrompt = promptText.trim();
    setPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Add user message to UI immediately
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userPrompt,
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    setStreamingText('');
    setStreamingReasoning('');
    setActiveRouteInfo(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let fullOutput = '';
    let fullReasoning = '';
    let taskId = '';
    let latestRouteInfo: any = null;

    // Bundle folder and attached document context
    let contextualPrompt = userPrompt;
    const contextBlocks: string[] = [];

    if (selectedProject) {
      contextBlocks.push(`[Active Project: ${selectedProject.name}]`);
    }

    if (connectedFolder) {
      contextBlocks.push(
        `[Connected Folder: ${connectedFolder.name}]\n` +
          connectedFolder.files.map((f) => `--- File: ${f.path} ---\n${f.content}`).join('\n\n')
      );
    }

    if (attachedDocs.length > 0) {
      contextBlocks.push(
        `[Attached Documents]\n` +
          attachedDocs.map((d) => `--- Document: ${d.name} ---\n${d.content}`).join('\n\n')
      );
    }

    if (contextBlocks.length > 0) {
      contextualPrompt = `${contextBlocks.join('\n\n')}\n\n${userPrompt}`;
    }

    // Check if this is an image generation request
    const isImagePrompt = /^(draw|paint|sketch|illustrate|render|generate (an? )?(image|picture|photo)|create (an? )?(image|picture|photo)|picture of|photo of|illustration of)\b/i.test(userPrompt.trim());
    const isPinnedImage = pinnedModelName && (pinnedModelName.toLowerCase().includes('flux') || pinnedModelName.toLowerCase().includes('image'));
    
    // If prompt is an image request, avoid passing a text-only pinned model that would cause collision
    const effectivePinned = isImagePrompt && !isPinnedImage
      ? undefined
      : (pinnedModelName || undefined);

    const effectiveTaskClass = isPinnedImage || isImagePrompt
      ? 'image_generation'
      : (taskClassOverride === 'auto' ? undefined : taskClassOverride);

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: contextualPrompt,
          conversationId: currentConvId || undefined,
          costPolicy,
          taskClassOverride: effectiveTaskClass,
          pinnedModelName: effectivePinned,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const rawErr = errJson.error || 'Failed to dispatch task.';
        throw new Error(rawErr);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming response body unavailable.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            const remaining = buffer.trim();
            let eventType = 'message';
            let dataStr = '';
            for (const line of remaining.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7).trim();
              else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
            }
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (eventType === 'delta') {
                  fullOutput += data.text || '';
                  setStreamingText(fullOutput);
                } else if (eventType === 'done') {
                  fullOutput = data.fullText || fullOutput;
                  setStreamingText(fullOutput);
                } else if (eventType === 'error') {
                  throw new Error(data.message || 'Execution error');
                }
              } catch (e: any) {
                if (e.message && e.message !== 'Unexpected token') throw e;
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed) continue;

          let eventType = 'message';
          let dataStr = '';

          const sublines = trimmed.split('\n');
          for (const line of sublines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === 'task_created') {
              taskId = data.taskId;
              setCurrentTaskId(data.taskId);
              if (data.conversationId && !currentConvId) {
                setCurrentConvId(data.conversationId);
                fetch('/api/v1/conversations')
                  .then((r) => r.json())
                  .then((d) => setConversations(d.conversations || []))
                  .catch(() => {});
              }
            } else if (eventType === 'route_selected') {
              latestRouteInfo = data;
              setActiveRouteInfo(data);
            } else if (eventType === 'delta') {
              fullOutput += data.text || '';
              setStreamingText(fullOutput);
            } else if (eventType === 'reasoning') {
              fullReasoning += data.text || '';
              setStreamingReasoning(fullReasoning);
            } else if (eventType === 'fallback') {
              fullOutput = '';
              fullReasoning = '';
              setStreamingText('');
              setStreamingReasoning('');
              latestRouteInfo = {
                ...latestRouteInfo,
                fallback: data,
              };
              setActiveRouteInfo(latestRouteInfo);
            } else if (eventType === 'done') {
              fullOutput = data.fullText || fullOutput;
              setStreamingText(fullOutput);
            } else if (eventType === 'error') {
              throw new Error(data.message || 'Execution error');
            }
          } catch (e: any) {
            if (e.message && e.message !== 'Unexpected token') {
              throw e;
            }
          }
        }
      }

      // Add completed assistant message to history if content was received
      if (fullOutput.trim()) {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullOutput,
          reasoning: fullReasoning || undefined,
          taskId,
          routeInfo: latestRouteInfo,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error('No response was generated by the provider. Please verify your connection.');
      }
      setStreamingText('');
      setStreamingReasoning('');
    } catch (err: any) {
      setStreamingText('');
      setStreamingReasoning('');
      if (err.name === 'AbortError') {
        // aborted cleanly
      } else {
        const rawMsg = err.message || 'Execution failed.';
        let userMessage = 'Unable to complete this request.';
        let subtext: string | undefined = undefined;
        let fixAction: string | undefined = undefined;
        let fixHref: string | undefined = undefined;

        if (rawMsg.includes('Unauthorized')) {
          userMessage = 'Sign in required to send messages.';
          subtext = 'Create a free account or sign in with your email to start chatting with intelligent model routing.';
          fixAction = 'Sign In';
          fixHref = '/login';
        } else if (rawMsg.includes('No valid API key') || rawMsg.includes('No API key')) {
          userMessage = 'No AI provider is connected yet.';
          subtext = 'To chat for free, connect a 100% free Google Gemini key in under 30 seconds (no credit card or billing ever required).';
          fixAction = 'Connect Free Key (30s)';
          fixHref = '/connections';
        } else if (
          rawMsg.includes('Invalid or missing API key') ||
          rawMsg.includes('Invalid API key') ||
          rawMsg.includes('API key not valid') ||
          rawMsg.includes('unregistered callers') ||
          rawMsg.includes('API_KEY_INVALID')
        ) {
          userMessage = 'API Key Issue';
          subtext = rawMsg.length > 250 ? rawMsg.slice(0, 250) + '...' : rawMsg;
          fixAction = 'Update Key in Connections';
          fixHref = '/connections';
        } else if (rawMsg.includes('Access denied by') || rawMsg.includes('PERMISSION_DENIED')) {
          userMessage = 'Provider Access Denied';
          subtext = rawMsg.length > 250 ? rawMsg.slice(0, 250) + '...' : rawMsg;
          fixAction = 'Check Key in Connections';
          fixHref = '/connections';
        } else if (rawMsg.includes('Google returned:') || rawMsg.includes('Google returned an error')) {
          userMessage = 'Google Provider Error';
          subtext = rawMsg;
          fixAction = 'Manage Keys';
          fixHref = '/connections';
        } else if (rawMsg.includes('Free-Only policy strictly excludes') || rawMsg.includes('No eligible routes found under policy "free only"')) {
          userMessage = 'No free models are available for this specific task.';
          subtext = 'Switch to Balanced policy or connect a free provider key.';
          fixAction = 'Switch to Balanced';
        } else if (rawMsg.includes('No eligible routes found')) {
          userMessage = 'No available models match your current settings.';
          subtext = 'Try switching your policy to Balanced or check your connected providers.';
          fixAction = 'Switch to Balanced';
        } else {
          userMessage = rawMsg;
        }

        setErrorBanner({
          message: userMessage,
          subtext,
          details: rawMsg,
          fixAction,
          fixHref,
        });
      }
    } finally {
      setIsStreaming(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleFeedback(tId: string, rating: number) {
    try {
      await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: tId, rating }),
      });
      setFeedbackSent((prev) => ({ ...prev, [tId]: rating }));
    } catch {
      // ignore
    }
  }

  function renderFormattedContent(text: string) {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const firstLineEnd = part.indexOf('\n');
        const lang = part.slice(3, firstLineEnd).trim() || 'code';
        const code = part.slice(firstLineEnd + 1, -3);
        const codeId = `code_${index}`;

        return (
          <div key={index} className="my-3 rounded-2xl bg-black/60 border border-white/[0.08] overflow-hidden shadow-lg">
            <div className="px-4 py-2 bg-white/[0.03] border-b border-white/5 flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span className="uppercase tracking-wider text-[10px] text-zinc-500 font-semibold">{lang}</span>
              <button
                onClick={() => handleCopy(code, codeId)}
                className="hover:text-amber-400 flex items-center gap-1.5 transition text-xs"
              >
                {copiedId === codeId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedId === codeId ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      return (
        <span key={index} className="whitespace-pre-wrap leading-relaxed text-[14px] text-zinc-200">
          {part}
        </span>
      );
    });
  }

  const activeRoutingLabel = pinnedModelName
    ? pinnedModelName
    : costPolicy === 'free_only'
    ? 'Free Tier Only'
    : costPolicy === 'best_quality'
    ? 'Best Quality'
    : costPolicy === 'lowest_cost'
    ? 'Lowest Cost'
    : 'Auto · Free Tier';

  return (
    <div className="flex-1 h-full min-h-0 min-w-0 flex overflow-hidden ambient-glow relative font-sans">
      {/* Hidden file input for document attachments */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".txt,.md,.pdf,.csv,.json,.ts,.tsx,.py,.js,.html"
        onChange={handleDocumentUpload}
      />

      {/* ========================================================================= */}
      {/* Left Sidebar (Matching Claude / Cursor Desktop Layout in Screenshot)     */}
      {/* ========================================================================= */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#07080c] backdrop-blur-2xl border-r border-white/[0.06] flex flex-col transition-transform duration-200 md:static md:translate-x-0 select-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top: Search & + New Button */}
        <div className="p-3 space-y-2 border-b border-white/[0.05]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-xl text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-white/20 transition"
            />
          </div>

          <button
            onClick={handleNewChat}
            className="w-full py-2 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-2 transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span>New</span>
          </button>
        </div>

        {/* Real Working Navigation Links */}
        <div className="p-2 space-y-0.5 border-b border-white/[0.05] text-xs text-zinc-400 font-medium">
          <Link
            href="/agent"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 transition"
          >
            <Folder className="w-3.5 h-3.5 text-amber-400" />
            <span>Projects & Code</span>
          </Link>

          <Link
            href="/cowork"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 transition"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Co-Work Canvas</span>
          </Link>

          <button
            type="button"
            onClick={loadArtifacts}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 cursor-pointer transition text-left"
          >
            <Layers className="w-3.5 h-3.5 text-zinc-400" />
            <span>Artifacts</span>
          </button>

          <Link
            href="/connections"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 transition"
          >
            <Cpu className="w-3.5 h-3.5 text-zinc-400" />
            <span>Skills & Models</span>
          </Link>

          <Link
            href="/settings"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] hover:text-zinc-200 transition"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-400" />
            <span>Settings</span>
          </Link>
        </div>

        {/* Conversations History: Pinned & Recents */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
            Recents
          </div>

          <div className="space-y-0.5">
            {!user ? (
              <div className="p-3 mx-1 my-2 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                <Sparkles className="w-4 h-4 text-amber-400 mx-auto mb-1.5" />
                <p className="text-xs font-medium text-zinc-200">Guest Session</p>
                <p className="text-[11px] text-zinc-400 mt-1 mb-2.5 leading-relaxed">
                  Sign in to save and sync your conversations across devices.
                </p>
                <Link
                  href="/login"
                  className="inline-block px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition shadow-sm"
                >
                  Sign In
                </Link>
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-zinc-500">
                No conversations yet
              </div>
            ) : (
              conversations
                .filter((c) => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => {
                      loadConversation(conv.id);
                      setSidebarOpen(false);
                    }}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      currentConvId === conv.id
                        ? 'bg-amber-500/10 text-amber-300 font-medium'
                        : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{conv.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition rounded"
                      title="Delete chat"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* User Profile */}
        <div className="p-3 border-t border-white/[0.06] bg-black/30 flex items-center justify-between">
          {user ? (
            <div className="flex items-center gap-2 truncate">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-semibold">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <div className="truncate">
                <p className="text-xs font-medium text-white truncate">{user.name || user.email.split('@')[0]}</p>
                <p className="text-[10px] text-zinc-500">{user.role === 'admin' ? 'Administrator' : 'Free Tier'}</p>
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              className="w-full py-1.5 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-300 hover:text-white font-medium text-xs text-center transition"
            >
              Sign In to Save History
            </Link>
          )}
          {user && <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* Main Conversational Workspace                                             */}
      {/* ========================================================================= */}
      <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden relative bg-[#0b0d13]">
        {/* Subtle Top Mobile Bar */}
        <div className="md:hidden border-b border-white/[0.06] bg-[#090a0f]/80 backdrop-blur-md px-4 py-2 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg bg-white/5 text-zinc-300 flex items-center gap-2 text-xs"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chats</span>
          </button>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {/* Error Banner with Human Message */}
        {errorBanner && (
          <div className="mx-4 sm:mx-8 mt-4 p-4 rounded-2xl bg-red-950/30 border border-red-500/20 text-xs shadow-xl flex items-center justify-between gap-3 animate-in fade-in duration-200 backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-zinc-100">{errorBanner.message}</p>
                {errorBanner.subtext && <p className="text-zinc-400 mt-0.5">{errorBanner.subtext}</p>}
              </div>
            </div>
            {errorBanner.fixHref && (
              <Link
                href={errorBanner.fixHref}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg text-xs transition"
              >
                {errorBanner.fixAction}
              </Link>
            )}
          </div>
        )}

        {/* Message Thread or Warm Greeting Hero */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
          {messages.length === 0 && !isStreaming ? (
            /* Warm, Open Greeting Hero Matching Screenshot */
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8 pt-10 pb-20">
              {/* Center Editorial Greeting */}
              <div className="space-y-3">
                <h1 className="text-3xl sm:text-4xl font-serif text-zinc-100 tracking-tight font-normal flex items-center justify-center gap-3">
                  <span className="text-amber-500 text-3xl">✳️</span>
                  <span>{getGreeting()}</span>
                </h1>
              </div>

              {/* Main Input Box (Matching User's Screenshot Exactly) */}
              <div className="w-full relative">
                <div className="rounded-2xl bg-[#12141c]/90 border border-white/10 shadow-2xl p-4 space-y-3 focus-within:border-amber-500/40 transition">
                  {/* Attached Context Capsules */}
                  {(attachedDocs.length > 0 || connectedFolder || selectedProject) && (
                    <div className="flex flex-wrap gap-1.5 pb-1">
                      {selectedProject && (
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-1.5">
                          <Folder className="w-3 h-3" />
                          <span>{selectedProject.name}</span>
                          <button onClick={() => setSelectedProject(null)} className="hover:text-white">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {connectedFolder && (
                        <span className="px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/10 text-zinc-300 text-xs flex items-center gap-1.5">
                          <FolderOpen className="w-3 h-3 text-amber-400" />
                          <span>{connectedFolder.name} ({connectedFolder.files.length} files)</span>
                          <button onClick={() => setConnectedFolder(null)} className="hover:text-white">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {attachedDocs.map((doc, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/10 text-zinc-300 text-xs flex items-center gap-1.5"
                        >
                          <FileText className="w-3 h-3 text-emerald-400" />
                          <span>{doc.name}</span>
                          <button
                            onClick={() => setAttachedDocs((prev) => prev.filter((_, i) => i !== idx))}
                            className="hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

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
                        : "Ask anything, build an app, or type 'draw ...' to generate images..."
                    }
                    className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed"
                  />

                  {/* Inner Bar: "+" attach button on left, model & send on right */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                        className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition flex items-center gap-1"
                        title="Add context (Document, Project, Folder)"
                      >
                        <Plus className="w-4 h-4" />
                      </button>

                      {/* Attach Popover */}
                      {attachMenuOpen && (
                        <div className="absolute left-0 bottom-full mb-2 w-56 rounded-xl bg-[#161822] border border-white/10 shadow-2xl p-1.5 space-y-1 z-30 text-xs">
                          <button
                            onClick={() => {
                              fileInputRef.current?.click();
                              setAttachMenuOpen(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-zinc-300 flex items-center gap-2 transition"
                          >
                            <FileText className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Upload Document / File</span>
                          </button>

                          <button
                            onClick={handleConnectFolder}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-zinc-300 flex items-center gap-2 transition"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
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
                        className="p-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-zinc-950 font-semibold rounded-xl transition shadow-md flex items-center justify-center"
                      >
                        <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Sub-bar Below Composer (Matching Screenshot): Project or folder selector & Model Pill */}
                <div className="flex items-center justify-between px-2 pt-3 text-xs text-zinc-400">
                  <div className="relative">
                    <button
                      onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                      className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition"
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-400" />
                      <span>{selectedProject ? selectedProject.name : 'Project or folder'}</span>
                      <ChevronDown className="w-3 h-3 text-zinc-500" />
                    </button>

                    {/* Projects Dropdown Menu */}
                    {projectDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-[#161822] border border-white/10 shadow-2xl p-1.5 space-y-1 z-30 text-xs">
                        <button
                          onClick={() => {
                            setSelectedProject(null);
                            setProjectDropdownOpen(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-zinc-300 flex items-center gap-2"
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
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-zinc-300 flex items-center gap-2 truncate"
                          >
                            <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span className="truncate">{proj.name}</span>
                          </button>
                        ))}

                        <div className="border-t border-white/5 pt-1 mt-1">
                          <button
                            onClick={() => {
                              setProjectDropdownOpen(false);
                              handleConnectFolder();
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-amber-300 flex items-center gap-2"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Connect local folder...</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative flex items-center gap-1.5">
                    {/* One-Click Image Mode Toggle Chip */}
                    <button
                      type="button"
                      onClick={() => {
                        if (pinnedModelName?.toLowerCase().includes('flux')) {
                          setPinnedModelName('');
                          try { localStorage.removeItem('shazam_pinned_model'); } catch {}
                        } else {
                          const flux = models.find((m) => m.id === 'model_flux_1_schnell' || m.name.toLowerCase().includes('flux'));
                          const target = flux?.name || 'FLUX.1 Schnell (Free)';
                          setPinnedModelName(target);
                          try { localStorage.setItem('shazam_pinned_model', target); } catch {}
                        }
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium transition shadow-sm border ${
                        pinnedModelName?.toLowerCase().includes('flux')
                          ? 'bg-pink-500/20 text-pink-300 border-pink-500/40 shadow-pink-500/10'
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title={pinnedModelName?.toLowerCase().includes('flux') ? 'Image Mode Active (Click to return to Auto)' : 'Switch to FLUX.1 Free Image Generation'}
                    >
                      <Palette className="w-3.5 h-3.5 text-pink-400" />
                      <span>Image Gen</span>
                      {pinnedModelName?.toLowerCase().includes('flux') && (
                        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
                      )}
                    </button>

                    {/* Model Dropdown Button */}
                    <button
                      type="button"
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] transition shadow-sm ${
                        pinnedModelName?.toLowerCase().includes('flux')
                          ? 'bg-pink-500/10 border-pink-500/30 text-pink-200'
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-300'
                      }`}
                    >
                      {pinnedModelName?.toLowerCase().includes('flux') ? (
                        <Palette className="w-3.5 h-3.5 text-pink-400" />
                      ) : (
                        <Cpu className="w-3.5 h-3.5 text-amber-400" />
                      )}
                      <span className="font-mono truncate max-w-[140px]">
                        {pinnedModelName
                          ? (pinnedModelName.toLowerCase().includes('flux') ? 'FLUX.1 Schnell' : pinnedModelName)
                          : (connectedProviders['google'] ? 'Auto · Gemini Ready' : 'Auto · Free Preferred')}
                      </span>
                      {pinnedModelName?.toLowerCase().includes('flux') ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
                      ) : connectedProviders['google'] && !pinnedModelName ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      ) : null}
                      <ChevronDown className="w-3 h-3 text-zinc-500" />
                    </button>

                    {modelDropdownOpen && (
                      <div className="absolute right-0 bottom-full mb-1.5 w-72 max-h-80 overflow-y-auto rounded-2xl bg-[#161822] border border-white/10 shadow-2xl p-2 space-y-1 z-40 text-xs font-sans backdrop-blur-xl">
                        {/* Auto Routing Section */}
                        <div className="px-2 py-0.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                          Intelligent Auto Routing
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setPinnedModelName('');
                            try { localStorage.removeItem('shazam_pinned_model'); } catch {}
                            setModelDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
                            !pinnedModelName ? 'bg-amber-500/15 text-amber-300 font-medium border border-amber-500/20' : 'text-zinc-300 hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <div>
                              <div className="font-medium">Auto · Free Tier Routing</div>
                              <div className="text-[10px] text-zinc-400">Routes to best free model per task</div>
                            </div>
                          </div>
                          <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0 ml-1">
                            {connectedProviders['google'] ? 'Gemini Active' : 'Default'}
                          </span>
                        </button>

                        {/* Image Generation Section */}
                        <div className="border-t border-white/5 my-1.5" />
                        <div className="px-2 py-0.5 text-[10px] font-semibold text-pink-400 uppercase tracking-wider flex items-center justify-between">
                          <span>🎨 Free Image Generation</span>
                          <span className="text-[9px] text-zinc-500 font-mono lowercase">no key needed</span>
                        </div>

                        {models
                          .filter((m) => m.outputModality === 'image' || m.id.includes('flux') || m.name.toLowerCase().includes('flux'))
                          .map((m) => {
                            const isPinned = pinnedModelName === m.name || (pinnedModelName?.toLowerCase().includes('flux') && m.name.toLowerCase().includes('flux'));
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  setPinnedModelName(m.name);
                                  try { localStorage.setItem('shazam_pinned_model', m.name); } catch {}
                                  setModelDropdownOpen(false);
                                }}
                                className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
                                  isPinned ? 'bg-pink-500/15 text-pink-300 font-medium border border-pink-500/30' : 'text-zinc-300 hover:bg-white/5'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <Palette className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                                  <div className="truncate">
                                    <div className="font-medium truncate">{m.name}</div>
                                    <div className="text-[10px] text-zinc-400 truncate">12B Rectified Flow · Photorealistic</div>
                                  </div>
                                </div>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 font-mono font-semibold shrink-0 ml-1">
                                  100% Free
                                </span>
                              </button>
                            );
                          })}

                        {/* Google Gemini Section */}
                        <div className="border-t border-white/5 my-1.5" />
                        <div className="px-2 py-0.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                          <span>Google Gemini</span>
                          <span className="text-[9px] text-emerald-400 font-mono">Free Tier Ready</span>
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
                                  setModelDropdownOpen(false);
                                }}
                                className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition truncate ${
                                  isPinned ? 'bg-amber-500/15 text-amber-300 font-medium border border-amber-500/20' : 'text-zinc-300 hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">{m.name}</span>
                                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                  {isModelConnected && (
                                    <span className="text-[9px] text-emerald-400 font-mono font-semibold flex items-center gap-0.5">
                                      <Check className="w-2.5 h-2.5" /> Connected
                                    </span>
                                  )}
                                  <span className="text-[9px] text-zinc-400 font-mono">100% Free</span>
                                </div>
                              </button>
                            );
                          })}

                        {/* Local Compute (Ollama) */}
                        {models.some((m) => m.providerId === 'ollama') && (
                          <>
                            <div className="border-t border-white/5 my-1.5" />
                            <div className="px-2 py-0.5 text-[10px] font-semibold text-cyan-400 uppercase tracking-wider flex items-center justify-between">
                              <span>Local Compute (Ollama)</span>
                              <span className="text-[9px] text-cyan-400/80 font-mono">$0.00 Private</span>
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
                                      setModelDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition truncate ${
                                      isPinned ? 'bg-cyan-500/15 text-cyan-300 font-medium border border-cyan-500/20' : 'text-zinc-300 hover:bg-white/5'
                                    }`}
                                  >
                                    <span className="truncate">{m.name}</span>
                                    <span className="text-[9px] text-cyan-400 font-mono">Local</span>
                                  </button>
                                );
                              })}
                          </>
                        )}

                        {/* Frontier Cloud Models */}
                        <div className="border-t border-white/5 my-1.5" />
                        <div className="px-2 py-0.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                          Frontier Models (BYOK)
                        </div>
                        {models
                          .filter((m) => 
                            !m.providerModelId?.includes('gemini') && 
                            !m.id.includes('gemini') && 
                            !m.name.toLowerCase().includes('gemini') &&
                            m.outputModality !== 'image' &&
                            m.providerId !== 'ollama'
                          )
                          .map((m) => {
                            const isPinned = pinnedModelName === m.name;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  setPinnedModelName(m.name);
                                  try { localStorage.setItem('shazam_pinned_model', m.name); } catch {}
                                  setModelDropdownOpen(false);
                                }}
                                className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition truncate ${
                                  isPinned ? 'bg-amber-500/15 text-amber-300 font-medium border border-amber-500/20' : 'text-zinc-300 hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">{m.name}</span>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 pb-28">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  {/* User Bubble */}
                  {msg.role === 'user' ? (
                    <div className="max-w-2xl rounded-2xl rounded-tr-sm px-4.5 py-3 text-sm bg-zinc-800/90 text-zinc-100 border border-white/10 shadow-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  ) : (
                    /* Assistant Bubble */
                    <div className="w-full space-y-3">
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                          <Sparkles className="w-3 h-3" />
                        </div>
                        <span className="font-medium text-zinc-300">
                          {msg.routeInfo?.model?.name || 'Shazam AI'}
                        </span>
                        {msg.routeInfo?.route?.costClass && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono border border-emerald-500/20">
                            {msg.routeInfo.route.costClass}
                          </span>
                        )}
                      </div>

                      {/* Reasoning Drawer */}
                      {msg.reasoning && (
                        <details className="rounded-xl bg-white/[0.02] border border-white/[0.06] overflow-hidden text-zinc-400">
                          <summary className="px-3.5 py-2 cursor-pointer text-xs font-mono text-zinc-400 hover:text-zinc-200 flex items-center gap-2 select-none">
                            <Cpu className="w-3.5 h-3.5 text-amber-400" />
                            <span>View model thought process</span>
                          </summary>
                          <div className="p-3.5 text-xs font-mono text-zinc-400 whitespace-pre-wrap border-t border-white/[0.06] bg-black/20">
                            {msg.reasoning}
                          </div>
                        </details>
                      )}

                      <div>
                        <MarkdownRenderer content={msg.content} />
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-zinc-500">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            title="Copy response"
                            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/5 transition"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {msg.taskId && (
                            <>
                              <button
                                onClick={() => handleFeedback(msg.taskId!, 1)}
                                title="Helpful"
                                className={`p-1.5 rounded-lg hover:bg-white/5 transition ${
                                  feedbackSent[msg.taskId!] === 1
                                    ? 'text-emerald-400'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleFeedback(msg.taskId!, -1)}
                                title="Not helpful"
                                className={`p-1.5 rounded-lg hover:bg-white/5 transition ${
                                  feedbackSent[msg.taskId!] === -1
                                    ? 'text-red-400'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming Assistant Card */}
              {isStreaming && (
                <div className="w-full space-y-3 pt-2">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <Sparkles className="w-3 h-3 animate-pulse" />
                    </div>
                    <span className="font-medium text-zinc-300">
                      {activeRouteInfo?.model?.name || 'Evaluating optimum model...'}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  </div>

                  {streamingReasoning && (
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs font-mono text-zinc-400 whitespace-pre-wrap max-h-36 overflow-y-auto">
                      <div className="text-[10px] uppercase font-semibold text-amber-400 mb-1 flex items-center gap-1.5">
                        <Cpu className="w-3 h-3" /> Thinking:
                      </div>
                      {streamingReasoning}
                    </div>
                  )}

                  {streamingText ? (
                    <div>
                      <MarkdownRenderer content={streamingText} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 text-zinc-400 text-xs py-2">
                      <span className="inline-block w-2 h-4 bg-amber-400 animate-pulse rounded-sm" />
                      <span>Streaming response tokens...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Floating Composer Container when conversation has messages */}
        {messages.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/90 to-transparent pointer-events-none">
            <div className="max-w-3xl mx-auto pointer-events-auto relative">
              <div className="rounded-2xl bg-[#12141c]/90 backdrop-blur-2xl border border-white/10 shadow-2xl p-3 sm:p-3.5 transition-all">
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
                    pinnedModelName?.toLowerCase().includes('flux')
                      ? "Describe an image to generate with FLUX.1 (e.g. Cyberpunk samurai in neon Tokyo rain)..."
                      : "Ask anything, build an app, or type 'draw ...' to generate images..."
                  }
                  className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed max-h-48"
                />

                <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-zinc-200"
                      title="Attach file"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                      className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-400" />
                      <span>{selectedProject ? selectedProject.name : 'Context'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (pinnedModelName?.toLowerCase().includes('flux')) {
                          setPinnedModelName('');
                          try { localStorage.removeItem('shazam_pinned_model'); } catch {}
                        } else {
                          const flux = models.find((m) => m.id === 'model_flux_1_schnell' || m.name.toLowerCase().includes('flux'));
                          const target = flux?.name || 'FLUX.1 Schnell (Free)';
                          setPinnedModelName(target);
                          try { localStorage.setItem('shazam_pinned_model', target); } catch {}
                        }
                      }}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition ${
                        pinnedModelName?.toLowerCase().includes('flux')
                          ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40 shadow-sm'
                          : 'hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title={pinnedModelName?.toLowerCase().includes('flux') ? 'Image Mode Active (Click to return to Auto)' : 'Switch to FLUX.1 Free Image Generation'}
                    >
                      <Palette className="w-3.5 h-3.5 text-pink-400" />
                      <span>Image</span>
                      {pinnedModelName?.toLowerCase().includes('flux') && (
                        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
                      )}
                    </button>

                    <div className="h-3 w-px bg-white/10" />

                    <button
                      type="button"
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                      className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition"
                    >
                      {pinnedModelName?.toLowerCase().includes('flux') ? (
                        <Palette className="w-3 h-3 text-pink-400" />
                      ) : (
                        <Cpu className="w-3 h-3 text-amber-400" />
                      )}
                      <span className="truncate max-w-[120px]">
                        {pinnedModelName
                          ? (pinnedModelName.toLowerCase().includes('flux') ? 'FLUX.1 Schnell' : pinnedModelName)
                          : (connectedProviders['google'] ? 'Gemini Ready' : 'Auto (Free)')}
                      </span>
                      <ChevronDown className="w-2.5 h-2.5 text-zinc-500" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {isStreaming ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-xl transition shadow-md"
                      >
                        <Square className="w-4 h-4 fill-white" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={!prompt.trim()}
                        className="p-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl transition shadow-md disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Real Working Artifacts Modal */}
      {showArtifactsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#0f1118] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Workspace Artifacts</h3>
                  <p className="text-[11px] text-zinc-400">
                    Files, code proposals, and assets generated in your sessions.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowArtifactsModal(false);
                  setSelectedArtifact(null);
                }}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingArtifacts ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping mr-2" />
                  Loading workspace artifacts...
                </div>
              ) : selectedArtifact ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setSelectedArtifact(null)}
                      className="text-xs text-amber-400 hover:underline flex items-center gap-1"
                    >
                      ← Back to Artifacts list
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedArtifact.content);
                        setCopiedId('artifact-copied');
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-300 flex items-center gap-1 transition"
                    >
                      {copiedId === 'artifact-copied' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedId === 'artifact-copied' ? 'Copied' : 'Copy Content'}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-black/50 border border-white/5 rounded-xl font-mono text-xs text-zinc-200 overflow-x-auto max-h-96 whitespace-pre">
                    {selectedArtifact.content}
                  </div>
                </div>
              ) : artifactsList.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto text-zinc-500">
                    <FileText className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-medium text-zinc-300">No workspace artifacts saved yet</p>
                  <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                    When you use Code Studio or Co-Work to write code and generate documents, your saved files will appear here.
                  </p>
                  <Link
                    href="/agent"
                    onClick={() => setShowArtifactsModal(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition shadow-sm"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Open Code Studio</span>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {artifactsList.map((art, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedArtifact(art)}
                      className="py-2.5 px-3 rounded-xl hover:bg-white/[0.04] cursor-pointer flex items-center justify-between transition group"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-xs font-mono text-zinc-200 group-hover:text-amber-300 truncate">
                          {art.path}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-500 shrink-0">
                        {art.content.length} bytes · Click to view →
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
