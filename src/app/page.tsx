'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Send,
  Square,
  RotateCcw,
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
} from 'lucide-react';
import type { CostPolicy, TaskClass, Model, CatalogRoute } from '@/lib/types';

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
              // Route fallback notification
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
          <div key={index} className="my-3 rounded-lg overflow-hidden border border-[#232736] bg-[#080a10]">
            <div className="px-3 py-1.5 bg-[#141824] border-b border-[#232736] flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>{lang}</span>
              <button
                onClick={() => handleCopy(code, codeId)}
                className="hover:text-amber-400 flex items-center gap-1 transition"
              >
                {copiedId === codeId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedId === codeId ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-3 text-xs font-mono text-zinc-200 overflow-x-auto whitespace-pre">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      return (
        <span key={index} className="whitespace-pre-wrap leading-relaxed">
          {part}
        </span>
      );
    });
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Conversation Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0c0e14] border-r border-[#232736] flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-3 border-b border-[#232736] flex items-center justify-between">
          <button
            onClick={handleNewChat}
            className="flex-1 py-2 px-3 bg-[#161a26] hover:bg-[#202538] border border-[#232736] text-zinc-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5 text-amber-500" /> New Chat
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1.5 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-xs font-mono">No conversations yet</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  loadConversation(conv.id);
                  setSidebarOpen(false);
                }}
                className={`group flex items-center justify-between px-3 py-2 rounded-lg text-xs transition cursor-pointer ${
                  currentConvId === conv.id
                    ? 'bg-[#1b1f2d] text-amber-400 font-semibold'
                    : 'text-zinc-400 hover:bg-[#141824] hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{conv.title}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDeleteConversation(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition"
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
      <div className="flex-1 flex flex-col h-[calc(100vh-60px)] bg-[#090a0f] overflow-hidden">
        {/* Controls Bar */}
        <div className="border-b border-[#232736] bg-[#0c0e14]/50 backdrop-blur-sm px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded bg-[#161a26] text-zinc-300"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>

            {/* Policy Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 font-mono text-[11px]">POLICY:</span>
              <select
                value={costPolicy}
                onChange={(e) => setCostPolicy(e.target.value as CostPolicy)}
                className="bg-[#10131d] border border-[#232736] rounded-md px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
              >
                <option value="free_only">Free Only ($0 verified)</option>
                <option value="lowest_cost">Lowest Cost</option>
                <option value="balanced">Balanced (Prior / Cost)</option>
                <option value="best_quality">Best Quality</option>
                <option value="manual_pin">Manual Pin</option>
              </select>
            </div>

            {/* Task Class Override */}
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-zinc-500 font-mono text-[11px]">TASK:</span>
              <select
                value={taskClassOverride}
                onChange={(e) => setTaskClassOverride(e.target.value)}
                className="bg-[#10131d] border border-[#232736] rounded-md px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
              >
                <option value="auto">Auto-Classify</option>
                <option value="coding">Coding</option>
                <option value="reasoning">Reasoning</option>
                <option value="writing">Writing</option>
                <option value="general_chat">General Chat</option>
                <option value="planning">Planning</option>
                <option value="vision">Vision</option>
              </select>
            </div>
          </div>

          {/* Model Pin (Pin by model name) */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-mono text-[11px]">PIN MODEL:</span>
            <select
              value={pinnedModelName}
              onChange={(e) => setPinnedModelName(e.target.value)}
              className="bg-[#10131d] border border-[#232736] rounded-md px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono max-w-[160px] truncate"
            >
              <option value="">Auto Router</option>
              {models.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Error Banner with Human Message + Clear Fix Action */}
        {errorBanner && (
          <div className="mx-4 sm:mx-6 mt-4 p-4 rounded-xl bg-[#1a0f12] border border-red-500/30 text-xs shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 mt-0.5">
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
                    <div className="mt-1.5 p-2 bg-[#090b10] border border-[#232736] rounded text-zinc-400 whitespace-pre-wrap max-h-24 overflow-y-auto">
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
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg text-xs transition shadow-sm"
                >
                  {errorBanner.fixAction}
                </Link>
              ) : errorBanner.fixAction?.includes('Balanced') ? (
                <button
                  onClick={() => {
                    setCostPolicy('balanced');
                    setErrorBanner(null);
                  }}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg text-xs transition shadow-sm"
                >
                  Switch to Balanced
                </button>
              ) : null}
              <button
                onClick={() => setErrorBanner(null)}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800/50 transition"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 && !isStreaming ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-mono">Shazam AI Workspace</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Describe what you need. Shazam automatically selects the best eligible model based on task, capabilities, cost, and quota health.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full pt-2">
                {[
                  'Build a binary search tree in TypeScript',
                  'Compare Kafka vs RabbitMQ architectural trade-offs',
                  'Write a concise email announcing product MVP launch',
                  'Explain Paxos consensus in simple terms',
                ].map((sample, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(sample)}
                    className="p-2.5 rounded-lg border border-[#232736] bg-[#10131d] text-zinc-300 hover:text-white hover:border-amber-500/40 text-left text-xs transition"
                  >
                    &ldquo;{sample}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-xl p-4 text-xs ${
                    msg.role === 'user'
                      ? 'bg-amber-500 text-zinc-950 font-medium'
                      : 'bg-[#10131d] border border-[#232736] text-zinc-200'
                  }`}
                >
                  {/* Reasoning Drawer */}
                  {msg.reasoning && (
                    <details className="mb-3 rounded-lg bg-[#090b10] border border-[#232736] overflow-hidden text-zinc-400">
                      <summary className="px-3 py-1.5 cursor-pointer text-[11px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-amber-500" /> Model Reasoning Process
                      </summary>
                      <div className="p-3 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap border-t border-[#1e2333]">
                        {msg.reasoning}
                      </div>
                    </details>
                  )}

                  {msg.role === 'assistant' ? (
                    <div>{renderFormattedContent(msg.content)}</div>
                  ) : (
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  )}

                  {/* Route Disclosure Pill on Assistant Messages */}
                  {msg.role === 'assistant' && msg.routeInfo && (
                    <div className="mt-3 pt-2.5 border-t border-[#1e2333] flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                      <button
                        onClick={() => setSelectedDisclosure(msg.routeInfo)}
                        className="flex items-center gap-1.5 hover:text-amber-400 font-mono transition"
                      >
                        <Info className="w-3.5 h-3.5 text-amber-500" />
                        <span>
                          Routed to {msg.routeInfo.model?.name || msg.routeInfo.modelId || 'Model'} (
                          {msg.routeInfo.route?.costClass || 'auto'})
                        </span>
                        <ChevronRight className="w-3 h-3" />
                      </button>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleCopy(msg.content, msg.id)}
                          title="Copy response"
                          className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
                        >
                          {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {msg.taskId && (
                          <>
                            <button
                              onClick={() => handleFeedback(msg.taskId!, 1)}
                              title="Helpful"
                              className={`p-1 rounded ${feedbackSent[msg.taskId!] === 1 ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleFeedback(msg.taskId!, -1)}
                              title="Not helpful"
                              className={`p-1 rounded ${feedbackSent[msg.taskId!] === -1 ? 'text-red-400' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Active Streaming Chunk */}
          {isStreaming && (
            <div className="flex flex-col items-start">
              <div className="max-w-3xl rounded-xl p-4 text-xs bg-[#10131d] border border-[#232736] text-zinc-200 w-full space-y-3">
                {activeRouteInfo && (
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pb-2 border-b border-[#1e2333]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      Executing via {activeRouteInfo.model?.name || 'Selected Model'} ({activeRouteInfo.provider?.name || 'Provider'})
                    </span>
                    <button
                      onClick={() => setSelectedDisclosure(activeRouteInfo)}
                      className="text-amber-400 hover:underline flex items-center gap-1"
                    >
                      Route details <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {streamingReasoning && (
                  <div className="p-3 rounded-lg bg-[#090b10] border border-[#232736] text-[11px] font-mono text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    <div className="text-[10px] uppercase font-bold text-amber-500 mb-1 flex items-center gap-1">
                      <Cpu className="w-3 h-3" /> Reasoning:
                    </div>
                    {streamingReasoning}
                  </div>
                )}

                {streamingText ? (
                  <div>{renderFormattedContent(streamingText)}</div>
                ) : (
                  <div className="flex items-center gap-2 text-zinc-500 font-mono text-xs">
                    <span className="inline-block w-2 h-4 bg-amber-500 animate-pulse" />
                    Evaluating prompt and streaming tokens...
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-[#232736] bg-[#0c0e14]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="max-w-4xl mx-auto flex items-end gap-2"
          >
            <div className="flex-1 bg-[#10131d] border border-[#232736] rounded-xl focus-within:border-amber-500/80 transition p-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                placeholder="Describe your task (e.g., 'Refactor this SQL query', 'Write a test suite for auth', 'Draft product specs')..."
                className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none font-sans"
              />
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-3 bg-red-600 hover:bg-red-500 text-white rounded-xl transition shadow-md flex items-center justify-center"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="p-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-xl transition shadow-md disabled:opacity-40 flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Route Disclosure Drawer */}
      {selectedDisclosure && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0e111a] border-l border-[#232736] shadow-2xl flex flex-col">
          <div className="p-4 border-b border-[#232736] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold font-mono text-white">Route Decision Disclosure</h3>
            </div>
            <button
              onClick={() => setSelectedDisclosure(null)}
              className="p-1 rounded text-zinc-400 hover:text-white"
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
              <span className="text-amber-400 font-semibold">
                {selectedDisclosure.route?.costClass || 'unknown'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase text-zinc-500 block">ROUTER RATIONALE</span>
              <p className="text-zinc-300 text-[11px] font-sans mt-0.5 leading-relaxed bg-[#141824] p-2.5 rounded-lg border border-[#232736]">
                {selectedDisclosure.why || selectedDisclosure.decisionTrace?.rationale || 'Selected via policy scoring engine.'}
              </p>
            </div>

            {selectedDisclosure.fallback && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-900/60 text-amber-300 space-y-1">
                <span className="text-[10px] font-bold uppercase flex items-center gap-1">
                  <ArrowRightLeft className="w-3.5 h-3.5" /> Failover Triggered
                </span>
                <p className="text-[11px]">
                  Fell back from {selectedDisclosure.fallback.previousRouteId} to current route: {selectedDisclosure.fallback.reason}
                </p>
              </div>
            )}

            {/* Decision Candidate Breakdown */}
            {selectedDisclosure.decisionTrace && (
              <div className="space-y-2 pt-2 border-t border-[#1e2333]">
                <span className="text-[10px] uppercase text-zinc-500 block">EVALUATED CANDIDATES ({selectedDisclosure.decisionTrace.evaluated})</span>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {selectedDisclosure.decisionTrace.candidates?.map((cand: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-2 rounded text-[11px] border ${
                        cand.eligible
                          ? 'border-emerald-900/40 bg-emerald-950/20 text-emerald-300'
                          : 'border-zinc-800 bg-[#121520] text-zinc-500'
                      }`}
                    >
                      <div className="flex justify-between font-semibold">
                        <span>{cand.modelId}</span>
                        <span>{cand.eligible ? `Score: ${cand.score?.toFixed(1) ?? '—'}` : 'Excluded'}</span>
                      </div>
                      {cand.rejection && (
                        <div className="text-[10px] text-red-400 mt-0.5">{cand.rejection}</div>
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
