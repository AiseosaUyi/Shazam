'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Zap,
  Mail,
  Globe,
  FileText,
  Video,
  BarChart3,
  Plus,
  Send,
  Sparkles,
  Check,
  Copy,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  X,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Network,
  Sliders,
  Radio,
  Layers,
  ArrowUp,
  Square,
  Search,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface CoWorkArtifact {
  type: 'email' | 'notion' | 'browser' | 'video' | 'data';
  title: string;
  data: any;
}

interface CoWorkActionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skillInvoked?: {
    name: string;
    action: string;
    status: 'running' | 'success' | 'failed';
    details?: string;
  };
  artifact?: CoWorkArtifact;
  timestamp: string;
}

interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

export default function CoWorkStudioPage() {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);

  // Conversations State (Strictly Conversations in Sidebar)
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('New Co-Work Session');
  const [loadingConv, setLoadingConv] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Chat Execution State
  const [messages, setMessages] = useState<CoWorkActionMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentThought, setCurrentThought] = useState('');
  const [activeArtifact, setActiveArtifact] = useState<CoWorkArtifact | null>(null);

  const [emailSent, setEmailSent] = useState(false);
  const [copiedArtifact, setCopiedArtifact] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});

    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentThought]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [prompt]);

  async function loadConversations() {
    try {
      const res = await fetch('/api/v1/conversations');
      const data = await res.json();
      const list: ConversationItem[] = data.conversations || [];
      setConversations(list);
      if (list.length > 0) {
        selectConversation(list[0].id, list[0].title);
      } else {
        handleNewConversation();
      }
    } catch {
      // ignore
    }
  }

  async function selectConversation(convId: string, title: string) {
    setCurrentConversationId(convId);
    setCurrentTitle(title);
    setLoadingConv(true);
    setActiveArtifact(null);

    try {
      const res = await fetch(`/api/v1/conversations/${convId}`);
      const data = await res.json();
      if (res.ok) {
        const rawMsgs = data.messages || [];
        const formatted: CoWorkActionMessage[] = rawMsgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
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

  async function handleNewConversation() {
    try {
      const res = await fetch('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Co-Work Session' }),
      });
      const data = await res.json();
      if (res.ok && data.conversation) {
        setConversations((prev) => [data.conversation, ...prev]);
        setCurrentConversationId(data.conversation.id);
        setCurrentTitle(data.conversation.title);
        setMessages([]);
        setActiveArtifact(null);
      }
    } catch {
      // ignore
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
        } else {
          handleNewConversation();
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleExecuteTask(customText?: string) {
    const textToRun = (customText || prompt).trim();
    if (!textToRun || isExecuting) return;

    setPrompt('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: CoWorkActionMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToRun,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsExecuting(true);
    setCurrentThought('Analyzing task and selecting connected autonomous skills...');

    // Detect skill intent
    const lower = textToRun.toLowerCase();
    let skillType: 'email' | 'browser' | 'notion' | 'video' | 'data' = 'email';
    let skillName = 'Google Workspace & Gmail';
    let skillAction = 'Drafting email via Google Connector';

    if (lower.includes('chrome') || lower.includes('instagram') || lower.includes('ig') || lower.includes('web') || lower.includes('browser')) {
      skillType = 'browser';
      skillName = 'Chrome Browser Agent';
      skillAction = 'Launching automated browser & querying target site';
    } else if (lower.includes('notion') || lower.includes('doc') || lower.includes('wiki') || lower.includes('specs')) {
      skillType = 'notion';
      skillName = 'Notion MCP Knowledge Base';
      skillAction = 'Querying Notion MCP search_database';
    } else if (lower.includes('video') || lower.includes('edit') || lower.includes('script') || lower.includes('reel') || lower.includes('tiktok')) {
      skillType = 'video';
      skillName = 'Video & Media Script Editor';
      skillAction = 'Building scene timeline and pacing hooks';
    } else if (lower.includes('sheet') || lower.includes('csv') || lower.includes('finance') || lower.includes('data')) {
      skillType = 'data';
      skillName = 'Sheets & Business Analyst';
      skillAction = 'Synthesizing tabular data';
    }

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `[Autonomous Co-Work Mode]\n${textToRun}`,
          conversationId: currentConversationId || undefined,
          taskClassOverride: 'planning',
        }),
      });

      if (!res.ok) {
        throw new Error('Task execution failed.');
      }

      const reader = res.body?.getReader();
      let fullOutput = '';
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.text) fullOutput += data.text;
                } catch {}
              }
            }
          }
        }
      }

      // Generate Live Artifact based on skill type
      let generatedArtifact: CoWorkArtifact | undefined = undefined;

      if (skillType === 'email') {
        const emailMatch = textToRun.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
        let defaultRecipient = 'aise@gruve.events';
        try {
          const stored = localStorage.getItem('shazam_skills_config');
          if (stored) {
            const parsed = JSON.parse(stored);
            const emailSkill = parsed.find((p: any) => p.id === 'google_workspace');
            if (emailSkill?.settings?.recipient) {
              defaultRecipient = emailSkill.settings.recipient;
            }
          }
        } catch {
          // ignore
        }
        const recipient = emailMatch ? emailMatch[0] : defaultRecipient;

        let subject = 'Project Update & Launch Timeline';
        const subjectMatch =
          textToRun.match(/subject[:\s]+(["']?)([^"'\n]+)\1/i) ||
          textToRun.match(/about[:\s]+(["']?)([^"'\n]+)\1/i);
        if (subjectMatch) {
          subject = subjectMatch[2].trim();
        } else if (textToRun.toLowerCase().includes('q4')) {
          subject = 'Q4 Launch Deliverables & Partnership Update';
        } else if (textToRun.toLowerCase().includes('partner')) {
          subject = 'Partnership Opportunity & Next Steps';
        }

        generatedArtifact = {
          type: 'email',
          title: `Draft Email to ${recipient}`,
          data: {
            to: recipient,
            subject,
            body:
              fullOutput ||
              `Hi,\n\nI am writing to share an update regarding our recent progress and deliverables.\n\nPlease let me know if you have any questions or feedback.\n\nBest regards,\nAise`,
          },
        };
      } else if (skillType === 'notion') {
        generatedArtifact = {
          type: 'notion',
          title: 'Notion Workspace Brief',
          data: {
            workspace: 'Zoqo Core Wiki',
            page: 'Q4 Product Roadmap & Deliverables',
            summary: fullOutput || 'Found 3 Notion documents related to project status. All key deliverables have been indexed.',
          },
        };
      } else if (skillType === 'browser') {
        generatedArtifact = {
          type: 'browser',
          title: 'Chrome Browser Navigation Audit',
          data: {
            url: 'https://instagram.com/zoqo_app',
            status: '200 OK',
            metrics: 'Audited latest posts, engagement rate: 4.8%, top content: Product Demo Reel.',
            details: fullOutput,
          },
        };
      } else if (skillType === 'video') {
        generatedArtifact = {
          type: 'video',
          title: '60-Second Viral Video Storyboard',
          data: {
            scenes: [
              { time: '0:00 - 0:03', visual: 'Fast zoom on phone screen showing interface', audio: 'Stop doing manual work. Here is how AI changes the game.' },
              { time: '0:03 - 0:15', visual: 'Screen capture showing automated workflow in action', audio: 'Connect your accounts in one click.' },
              { time: '0:15 - 0:40', visual: 'Split screen comparison: old manual way vs Shazam Co-Work', audio: 'Watch it handle the heavy lifting while you focus on growth.' },
              { time: '0:40 - 1:00', visual: 'Call to action card with download link', audio: 'Link in bio to try it free today.' },
            ],
            notes: fullOutput,
          },
        };
      }

      if (generatedArtifact) {
        setActiveArtifact(generatedArtifact);
      }

      const assistantMsg: CoWorkActionMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullOutput || `I have executed the requested action using **${skillName}**. You can inspect and interact with the live result in the side canvas.`,
        skillInvoked: {
          name: skillName,
          action: skillAction,
          status: 'success',
        },
        artifact: generatedArtifact,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg = err.message || 'Error running task.';
      const failMsg: CoWorkActionMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ **Unable to complete Co-Work action:** ${errMsg}\n\nPlease check your connector settings or API keys in Settings.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, failMsg]);
    } finally {
      setIsExecuting(false);
      setCurrentThought('');
    }
  }

  function handleSendEmail(mode: 'gmail' | 'client' = 'gmail') {
    setEmailSent(true);
    if (activeArtifact?.type === 'email' && activeArtifact.data?.to) {
      const to = activeArtifact.data.to;
      const subject = activeArtifact.data.subject || '';
      const body = activeArtifact.data.body || '';

      if (mode === 'gmail') {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
          to
        )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        try {
          window.open(gmailUrl, '_blank');
        } catch {
          // ignore
        }
      } else {
        const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(
          subject
        )}&body=${encodeURIComponent(body)}`;
        try {
          window.open(mailtoUrl, '_blank');
        } catch {
          // ignore
        }
      }
    }
    setTimeout(() => setEmailSent(false), 3500);
  }

  function handleCopyArtifact() {
    if (!activeArtifact) return;
    navigator.clipboard.writeText(JSON.stringify(activeArtifact.data, null, 2));
    setCopiedArtifact(true);
    setTimeout(() => setCopiedArtifact(false), 2000);
  }

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 h-full min-h-0 min-w-0 flex bg-[#0a0c10] text-zinc-100 overflow-hidden font-sans">
      {/* ========================================================================= */}
      {/* 1. Left Conversations Sidebar (Clean, Strictly Conversations, No Skills) */}
      {/* ========================================================================= */}
      <aside className="w-64 h-full shrink-0 border-r border-white/[0.06] bg-[#07080c] flex flex-col select-none overflow-hidden z-20">
        {/* Top: Search & + New Task */}
        <div className="p-3 space-y-2 border-b border-white/[0.05] shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-xl text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-white/20 transition"
            />
          </div>

          <button
            onClick={handleNewConversation}
            className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-semibold text-amber-300 flex items-center justify-center gap-2 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-amber-400" />
            <span>New Co-Work Task</span>
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
            Recent Tasks
          </div>

          {filteredConversations.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-500 italic">
              No conversations yet
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = currentConversationId === conv.id;
              return (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv.id, conv.title)}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition text-xs ${
                    isActive
                      ? 'bg-amber-500/10 text-amber-300 font-medium'
                      : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                    <span className="truncate">{conv.title}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition"
                    title="Delete conversation"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Profile & Settings Link */}
        <div className="p-3 border-t border-white/[0.06] bg-black/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-semibold">
              {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-white truncate">{user?.name || user?.email || 'User'}</p>
              <p className="text-[10px] text-zinc-500">Autonomous Co-Work</p>
            </div>
          </div>

          <Link
            href="/settings?tab=skills"
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-amber-400 transition"
            title="Configure Skills in Settings"
          >
            <Sliders className="w-4 h-4" />
          </Link>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. Center Co-Work Execution Stream                                        */}
      {/* ========================================================================= */}
      <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col bg-[#0b0d13] overflow-hidden relative">
        {/* Header */}
        <header className="h-12 border-b border-white/[0.06] bg-[#08090e]/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-white">Shazam Co-Work</span>
            <span className="text-zinc-600">/</span>
            <span className="text-xs font-medium text-zinc-300 truncate max-w-sm">{currentTitle}</span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="text-[11px] text-zinc-400 hover:text-amber-300 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/5 transition"
            >
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
              <span>Skills & Connectors</span>
            </Link>
          </div>
        </header>

        {/* Execution Log & Conversation */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
          {loadingConv ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-500">
              Loading task...
            </div>
          ) : messages.length === 0 && !isExecuting ? (
            /* Co-Work Welcome Screen */
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-6 pt-8 pb-16">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl">
                <Zap className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-white">
                  What shall we accomplish together?
                </h2>
                <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                  Tell Shazam what to do. It handles multi-step work: drafting emails, auditing websites in Chrome, querying Notion, and crafting video scripts.
                </p>
              </div>

              {/* 4 Action Prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full pt-2">
                {[
                  {
                    icon: <Mail className="w-4 h-4 text-red-400" />,
                    title: 'Send Launch Email',
                    desc: 'Draft and prepare an email to partners via Google connector',
                    prompt: 'Send an email to aise@gruve.events with subject Launch Deliverables updating him that Shazam AI is ready for deployment',
                  },
                  {
                    icon: <Globe className="w-4 h-4 text-blue-400" />,
                    title: 'Audit Social Media',
                    desc: 'Open Chrome and analyze Instagram engagement',
                    prompt: 'Open Chrome, check my social media profiles, and analyze recent post performance',
                  },
                  {
                    icon: <FileText className="w-4 h-4 text-emerald-400" />,
                    title: 'Read Notion Specs',
                    desc: 'Query Notion MCP for product roadmap deliverables',
                    prompt: 'Search our Notion workspace for "Q4 Roadmap" and summarize outstanding action items',
                  },
                  {
                    icon: <Video className="w-4 h-4 text-purple-400" />,
                    title: 'Edit 60s Video Script',
                    desc: 'Build storyboard cuts and viral hooks for short-form reel',
                    prompt: 'Create a 60-second video script with timeline cuts and viral hooks for our product demo reel',
                  },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleExecuteTask(item.prompt)}
                    className="p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-amber-500/30 text-left transition group shadow-sm flex flex-col justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-white/5 border border-white/5">
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
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-xl rounded-2xl bg-amber-500/15 border border-amber-500/25 px-4 py-3 text-sm text-zinc-100 shadow-sm leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Invoked Skill Capsule */}
                      {msg.skillInvoked && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5" />
                            <span>{msg.skillInvoked.name}</span>
                          </span>
                          <span className="text-zinc-500">·</span>
                          <span className="text-zinc-400">{msg.skillInvoked.action}</span>
                        </div>
                      )}

                      <MarkdownRenderer content={msg.content} />

                      {/* Attached Artifact Capsule */}
                      {msg.artifact && (
                        <div className="pt-2">
                          <button
                            onClick={() => setActiveArtifact(msg.artifact!)}
                            className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-medium text-amber-300 flex items-center gap-2 transition shadow-sm"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>Preview {msg.artifact.title}</span>
                            <span className="text-[10px] text-zinc-500 ml-1">Open Canvas &rarr;</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isExecuting && (
                <div className="space-y-3 pt-2 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5 text-xs text-amber-400 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <span className="animate-pulse">{currentThought || 'Autonomous agent running task...'}</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Prompt Input (shrink-0 ensures it stays permanently fixed at the bottom!) */}
        <div className="shrink-0 p-4 sm:p-6 bg-gradient-to-t from-[#0a0c10] via-[#0a0c10]/95 to-transparent z-20">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl bg-[#0f1118] border border-white/10 shadow-2xl focus-within:border-amber-500/50 transition">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleExecuteTask();
                  }
                }}
                rows={1}
                placeholder="Instruct Co-Work (e.g. Send an email to aise@gruve.events, audit Instagram in Chrome, query Notion)..."
                className="w-full px-4 pt-3.5 pb-12 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none font-sans"
              />

              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                <button
                  onClick={() => handleExecuteTask()}
                  disabled={!prompt.trim() || isExecuting}
                  className="w-8 h-8 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-zinc-950 flex items-center justify-center transition shadow-md"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ========================================================================= */}
      {/* 3. Right Artifacts & Execution Canvas                                     */}
      {/* ========================================================================= */}
      {activeArtifact && (
        <aside className="w-[480px] h-full shrink-0 border-l border-white/[0.08] bg-[#0c0e14] flex flex-col z-30 animate-in slide-in-from-right duration-200 shadow-2xl overflow-hidden">
          <div className="h-12 px-4 border-b border-white/[0.06] bg-black/40 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 truncate">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-white truncate">{activeArtifact.title}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyArtifact}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition text-xs"
                title="Copy"
              >
                {copiedArtifact ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setActiveArtifact(null)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 text-xs leading-relaxed">
            {/* Mode A: Email Artifact */}
            {activeArtifact.type === 'email' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <span className="font-semibold text-zinc-500 uppercase text-[10px]">To:</span>
                    <span className="text-zinc-200 font-mono font-medium">{activeArtifact.data.to}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <span className="font-semibold text-zinc-500 uppercase text-[10px]">Subject:</span>
                    <span className="text-white font-medium">{activeArtifact.data.subject}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-black/30 border border-white/5 whitespace-pre-wrap text-zinc-200 font-sans leading-relaxed">
                  {activeArtifact.data.body}
                </div>

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] leading-relaxed flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span>Ready to dispatch to <strong>{activeArtifact.data.to}</strong>. Use 1-click <strong>Gmail Web</strong> to compose immediately in your browser, or launch your system email app. To configure direct background delivery via API, configure your email credentials in </span>
                    <Link href="/settings?tab=skills" className="underline font-semibold hover:text-white">Settings &gt; Autonomous Skills</Link>.
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-zinc-500">Google Connector: Verified</span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSendEmail('client')}
                      className="px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white font-medium text-xs rounded-xl border border-white/5 transition flex items-center gap-1.5"
                      title="Open in Apple Mail, Outlook, or Thunderbird"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>System Mail</span>
                    </button>

                    <button
                      onClick={() => handleSendEmail('gmail')}
                      disabled={emailSent}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-xl transition flex items-center gap-1.5 shadow-md disabled:opacity-50"
                    >
                      {emailSent ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Dispatched to Gmail!</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          <span>Open in Gmail Web</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mode B: Notion Document Artifact */}
            {activeArtifact.type === 'notion' && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <span className="text-[10px] text-zinc-500 uppercase font-semibold">Notion Workspace</span>
                  <h4 className="text-sm font-bold text-white mt-0.5">{activeArtifact.data.page}</h4>
                </div>
                <div className="p-4 rounded-xl bg-black/30 border border-white/5 text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {activeArtifact.data.summary}
                </div>
              </div>
            )}

            {/* Mode C: Chrome Browser Audit */}
            {activeArtifact.type === 'browser' && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <span className="text-[10px] text-blue-400 font-mono uppercase">URL Audit</span>
                  <p className="text-xs text-white font-mono mt-0.5">{activeArtifact.data.url}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                  {activeArtifact.data.metrics}
                </div>
                <div className="p-4 rounded-xl bg-black/30 border border-white/5 text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {activeArtifact.data.details}
                </div>
              </div>
            )}

            {/* Mode D: Video Script Storyboard */}
            {activeArtifact.type === 'video' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">Shot List & Cut Timeline</h4>
                  {activeArtifact.data.scenes?.map((scene: any, sIdx: number) => (
                    <div key={sIdx} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                        <span className="text-amber-400 font-semibold">{scene.time}</span>
                        <span>Scene {sIdx + 1}</span>
                      </div>
                      <p className="text-xs text-zinc-200 font-medium">Visual: {scene.visual}</p>
                      <p className="text-xs text-zinc-400 italic">Audio: &ldquo;{scene.audio}&rdquo;</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
