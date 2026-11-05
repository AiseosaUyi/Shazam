'use client';

import { useRouter } from 'next/navigation';
import { SystemStrip } from '@/components/SystemStrip';
import { useDialog } from '@/components/ui/dialog';
import { AgentSuggestion } from '@/components/AgentSuggestion';
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowUp,
  Square,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  Plus,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Cpu,
  X,
  FileText,
  Zap,
  Folder,
  FolderOpen,
  Paperclip,
  Palette,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { CostPolicy, TaskClass, Model } from '@/lib/types';
import { errMessage } from '@/lib/errors';
import { ArtifactsModal, type ArtifactItem } from '@/components/home/ArtifactsModal';
import { ConversationSidebar, type ConversationItem } from '@/components/home/ConversationSidebar';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  taskId?: string | null;
  routeInfo?: any;
}


interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
}

export default function WorkspacePage() {
  const router = useRouter();
  const dialog = useDialog();
  const [user, setUser] = useState<{ email: string; name?: string; role?: string } | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    const pre = new URLSearchParams(window.location.search).get('prompt');
    if (pre) setPrompt(pre);
  }, []);
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
  const [artifactsList, setArtifactsList] = useState<ArtifactItem[]>([]);
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
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    if (hour >= 17 && hour < 22) return 'Good evening';
    return 'Late session';
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
      dialog.alert({ title: 'Folder picker not supported', body: 'This browser can’t open local folders. Use the Arcwork desktop app, or choose a project instead.' });
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

    // Route to the right agent automatically, like Claude: building software goes to Code,
    // inbox/calendar/scheduling/video work goes to Co-Work. Images and questions stay here.
    if (!connectedFolder && attachedDocs.length === 0) {
      const s = await fetch('/api/v1/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: promptText }) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const agent = s?.suggestion?.agent;
      if (s?.suggestion?.confidence >= 0.6 && (agent === 'code' || agent === 'cowork' || agent === 'video')) {
        router.push(`${agent === 'code' ? '/agent' : '/cowork'}?prompt=${encodeURIComponent(promptText.trim())}&autorun=1`);
        return;
      }
    }

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
    const isPinnedImage = pinnedModelName && (
      pinnedModelName.toLowerCase().includes('flux') ||
      pinnedModelName.toLowerCase().includes('image') ||
      pinnedModelName.toLowerCase().includes('banana') ||
      pinnedModelName.toLowerCase().includes('imagen')
    );
    
    // If prompt is an image request, clear text-only pins to avoid collision; only retain an explicit image pin if chosen
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
              } catch (e) {
                if (errMessage(e) && errMessage(e) !== 'Unexpected token') throw e;
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
          } catch (e) {
            if (errMessage(e) && errMessage(e) !== 'Unexpected token') {
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
    } catch (err) {
      setStreamingText('');
      setStreamingReasoning('');
      if ((err as { name?: string })?.name === 'AbortError') {
        // aborted cleanly
      } else {
        const rawMsg = errMessage(err) || 'Execution failed.';
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

  function getModelButtonLabel() {
    if (!pinnedModelName) {
      return connectedProviders['google'] ? 'Gemini Ready' : 'Auto';
    }
    if (pinnedModelName.toLowerCase().includes('banana') || pinnedModelName.toLowerCase().includes('imagen')) {
      return 'Google Nano Banana';
    }
    if (pinnedModelName.toLowerCase().includes('flux')) {
      return 'FLUX.1 Schnell';
    }
    return pinnedModelName;
  }

  function renderModelDropdown() {
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
            setModelDropdownOpen(false);
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
            setModelDropdownOpen(false);
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
            setModelDropdownOpen(false);
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
                  setModelDropdownOpen(false);
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
                      setModelDropdownOpen(false);
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

  const activeRoutingLabel = pinnedModelName
    ? pinnedModelName
    : costPolicy === 'best_quality'
    ? 'Best Quality'
    : costPolicy === 'lowest_cost'
    ? 'Lowest Cost'
    : 'Auto';

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
      <ConversationSidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        user={user}
        conversations={conversations}
        currentConvId={currentConvId}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onNewChat={handleNewChat}
        onOpenLibrary={loadArtifacts}
        onSelectConversation={loadConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* ========================================================================= */}
      {/* Main Conversational Workspace                                             */}
      {/* ========================================================================= */}
      <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden relative bg-canvas">
        {/* Subtle Top Mobile Bar */}
        <div className="md:hidden border-b border-line/[0.06] bg-canvas/80 backdrop-blur-md px-4 py-2 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg bg-line/5 text-ink-2 flex items-center gap-2 text-xs"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chats</span>
          </button>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-lg bg-brand/10 text-brand border border-brand/20 text-xs flex items-center gap-1"
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
                <p className="font-semibold text-ink">{errorBanner.message}</p>
                {errorBanner.subtext && <p className="text-ink-2 mt-0.5">{errorBanner.subtext}</p>}
              </div>
            </div>
            {errorBanner.fixHref && (
              <Link
                href={errorBanner.fixHref}
                className="px-3 py-1 bg-brand hover:bg-brand-soft text-brand-ink font-semibold rounded-lg text-xs transition"
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
            <div className="shz-atmosphere -mx-8 -mt-6 h-full flex flex-col items-center justify-center text-center px-8 space-y-8 pt-10 pb-20 [&>*]:w-full [&>*]:max-w-2xl">
              {/* Center Editorial Greeting */}
              <div className="space-y-3">
                <p className="shz-mono text-[11px] tracking-[0.2em] text-brand/80">{getGreeting()}</p>
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

                      {modelDropdownOpen && renderModelDropdown()}
                    </div>
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
                    <div className="max-w-2xl rounded-2xl rounded-tr-sm px-4.5 py-3 text-sm bg-surface-2/90 text-ink border border-line/10 shadow-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  ) : (
                    /* Assistant Bubble */
                    <div className="w-full space-y-3">
                      <div className="flex items-center gap-2 text-xs text-ink-2">
                        <div className="w-5 h-5 rounded-md bg-brand/20 border border-brand/30 flex items-center justify-center text-brand">
                          <Sparkles className="w-3 h-3" />
                        </div>
                        <span className="font-medium text-ink-2">
                          {msg.routeInfo?.model?.name || 'Arcwork'}
                        </span>
                        {msg.routeInfo?.route?.costClass && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono border border-emerald-500/20">
                            {msg.routeInfo.route.costClass}
                          </span>
                        )}
                        {msg.routeInfo?.fallback && (
                          <span className="px-2 py-0.5 rounded-full bg-brand/10 text-brand-soft text-[10px] font-mono border border-brand/20" title={msg.routeInfo.fallback.reason || 'Primary provider unavailable'}>
                            fallback
                          </span>
                        )}
                      </div>

                      {/* Reasoning Drawer */}
                      {msg.reasoning && (
                        <details className="rounded-xl bg-line/[0.02] border border-line/[0.06] overflow-hidden text-ink-2">
                          <summary className="px-3.5 py-2 cursor-pointer text-xs font-mono text-ink-2 hover:text-ink flex items-center gap-2 select-none">
                            <Cpu className="w-3.5 h-3.5 text-brand" />
                            <span>View model thought process</span>
                          </summary>
                          <div className="p-3.5 text-xs font-mono text-ink-2 whitespace-pre-wrap border-t border-line/[0.06] bg-black/20">
                            {msg.reasoning}
                          </div>
                        </details>
                      )}

                      <div>
                        <MarkdownRenderer content={msg.content} />
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-line/5 text-xs text-ink-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            title="Copy response"
                            className="p-1.5 text-ink-2 hover:text-ink rounded-lg hover:bg-line/5 transition"
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
                                className={`p-1.5 rounded-lg hover:bg-line/5 transition ${
                                  feedbackSent[msg.taskId!] === 1
                                    ? 'text-emerald-400'
                                    : 'text-ink-2 hover:text-ink'
                                }`}
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleFeedback(msg.taskId!, -1)}
                                title="Not helpful"
                                className={`p-1.5 rounded-lg hover:bg-line/5 transition ${
                                  feedbackSent[msg.taskId!] === -1
                                    ? 'text-red-400'
                                    : 'text-ink-2 hover:text-ink'
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
                  <div className="flex items-center gap-2 text-xs text-ink-2">
                    <div className="w-5 h-5 rounded-md bg-brand/20 border border-brand/30 flex items-center justify-center text-brand">
                      <Sparkles className="w-3 h-3 animate-pulse" />
                    </div>
                    <span className="font-medium text-ink-2">
                      {activeRouteInfo?.model?.name || 'Evaluating optimum model...'}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-brand animate-ping" />
                  </div>

                  {streamingReasoning && (
                    <div className="p-3.5 rounded-xl bg-line/[0.02] border border-line/[0.06] text-xs font-mono text-ink-2 whitespace-pre-wrap max-h-36 overflow-y-auto">
                      <div className="text-[10px] font-semibold text-brand mb-1 flex items-center gap-1.5">
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
                    <div className="flex items-center gap-2.5 text-ink-2 text-xs py-2">
                      <span className="inline-block w-2 h-4 bg-brand animate-pulse rounded-sm" />
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

                      {modelDropdownOpen && renderModelDropdown()}
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
        )}
      </div>

      {showArtifactsModal && (
        <ArtifactsModal
          artifactsList={artifactsList}
          selectedArtifact={selectedArtifact}
          setSelectedArtifact={setSelectedArtifact}
          loadingArtifacts={loadingArtifacts}
          copiedId={copiedId}
          setCopiedId={setCopiedId}
          onClose={() => setShowArtifactsModal(false)}
        />
      )}
    </div>
  );
}
