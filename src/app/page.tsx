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
} from 'lucide-react';
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
  updatedAt: string;
}

export default function WorkspacePage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [costPolicy, setCostPolicy] = useState<CostPolicy>('balanced');
  const [taskClassOverride, setTaskClassOverride] = useState<string>('auto');
  const [pinnedModelName, setPinnedModelName] = useState<string>('');

  const [models, setModels] = useState<Model[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');
  const [activeRouteInfo, setActiveRouteInfo] = useState<any>(null);
  const [selectedDisclosure, setSelectedDisclosure] = useState<any>(null);
  const [routingMenuOpen, setRoutingMenuOpen] = useState(false);

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

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations & catalog
  useEffect(() => {
    fetch('/api/v1/conversations')
      .then((res) => (res.ok ? res.json() : { conversations: [] }))
      .then((data) => setConversations(data.conversations || []))
      .catch(() => {});

    fetch('/api/v1/catalog')
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => setModels(data.models || []))
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

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          conversationId: currentConvId || undefined,
          costPolicy,
          taskClassOverride: taskClassOverride === 'auto' ? undefined : taskClassOverride,
          pinnedModelName: pinnedModelName || undefined,
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
        if (done) break;

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

      // Add completed assistant message to history
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullOutput,
        reasoning: fullReasoning || undefined,
        taskId,
        routeInfo: latestRouteInfo,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingText('');
      setStreamingReasoning('');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // aborted cleanly
      } else {
        const rawMsg = err.message || 'Execution failed.';
        let userMessage = 'Unable to complete this request.';
        let subtext: string | undefined = undefined;
        let fixAction: string | undefined = undefined;
        let fixHref: string | undefined = undefined;

        if (rawMsg.includes('No valid API key') || rawMsg.includes('No API key')) {
          userMessage = 'No AI provider is connected yet.';
          subtext = 'To chat for free, connect a 100% free Google Gemini key in under 30 seconds (no credit card or billing ever required).';
          fixAction = 'Connect Free Key (30s)';
          fixHref = '/connections';
        } else if (rawMsg.includes('Free-Only policy strictly excludes') || rawMsg.includes('No eligible routes found under policy "free only"')) {
          userMessage = 'No free models are available for this specific task.';
          subtext = 'Switch to Balanced policy or connect a free provider key.';
          fixAction = 'Switch to Balanced';
        } else if (rawMsg.includes('No eligible routes found')) {
          userMessage = 'No available models match your current settings.';
          subtext = 'Try switching your policy to Balanced or check your connected providers.';
          fixAction = 'Switch to Balanced';
        } else if (rawMsg.includes('rate-limit') || rawMsg.includes('cooldown') || rawMsg.includes('429')) {
          userMessage = 'All models are temporarily busy.';
          subtext = 'Please wait 15 seconds and try sending your message again.';
          fixAction = 'Try Again';
        } else if (rawMsg.includes('Unauthorized') || rawMsg.includes('CSRF')) {
          userMessage = 'Your session has expired.';
          subtext = 'Please sign in again to continue.';
          fixAction = 'Sign In';
          fixHref = '/login';
        } else {
          userMessage = rawMsg.length > 100 ? rawMsg.slice(0, 100) + '...' : rawMsg;
        }

        setErrorBanner({
          message: userMessage,
          subtext,
          details: rawMsg !== userMessage ? rawMsg : undefined,
          fixAction,
          fixHref,
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  async function handleFeedback(taskId: string, rating: 1 | -1) {
    if (!taskId) return;
    try {
      await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, rating }),
      });
      setFeedbackSent((prev) => ({ ...prev, [taskId]: rating }));
    } catch {
      // ignore
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Render markdown code blocks helper
  function renderFormattedContent(content: string) {
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const firstLineEnd = part.indexOf('\n');
        const lang = part.slice(3, firstLineEnd).trim() || 'code';
        const code = part.slice(firstLineEnd + 1, -3);
        const codeId = `code-${index}`;

        return (
          <div key={index} className="my-3.5 rounded-xl overflow-hidden border border-white/10 bg-[#0d0f17] shadow-lg">
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

  // Label for current routing configuration pill
  const activeRoutingLabel = pinnedModelName
    ? pinnedModelName
    : costPolicy === 'free_only'
    ? 'Free Tier Only'
    : costPolicy === 'best_quality'
    ? 'Best Quality'
    : costPolicy === 'lowest_cost'
    ? 'Lowest Cost'
    : 'Smart Auto';

  return (
    <div className="flex-1 flex overflow-hidden ambient-glow relative">
      {/* Conversation Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0a0b10]/95 backdrop-blur-2xl border-r border-white/[0.07] flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-3.5 border-b border-white/[0.07] flex items-center justify-between gap-2">
          <button
            onClick={handleNewChat}
            className="flex-1 py-2 px-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 text-zinc-200 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition shadow-sm group"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-90 transition-transform duration-200" />
            <span>New Chat</span>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
          <div className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-zinc-500">
            Recent Conversations
          </div>
          {conversations.length === 0 ? (
            <div className="text-center py-10 px-4 text-zinc-500 text-xs">
              No conversations yet. Start typing below!
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  loadConversation(conv.id);
                  setSidebarOpen(false);
                }}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-xl text-xs transition cursor-pointer ${
                  currentConvId === conv.id
                    ? 'bg-amber-500/10 text-amber-300 font-medium border border-amber-500/20'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
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
      </aside>

      {/* Main Chat Workspace */}
      <div className="flex-1 flex flex-col h-[calc(100vh-60px)] overflow-hidden relative">
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

        {/* Error Banner with Human Message + Clear Fix Action */}
        {errorBanner && (
          <div className="mx-4 sm:mx-8 mt-4 p-4 rounded-2xl bg-red-950/30 border border-red-500/20 text-xs shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200 backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 mt-0.5">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-zinc-100 text-sm">{errorBanner.message}</p>
                {errorBanner.subtext && (
                  <p className="text-zinc-400 text-xs leading-relaxed">{errorBanner.subtext}</p>
                )}
                {errorBanner.details && (
                  <details className="pt-1 text-[11px] font-mono text-zinc-500">
                    <summary className="cursor-pointer hover:text-zinc-400 select-none">
                      Technical details
                    </summary>
                    <div className="mt-1.5 p-2 bg-black/40 border border-white/5 rounded-lg text-zinc-400 whitespace-pre-wrap max-h-24 overflow-y-auto">
                      {errorBanner.details}
                    </div>
                  </details>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              {errorBanner.fixHref ? (
                <Link
                  href={errorBanner.fixHref}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl text-xs transition shadow-sm"
                >
                  {errorBanner.fixAction}
                </Link>
              ) : errorBanner.fixAction?.includes('Balanced') ? (
                <button
                  onClick={() => {
                    setCostPolicy('balanced');
                    setErrorBanner(null);
                  }}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl text-xs transition shadow-sm"
                >
                  Switch to Balanced
                </button>
              ) : null}
              <button
                onClick={() => setErrorBanner(null)}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-white/5 transition"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
          {messages.length === 0 && !isStreaming ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-6 pt-4 pb-20">
              {/* Apple / Linear Pill Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium shadow-sm">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Intelligent Multi-Model Router · Free Tier</span>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                  What would you like to build?
                </h2>
                <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
                  Describe what you want in plain English. Shazam plans, designs, and builds it for you with zero setup required.
                </p>
              </div>

              {/* 4 Creator-friendly Prompt Capsules */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full pt-3">
                {[
                  {
                    icon: <Sparkles className="w-4 h-4 text-amber-400" />,
                    title: 'Build a Web App',
                    prompt: 'Build a modern SaaS landing page with pricing cards, FAQs, and a sleek dark theme',
                  },
                  {
                    icon: <Zap className="w-4 h-4 text-emerald-400" />,
                    title: 'Add a Smart Feature',
                    prompt: 'Detect user location and currency automatically via IP address, with fallback to Nigeria and NGN',
                  },
                  {
                    icon: <Compass className="w-4 h-4 text-blue-400" />,
                    title: 'Redesign Interface',
                    prompt: 'Make my checkout and account settings look clean, minimalist, and high-converting like Apple',
                  },
                  {
                    icon: <FileText className="w-4 h-4 text-purple-400" />,
                    title: 'Plan & Launch Product',
                    prompt: 'Draft an MVP launch plan with core features, user journey, and email announcement copy',
                  },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item.prompt)}
                    className="p-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-amber-500/30 text-left transition group shadow-sm flex flex-col justify-between h-24"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-lg bg-white/5 border border-white/5">
                        {item.icon}
                      </div>
                      <span className="text-xs font-semibold text-zinc-200 group-hover:text-amber-400 transition">
                        {item.title}
                      </span>
                    </div>
                    <p className="text-[12px] text-zinc-400 line-clamp-2 leading-relaxed">
                      &ldquo;{item.prompt}&rdquo;
                    </p>
                  </button>
                ))}
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

                      <div className="text-sm leading-relaxed text-zinc-200">
                        {renderFormattedContent(msg.content)}
                      </div>

                      {/* Message Footer Row */}
                      <div className="pt-2 flex items-center justify-between text-xs text-zinc-500 border-t border-white/[0.04]">
                        {msg.routeInfo ? (
                          <button
                            onClick={() => setSelectedDisclosure(msg.routeInfo)}
                            className="flex items-center gap-1.5 hover:text-amber-400 transition text-[11px]"
                          >
                            <Info className="w-3.5 h-3.5 text-amber-500/70" />
                            <span>
                              Routed via {msg.routeInfo.model?.name || 'Model'}
                            </span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <span />
                        )}

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
                    <div className="text-sm leading-relaxed text-zinc-200">
                      {renderFormattedContent(streamingText)}
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

        {/* Floating Glass Composer Container */}
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/90 to-transparent pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto relative">
            {/* Routing Settings Popover Menu */}
            {routingMenuOpen && (
              <div className="absolute bottom-full mb-2 left-0 w-80 rounded-2xl bg-[#12141e]/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-4 space-y-3.5 z-30 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" /> Routing Controls
                  </span>
                  <button
                    onClick={() => setRoutingMenuOpen(false)}
                    className="text-zinc-400 hover:text-white p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Policy Selector */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400 block">Routing Policy</label>
                  <select
                    value={costPolicy}
                    onChange={(e) => setCostPolicy(e.target.value as CostPolicy)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="balanced" className="bg-[#12141e]">Balanced (Prior / Free Tier / Quality)</option>
                    <option value="free_only" className="bg-[#12141e]">Free Only ($0 Verified)</option>
                    <option value="lowest_cost" className="bg-[#12141e]">Lowest Cost</option>
                    <option value="best_quality" className="bg-[#12141e]">Best Quality</option>
                    <option value="manual_pin" className="bg-[#12141e]">Manual Pin</option>
                  </select>
                </div>

                {/* Task Class */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400 block">Task Classification</label>
                  <select
                    value={taskClassOverride}
                    onChange={(e) => setTaskClassOverride(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="auto" className="bg-[#12141e]">Auto-Detect (Recommended)</option>
                    <option value="coding" className="bg-[#12141e]">Coding</option>
                    <option value="reasoning" className="bg-[#12141e]">Reasoning</option>
                    <option value="writing" className="bg-[#12141e]">Writing</option>
                    <option value="general_chat" className="bg-[#12141e]">General Chat</option>
                    <option value="planning" className="bg-[#12141e]">Planning</option>
                  </select>
                </div>

                {/* Model Pin */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400 block">Pin Specific Model</label>
                  <select
                    value={pinnedModelName}
                    onChange={(e) => setPinnedModelName(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="" className="bg-[#12141e]">Auto-Route (Recommended)</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.name} className="bg-[#12141e]">
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Apple / Perplexity Floating Glass Capsule */}
            <div className="rounded-2xl sm:rounded-3xl bg-[#12141c]/90 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-3 sm:p-3.5 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/20 transition-all">
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
                placeholder="Ask Shazam anything, write code, or explore an idea..."
                className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed max-h-48"
              />

              {/* Bottom bar inside composer */}
              <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-white/[0.06]">
                {/* Routing Pill Trigger */}
                <button
                  type="button"
                  onClick={() => setRoutingMenuOpen(!routingMenuOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 text-xs font-medium transition shadow-sm"
                  title="Configure AI routing and models"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span className="truncate max-w-[140px] sm:max-w-none">{activeRoutingLabel}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {/* Right Action: Send or Stop */}
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline text-[11px] text-zinc-500">
                    Press <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[10px]">↵</kbd>
                  </span>
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-xl transition shadow-md flex items-center justify-center"
                      title="Stop generation"
                    >
                      <Square className="w-4 h-4 fill-white" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={!prompt.trim()}
                      className="p-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl transition shadow-md disabled:opacity-30 disabled:hover:bg-amber-500 flex items-center justify-center"
                      title="Send message"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Route Disclosure Drawer */}
      {selectedDisclosure && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0e111a]/95 backdrop-blur-2xl border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">Route Decision Disclosure</h3>
            </div>
            <button
              onClick={() => setSelectedDisclosure(null)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs font-mono">
            <div>
              <span className="text-[10px] uppercase text-zinc-500 block">SELECTED MODEL</span>
              <span className="text-sm font-bold text-white">
                {selectedDisclosure.model?.name || selectedDisclosure.modelId}
              </span>
              <span className="block text-zinc-400 text-[11px]">
                ID: {selectedDisclosure.model?.providerModelId || selectedDisclosure.modelId}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase text-zinc-500 block">PROVIDER</span>
              <span className="text-zinc-200">
                {selectedDisclosure.provider?.name || selectedDisclosure.providerId}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase text-zinc-500 block">COST CLASSIFICATION</span>
              <span className="text-emerald-400 font-semibold">
                {selectedDisclosure.route?.costClass || 'unknown'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase text-zinc-500 block">ROUTER RATIONALE</span>
              <p className="text-zinc-300 text-[12px] font-sans mt-1 leading-relaxed bg-white/[0.03] p-3 rounded-xl border border-white/5">
                {selectedDisclosure.why || selectedDisclosure.decisionTrace?.rationale || 'Selected via policy scoring engine.'}
              </p>
            </div>

            {selectedDisclosure.fallback && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-900/60 text-amber-300 space-y-1">
                <span className="text-[10px] font-bold uppercase flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5" /> Failover Triggered
                </span>
                <p className="text-[11px]">
                  Fell back from {selectedDisclosure.fallback.previousRouteId} to current route: {selectedDisclosure.fallback.reason}
                </p>
              </div>
            )}

            {/* Decision Candidate Breakdown */}
            {selectedDisclosure.decisionTrace && (
              <div className="space-y-2 pt-2 border-t border-white/10">
                <span className="text-[10px] uppercase text-zinc-500 block">EVALUATED CANDIDATES ({selectedDisclosure.decisionTrace.evaluated})</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {selectedDisclosure.decisionTrace.candidates?.map((cand: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xl text-[11px] border ${
                        cand.eligible
                          ? 'border-emerald-900/40 bg-emerald-950/20 text-emerald-300'
                          : 'border-white/5 bg-white/[0.02] text-zinc-500'
                      }`}
                    >
                      <div className="flex justify-between font-semibold">
                        <span>{cand.modelId}</span>
                        <span>{cand.eligible ? `Score: ${cand.score?.toFixed(1) ?? '—'}` : 'Excluded'}</span>
                      </div>
                      {cand.rejection && (
                        <div className="text-[10px] text-red-400 mt-1">{cand.rejection}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

