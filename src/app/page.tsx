'use client';

import { useRouter } from 'next/navigation';
import { useDialog } from '@/components/ui/dialog';
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Plus,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import type { CostPolicy, TaskClass, Model } from '@/lib/types';
import { errMessage } from '@/lib/errors';
import { ArtifactsModal, type ArtifactItem } from '@/components/home/ArtifactsModal';
import { MessageThread, type Message } from '@/components/home/MessageThread';
import { HomeHero, type ProjectItem } from '@/components/home/HomeHero';
import { ChatComposer } from '@/components/home/ChatComposer';
import { ConversationSidebar, type ConversationItem } from '@/components/home/ConversationSidebar';



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
            <HomeHero
              greeting={getGreeting()}
              prompt={prompt}
              setPrompt={setPrompt}
              textareaRef={textareaRef}
              fileInputRef={fileInputRef}
              handleSend={handleSend}
              handleConnectFolder={handleConnectFolder}
              attachedDocs={attachedDocs}
              setAttachedDocs={setAttachedDocs}
              connectedFolder={connectedFolder}
              setConnectedFolder={setConnectedFolder}
              projects={projects}
              selectedProject={selectedProject}
              setSelectedProject={setSelectedProject}
              projectDropdownOpen={projectDropdownOpen}
              setProjectDropdownOpen={setProjectDropdownOpen}
              attachMenuOpen={attachMenuOpen}
              setAttachMenuOpen={setAttachMenuOpen}
              modelDropdownOpen={modelDropdownOpen}
              setModelDropdownOpen={setModelDropdownOpen}
              models={models}
              connectedProviders={connectedProviders}
              pinnedModelName={pinnedModelName}
              setPinnedModelName={setPinnedModelName}
              getModelButtonLabel={getModelButtonLabel}
            />
          ) : (
            <MessageThread
              messages={messages}
              copiedId={copiedId}
              feedbackSent={feedbackSent}
              isStreaming={isStreaming}
              activeRouteInfo={activeRouteInfo}
              streamingReasoning={streamingReasoning}
              streamingText={streamingText}
              handleCopy={handleCopy}
              handleFeedback={handleFeedback}
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Floating Composer Container when conversation has messages */}
        {messages.length > 0 && (
          <ChatComposer
            prompt={prompt}
            setPrompt={setPrompt}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
            handleSend={handleSend}
            handleStop={handleStop}
            isStreaming={isStreaming}
            selectedProject={selectedProject}
            projectDropdownOpen={projectDropdownOpen}
            setProjectDropdownOpen={setProjectDropdownOpen}
            modelDropdownOpen={modelDropdownOpen}
            setModelDropdownOpen={setModelDropdownOpen}
            models={models}
            connectedProviders={connectedProviders}
            pinnedModelName={pinnedModelName}
            setPinnedModelName={setPinnedModelName}
            getModelButtonLabel={getModelButtonLabel}
          />
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
