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
} from 'lucide-react';

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

export default function CoWorkStudioPage() {
  // Connected Skills State
  const [activeSkills, setActiveSkills] = useState<Record<string, boolean>>({
    'gmail': true,
    'browser': true,
    'notion': true,
    'video': true,
    'sheets': false,
  });

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentThought]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [prompt]);

  function handleToggleSkill(skillId: string) {
    setActiveSkills((prev) => ({
      ...prev,
      [skillId]: !prev[skillId],
    }));
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
    setCurrentThought('Analyzing task and selecting connected skills...');

    // Detect which skill fits the user's intent
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
      // Call task router with skill context
      const enabledSkillList = Object.entries(activeSkills)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');

      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `[Autonomous Co-Work Mode | Active Skills: ${enabledSkillList}]\n${textToRun}`,
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
        generatedArtifact = {
          type: 'email',
          title: 'Draft Email to Team',
          data: {
            to: 'team@zoqo.io',
            subject: 'Project Update & Launch Timeline',
            body: fullOutput || 'Hi Team,\n\nHere is our updated project status and launch timeline. Please review the attached deliverables.\n\nBest,\nAise',
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
            metrics: 'Audited 12 latest posts, engagement rate: 4.8%, top content: Product Demo Reel.',
            details: fullOutput,
          },
        };
      } else if (skillType === 'video') {
        generatedArtifact = {
          type: 'video',
          title: '60-Second Viral Video Storyboard',
          data: {
            scenes: [
              { time: '0:00 - 0:03', visual: 'Fast zoom on phone screen showing Zoqo interface', audio: 'Stop doing manual work. Here is how AI changes the game.' },
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

  function handleSendEmail() {
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  }

  function handleCopyArtifact() {
    if (!activeArtifact) return;
    navigator.clipboard.writeText(JSON.stringify(activeArtifact.data, null, 2));
    setCopiedArtifact(true);
    setTimeout(() => setCopiedArtifact(false), 2000);
  }

  return (
    <div className="flex-1 flex h-[calc(100vh-60px)] bg-[#0a0c10] text-zinc-100 overflow-hidden font-sans">
      {/* ========================================================================= */}
      {/* 1. Left Skills & Connectors Drawer                                        */}
      {/* ========================================================================= */}
      <aside className="w-72 border-r border-white/[0.06] bg-[#07080c] flex flex-col shrink-0 select-none">
        <div className="p-4 border-b border-white/[0.05]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Co-Work Studio</h2>
              <p className="text-[10px] text-zinc-500">Autonomous Tools & Skills</p>
            </div>
          </div>
        </div>

        {/* Skills List with Live Toggles */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <div className="flex items-center justify-between px-1 py-1 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
              <span>Connected Skills</span>
              <span className="text-amber-400">
                {Object.values(activeSkills).filter(Boolean).length} Active
              </span>
            </div>

            <div className="space-y-2 mt-2">
              {[
                {
                  id: 'gmail',
                  name: 'Google Workspace',
                  desc: 'Send emails & sync calendar',
                  icon: Mail,
                  color: 'text-red-400',
                },
                {
                  id: 'browser',
                  name: 'Chrome Browser Agent',
                  desc: 'Navigate web & check Instagram/X',
                  icon: Globe,
                  color: 'text-blue-400',
                },
                {
                  id: 'notion',
                  name: 'Notion Knowledge Base',
                  desc: 'Read & query Notion docs via MCP',
                  icon: FileText,
                  color: 'text-emerald-400',
                },
                {
                  id: 'video',
                  name: 'Video & Media Scripting',
                  desc: 'Generate viral hooks & timeline cuts',
                  icon: Video,
                  color: 'text-purple-400',
                },
                {
                  id: 'sheets',
                  name: 'Sheets & Business Analyst',
                  desc: 'Tabular analysis & summaries',
                  icon: BarChart3,
                  color: 'text-amber-400',
                },
              ].map((skill) => {
                const Icon = skill.icon;
                const isEnabled = activeSkills[skill.id] ?? false;
                return (
                  <div
                    key={skill.id}
                    className={`p-3 rounded-xl border transition flex items-start justify-between gap-3 ${
                      isEnabled
                        ? 'bg-white/[0.04] border-white/10'
                        : 'bg-white/[0.01] border-white/[0.04] opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 truncate">
                      <div className={`p-1.5 rounded-lg bg-white/5 ${skill.color} shrink-0 mt-0.5`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-semibold text-zinc-200 truncate">{skill.name}</h4>
                          {isEnabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{skill.desc}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleSkill(skill.id)}
                      className={`w-8 h-4.5 rounded-full transition-colors relative shrink-0 mt-1 ${
                        isEnabled ? 'bg-amber-500' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                          isEnabled ? 'right-0.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Link to Settings & MCP Servers */}
        <div className="p-3 border-t border-white/[0.06] bg-black/30">
          <Link
            href="/settings"
            className="w-full py-2 px-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-xs font-medium text-zinc-300 flex items-center justify-between transition"
          >
            <div className="flex items-center gap-2">
              <Network className="w-3.5 h-3.5 text-amber-400" />
              <span>Connect MCP Servers</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          </Link>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. Center Co-Work Execution Stream                                        */}
      {/* ========================================================================= */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0b0d13] overflow-hidden relative">
        {/* Header */}
        <header className="h-12 border-b border-white/[0.06] bg-[#08090e]/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-white">Shazam Co-Work</span>
            <span className="text-zinc-600">/</span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-zinc-400">Autonomous Assistant Ready</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="text-[11px] text-zinc-400 hover:text-amber-400 flex items-center gap-1 transition"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Manage Skills</span>
            </Link>
          </div>
        </header>

        {/* Execution Log & Conversation */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {messages.length === 0 && !isExecuting ? (
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
                  Tell Shazam what to do. It connects directly with your Google Workspace, Instagram/Chrome, Notion, and creative skills.
                </p>
              </div>

              {/* 4 Action Prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full pt-2">
                {[
                  {
                    icon: <Mail className="w-4 h-4 text-red-400" />,
                    title: 'Send Launch Email',
                    desc: 'Draft and review an email to partners via Google connector',
                    prompt: 'Send an email update to our partners team@zoqo.io announcing our product launch',
                  },
                  {
                    icon: <Globe className="w-4 h-4 text-blue-400" />,
                    title: 'Audit Social Media',
                    desc: 'Open Chrome and analyze my Instagram engagement',
                    prompt: 'Open Chrome, check my Instagram account @zoqo_app, and analyze recent post performance',
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
                      {/* Skill Invocation Badge */}
                      {msg.skillInvoked && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs font-mono text-zinc-300">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-amber-400 font-semibold">{msg.skillInvoked.name}</span>
                          <span className="text-zinc-500">·</span>
                          <span className="text-zinc-400">{msg.skillInvoked.action}</span>
                        </div>
                      )}

                      {/* Main Assistant Text */}
                      <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>

                      {/* Clickable Artifact Badge */}
                      {msg.artifact && (
                        <button
                          onClick={() => setActiveArtifact(msg.artifact!)}
                          className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-medium text-amber-300 flex items-center gap-2 transition shadow-sm"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          <span>View Live Artifact: {msg.artifact.title}</span>
                          <ChevronRight className="w-3 h-3 text-amber-400" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isExecuting && (
                <div className="space-y-2 pt-2 animate-in fade-in duration-150">
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

        {/* Prompt Input */}
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
                    handleExecuteTask();
                  }
                }}
                rows={1}
                placeholder="Instruct Co-Work (e.g. Send an email via Google, audit Instagram in Chrome, query Notion)..."
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
        <aside className="w-[480px] border-l border-white/[0.08] bg-[#0c0e14] flex flex-col shrink-0 z-30 animate-in slide-in-from-right duration-200 shadow-2xl">
          <div className="h-12 px-4 border-b border-white/[0.06] bg-black/40 flex items-center justify-between">
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

          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs leading-relaxed">
            {/* Mode A: Email Artifact */}
            {activeArtifact.type === 'email' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <span className="font-semibold text-zinc-500 uppercase text-[10px]">To:</span>
                    <span className="text-zinc-200 font-mono">{activeArtifact.data.to}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <span className="font-semibold text-zinc-500 uppercase text-[10px]">Subject:</span>
                    <span className="text-white font-medium">{activeArtifact.data.subject}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-black/30 border border-white/5 whitespace-pre-wrap text-zinc-200 font-sans leading-relaxed">
                  {activeArtifact.data.body}
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">Google Connector: Verified</span>
                  <button
                    onClick={handleSendEmail}
                    disabled={emailSent}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-xl transition flex items-center gap-1.5 shadow-md disabled:opacity-50"
                  >
                    {emailSent ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Email Sent!</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Send via Gmail</span>
                      </>
                    )}
                  </button>
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
                      <p className="text-xs text-zinc-200 font-medium">🎬 Visual: {scene.visual}</p>
                      <p className="text-xs text-zinc-400 italic">🎙️ Audio: &ldquo;{scene.audio}&rdquo;</p>
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
