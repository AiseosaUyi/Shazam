'use client';

import { useDialog } from '@/components/ui/dialog';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { upload } from '@vercel/blob/client';
import {
  Zap,
  Mail,
  Plus,
  Search,
  MessageSquare,
  Trash2,
  ArrowUp,
  Square,
  Check,
  X,
  CalendarClock,
  Paperclip,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Network,
  Sparkles,
  Pause,
  Play,
  Ban,
  Wrench,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { SystemStrip } from '@/components/SystemStrip';
import { AgentSuggestion } from '@/components/AgentSuggestion';
import { StepList, formatWhen, type ToolStep } from '@/components/agent/StepList';
import { QuestionCard, PlanCard } from '@/components/agent/AgentCards';

/**
 * Co-Work: a real tool-using assistant. Every step shown here is an actual tool call;
 * outward actions (send, schedule, create event, change MCP data) appear as approval cards
 * and only execute when the user approves them.
 */

interface ConversationItem {
  id: string;
  title: string;
  updatedAt?: string;
}

interface PendingAction {
  id: string;
  kind: string;
  summary: string;
  payload?: any;
  status?: 'pending' | 'executing' | 'executed' | 'failed' | 'rejected';
  result?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: ToolStep[];
  actions?: PendingAction[];
  error?: string;
}

interface ScheduledJob {
  id: string;
  kind: string;
  title: string;
  runAt: string;
  recurrence: string | null;
  status: string;
  lastError: string | null;
}

interface Status {
  google: { configured: boolean; connected: boolean; email: string | null };
  mcpCount: number;
  mcpTools: number;
  skills: number;
}

function ApprovalCard({ action, onDecide }: { action: PendingAction; onDecide: (a: PendingAction, decision: 'approve' | 'reject', edits?: any) => void }) {
  const p = action.payload || {};
  const isEmail = action.kind === 'gmail_send' || action.kind === 'schedule_email';
  const [to, setTo] = useState<string>((p.to || []).join(', '));
  const [subject, setSubject] = useState<string>(p.subject || '');
  const [body, setBody] = useState<string>(p.body || '');
  const pending = !action.status || action.status === 'pending';

  const icon = action.kind === 'schedule_email' || action.kind === 'schedule_task' ? <CalendarClock className="w-4 h-4" /> : action.kind.startsWith('gmail') ? <Mail className="w-4 h-4" /> : <Wrench className="w-4 h-4" />;

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/[0.04] p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <div className="text-brand mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-brand/80">
            {pending ? 'Needs your approval' : action.status === 'executed' ? 'Done' : action.status === 'executing' ? 'Running…' : action.status === 'rejected' ? 'Rejected' : 'Failed'}
          </p>
          <p className="text-xs text-ink">{action.summary}</p>
          {p.sendAt && <p className="text-[11px] text-ink-2 mt-0.5">Sends {formatWhen(p.sendAt)}{p.recurrence ? ` · repeats ${p.recurrence}` : ''}</p>}
          {p.runAt && <p className="text-[11px] text-ink-2 mt-0.5">Runs {formatWhen(p.runAt)}{p.recurrence ? ` · repeats ${p.recurrence}` : ''}</p>}
        </div>
      </div>

      {isEmail && (
        <div className="space-y-1.5">
          <input disabled={!pending} value={to} onChange={(e) => setTo(e.target.value)} className="w-full bg-black/40 border border-line/10 rounded-lg px-2.5 py-1.5 text-xs text-ink disabled:opacity-70" aria-label="To" />
          <input disabled={!pending} value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full bg-black/40 border border-line/10 rounded-lg px-2.5 py-1.5 text-xs text-ink font-medium disabled:opacity-70" aria-label="Subject" />
          <textarea disabled={!pending} value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(4, body.split('\n').length + 1))} className="w-full bg-black/40 border border-line/10 rounded-lg px-2.5 py-2 text-xs text-ink leading-relaxed disabled:opacity-70" aria-label="Body" />
        </div>
      )}
      {!isEmail && action.payload && (
        <pre className="text-[10px] text-ink-2 bg-black/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-48">{JSON.stringify(action.payload, null, 2)}</pre>
      )}

      {action.result && <p className={`text-[11px] ${action.status === 'executed' ? 'text-emerald-300' : 'text-red-300'}`}>{action.result}</p>}

      {pending && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDecide(action, 'approve', isEmail ? { to: to.split(',').map((s) => s.trim()).filter(Boolean), subject, body } : undefined)}
            className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-soft text-black text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Check className="w-3.5 h-3.5" />
            {action.kind === 'gmail_send' ? 'Send' : action.kind.startsWith('schedule') ? 'Schedule' : 'Approve'}
          </button>
          <button onClick={() => onDecide(action, 'reject')} className="px-3 py-1.5 rounded-lg bg-line/5 hover:bg-line/10 text-ink-2 text-xs flex items-center gap-1.5 transition">
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
      {action.status === 'executing' && <Loader2 className="w-4 h-4 text-brand animate-spin" />}
    </div>
  );
}

export default function CoWorkPage() {
  const dialog = useDialog();
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [autorun, setAutorun] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [liveActions, setLiveActions] = useState<PendingAction[]>([]);
  const [livePlan, setLivePlan] = useState<any[]>([]);
  const [liveQuestions, setLiveQuestions] = useState<Array<{ id: string; question: string; options: string[] }>>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string; type: string }>>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  const loadStatus = useCallback(async () => {
    const [g, m, s] = await Promise.all([
      fetch('/api/v1/oauth/google').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/v1/mcp').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/v1/skills').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const servers = (m?.servers || []).filter((x: any) => x.status === 'active');
    setStatus({
      google: { configured: Boolean(g?.configured), connected: Boolean(g?.connected), email: g?.email || null },
      mcpCount: servers.length,
      mcpTools: servers.reduce((n: number, x: any) => n + (x.tools?.length || 0), 0),
      skills: (s?.skills || []).filter((x: any) => x.enabled).length,
    });
  }, []);

  const loadJobs = useCallback(async () => {
    const r = await fetch('/api/v1/schedules').then((res) => (res.ok ? res.json() : null)).catch(() => null);
    setJobs(r?.jobs || []);
  }, []);

  const loadConversations = useCallback(async () => {
    const r = await fetch('/api/v1/conversations').then((res) => (res.ok ? res.json() : null)).catch(() => null);
    setConversations(r?.conversations || []);
  }, []);

  useEffect(() => {
    fetch('/api/v1/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d?.user && setUser(d.user)).catch(() => {});
    loadConversations();
    loadStatus();
    loadJobs();
    const q = new URLSearchParams(window.location.search);
    const pre = q.get('prompt');
    if (pre) setPrompt(pre);
    if (pre && q.get('autorun') === '1') {
      setAutorun(true);
      window.history.replaceState(null, '', '/cowork');
    }
  }, [loadConversations, loadStatus, loadJobs]);

  useEffect(() => {
    if (autorun && prompt.trim() && !busy) {
      setAutorun(false);
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, prompt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveText, liveSteps, liveActions]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  async function openConversation(id: string) {
    setCurrentId(id);
    setMessages([]);
    const r = await fetch(`/api/v1/conversations/${id}`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    setMessages((r?.messages || []).map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
  }

  function newTask() {
    setCurrentId(null);
    setMessages([]);
    setAttachments([]);
    textareaRef.current?.focus();
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/v1/conversations/${id}`, { method: 'DELETE' });
    if (id === currentId) newTask();
    loadConversations();
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !user) return;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const blob = await upload(`uploads/${user.id}/${file.name}`, file, { access: 'public', handleUploadUrl: '/api/v1/media/upload' });
        setAttachments((prev) => [...prev, { name: file.name, url: blob.url, type: file.type }]);
      } catch (err: any) {
        dialog.alert({ title: 'Upload failed', body: String(err.message || err) });
      } finally {
        setUploading(null);
      }
    }
  }

  async function decide(action: PendingAction, decision: 'approve' | 'reject', edits?: any) {
    const update = (patch: Partial<PendingAction>) => {
      const apply = (list?: PendingAction[]) => list?.map((a) => (a.id === action.id ? { ...a, ...patch } : a));
      setMessages((prev) => prev.map((m) => (m.actions ? { ...m, actions: apply(m.actions) } : m)));
      setLiveActions((prev) => apply(prev) || []);
    };
    update({ status: decision === 'approve' ? 'executing' : 'rejected' });
    const res = await fetch(`/api/v1/cowork/actions/${action.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, payload: edits }),
    });
    const data = await res.json().catch(() => ({}));
    if (decision === 'approve') update({ status: data.status === 'executed' ? 'executed' : 'failed', result: data.result || data.error });
    loadJobs();
  }

  async function send() {
    const text = prompt.trim();
    if ((!text && attachments.length === 0) || busy) return;
    const attachmentText = attachments.map((a) => `\n[Attached ${a.type.startsWith('video') ? 'video' : a.type.startsWith('image') ? 'image' : 'file'}: ${a.name}](${a.url})`).join('');
    const fullPrompt = `${text}${attachmentText}`;

    setPrompt('');
    setAttachments([]);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: fullPrompt }]);
    setBusy(true);
    setLiveText('');
    setLiveSteps([]);
    setLiveActions([]);
    setLivePlan([]);
    setLiveQuestions([]);

    const steps: ToolStep[] = [];
    const actions: PendingAction[] = [];
    let output = '';
    let error: string | undefined;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/v1/cowork/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, conversationId: currentId || undefined, timezone }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          let d: any;
          try {
            d = JSON.parse(data);
          } catch {
            continue;
          }
          if (event === 'cowork_start' && d.conversationId) {
            if (!currentId) setCurrentId(d.conversationId);
          } else if (event === 'agent_text') {
            output += d.delta || '';
            setLiveText(output);
          } else if (event === 'react_step') {
            steps.push({ step: d.step, tool: d.tool, args: d.args });
            setLiveSteps([...steps]);
          } else if (event === 'react_observation') {
            const target = [...steps].reverse().find((s) => s.observation === undefined && (!d.tool || s.tool === d.tool));
            if (target) {
              target.observation = d.observation;
              target.isError = d.isError;
            }
            setLiveSteps([...steps]);
          } else if (event === 'todos') {
            setLivePlan(d.todos || []);
          } else if (event === 'question') {
            setLiveQuestions((prev) => [...prev, { id: d.id, question: d.question, options: d.options }]);
          } else if (event === 'pending_action') {
            actions.push({ id: d.id, kind: d.kind || 'mcp_call', summary: d.summary, payload: d.payload, status: 'pending' });
            setLiveActions([...actions]);
          } else if (event === 'cowork_done') {
            output = d.text || output;
          } else if (event === 'cowork_error') {
            error = d.message;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') error = err.message || 'Something went wrong.';
    } finally {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: output, steps: [...steps], actions: [...actions], error }]);
      setLiveText('');
      setLiveSteps([]);
      setLiveActions([]);
      setBusy(false);
      abortRef.current = null;
      loadConversations();
      loadJobs();
    }
  }

  async function jobAction(id: string, action: 'pause' | 'resume' | 'cancel') {
    await fetch(`/api/v1/schedules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    loadJobs();
  }

  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex-1 h-full min-h-0 min-w-0 flex bg-canvas text-ink overflow-hidden font-sans">
      {/* Conversations */}
      <aside className="w-64 h-full shrink-0 border-r border-line/[0.06] bg-sidebar hidden md:flex flex-col overflow-hidden">
        <div className="space-y-0.5 p-3">
          <button onClick={newTask} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface-2">
            <Plus className="h-4 w-4 text-brand" /> New task
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-ink-3" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" className="w-full rounded-xl bg-transparent py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-2 hover:bg-surface-2/60 focus:bg-surface-2 focus:outline-none" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-ink-3">Recent</div>
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-xs text-ink-3">No tasks yet</div>}
          {filtered.map((c) => (
            <div key={c.id} onClick={() => openConversation(c.id)} className={`group flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer text-xs transition ${c.id === currentId ? 'bg-brand/10 text-brand-soft font-medium' : 'text-ink-2 hover:bg-line/[0.03] hover:text-ink'}`}>
              <div className="flex items-center gap-2 truncate">
                <MessageSquare className="w-3.5 h-3.5 shrink-0 text-ink-3" />
                <span className="truncate">{c.title}</span>
              </div>
              <button onClick={(e) => deleteConversation(c.id, e)} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400" title="Delete">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col bg-canvas overflow-hidden">
        <header className="h-12 border-b border-line/[0.06] px-4 md:px-6 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-ink">Shazam Co-Work</span>
          <button onClick={() => setPanelOpen((v) => !v)} className="text-[11px] text-ink-2 hover:text-brand-soft flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-line/[0.03] border border-line/5">
            <CalendarClock className="w-3.5 h-3.5 text-brand" />
            Schedules & connections
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && !busy && (
              <div className="shz-atmosphere -mx-6 -mt-6 px-6 pt-[10vh] pb-6 text-center space-y-6">
                <p className="shz-mono text-[11px] tracking-[0.2em] text-brand/80">Co-Work</p>
                <div className="space-y-2">
                  <h2 className="text-[30px] font-semibold tracking-[-0.025em] text-ink">What should we get done?</h2>
                  <p className="text-xs text-ink-2 max-w-md mx-auto leading-relaxed">
                    Co-Work uses your connected Gmail, Calendar, MCP servers and skills to do the work. Anything that sends or changes data waits for your approval.
                  </p>
                </div>
                <SystemStrip show={['models', 'google', 'mcp', 'browser']} />
                {status && !status.google.connected && (
                  <div className="max-w-md mx-auto text-left text-xs rounded-xl border border-line/10 bg-line/[0.03] p-3 flex items-center gap-3">
                    <Mail className="w-4 h-4 text-brand shrink-0" />
                    <span className="text-ink-2 flex-1">Connect Google to read, send and schedule email and manage your calendar.</span>
                    {status.google.configured ? (
                      <a href="/api/v1/oauth/google/start" className="px-2.5 py-1 rounded-lg bg-brand text-black font-semibold whitespace-nowrap">Connect</a>
                    ) : (
                      <span className="text-[10px] text-ink-3">Admin setup needed</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-line/[0.06] border border-line/[0.08] px-4 py-2.5 text-sm text-ink whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="space-y-3">
                  {m.steps && m.steps.length > 0 && <StepList steps={m.steps} />}
                  {m.content && <MarkdownRenderer content={m.content} className="text-sm text-ink" />}
                  {m.actions?.map((a) => <ApprovalCard key={a.id} action={a} onDecide={decide} />)}
                  {m.error && (
                    <div className="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{m.error}</span>
                    </div>
                  )}
                </div>
              )
            )}

            {busy && (
              <div className="space-y-3">
                {livePlan.length > 0 && <PlanCard todos={livePlan} />}
                <StepList steps={liveSteps.filter((x) => x.tool !== 'todo_write' && x.tool !== 'ask_user')} live />
                {liveQuestions.map((q) => <QuestionCard key={q.id} id={q.id} question={q.question} options={q.options} />)}
                {liveText ? <MarkdownRenderer content={liveText} className="text-sm text-ink" /> : (
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                    Working…
                  </div>
                )}
                {liveActions.map((a) => <ApprovalCard key={a.id} action={a} onDecide={decide} />)}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="px-4 md:px-6 pb-4 shrink-0">
          <div className="max-w-3xl mx-auto">{!busy && <AgentSuggestion prompt={prompt} current="cowork" />}</div>
          <div className="shz-composer max-w-3xl mx-auto">
            {(attachments.length > 0 || uploading) && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {attachments.map((a, i) => (
                  <span key={a.url} className="text-[11px] text-ink-2 bg-line/5 border border-line/10 rounded-lg px-2 py-1 flex items-center gap-1.5">
                    <Paperclip className="w-3 h-3" />
                    {a.name}
                    <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                      <X className="w-3 h-3 hover:text-red-400" />
                    </button>
                  </span>
                ))}
                {uploading && (
                  <span className="text-[11px] text-ink-2 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Uploading {uploading}…
                  </span>
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Ask Co-Work to email, schedule, research, design or edit a video…"
              className="w-full bg-transparent resize-none px-4 pt-3 pb-1 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1">
                <input ref={fileRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()} disabled={!user || Boolean(uploading)} className="p-1.5 rounded-lg text-ink-2 hover:text-brand-soft hover:bg-line/5 disabled:opacity-40" title="Attach video, audio or image">
                  <Paperclip className="w-4 h-4" />
                </button>
                <span className="text-[10px] text-ink-3 hidden sm:inline">{timezone}</span>
              </div>
              {busy ? (
                <button onClick={() => abortRef.current?.abort()} className="w-8 h-8 rounded-xl bg-line/10 hover:bg-line/15 flex items-center justify-center" title="Stop">
                  <Square className="w-3.5 h-3.5 text-ink" />
                </button>
              ) : (
                <button onClick={send} disabled={!prompt.trim() && attachments.length === 0} className="w-8 h-8 rounded-xl bg-brand hover:bg-brand-soft disabled:opacity-30 flex items-center justify-center" title="Send">
                  <ArrowUp className="w-4 h-4 text-black" />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Schedules & connections */}
      {panelOpen && (
        <aside className="w-80 h-full shrink-0 border-l border-line/[0.06] bg-canvas hidden lg:flex flex-col overflow-y-auto">
          <section className="p-4 border-b border-line/[0.05] space-y-2.5">
            <h3 className="text-[10px] font-bold text-ink-2">Connected</h3>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-ink-2"><Mail className="w-3.5 h-3.5 text-ink-3" /> Gmail & Calendar</span>
              {status?.google.connected ? (
                <span className="text-emerald-400 text-[11px] truncate max-w-[140px]" title={status.google.email || ''}>{status.google.email || 'Connected'}</span>
              ) : status?.google.configured ? (
                <a href="/api/v1/oauth/google/start" className="text-brand-soft text-[11px] hover:underline">Connect</a>
              ) : (
                <span className="text-ink-3 text-[11px]">Not set up</span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-ink-2"><Network className="w-3.5 h-3.5 text-ink-3" /> MCP servers</span>
              <Link href="/settings?tab=mcp" className="text-[11px] text-ink-2 hover:text-brand-soft">{status ? `${status.mcpCount} · ${status.mcpTools} tools` : '…'}</Link>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-ink-2"><Sparkles className="w-3.5 h-3.5 text-ink-3" /> Skills</span>
              <Link href="/settings?tab=skills" className="text-[11px] text-ink-2 hover:text-brand-soft">{status ? `${status.skills} active` : '…'}</Link>
            </div>
          </section>

          <section className="p-4 space-y-2.5">
            <h3 className="text-[10px] font-bold text-ink-2">Scheduled</h3>
            {jobs.length === 0 && <p className="text-[11px] text-ink-3">Nothing scheduled. Ask Co-Work to schedule an email or a recurring task.</p>}
            {jobs.map((j) => (
              <div key={j.id} className="rounded-xl border border-line/[0.06] bg-line/[0.02] p-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-ink leading-snug">{j.title}</p>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${j.status === 'scheduled' ? 'bg-emerald-500/10 text-emerald-300' : j.status === 'paused' ? 'bg-zinc-500/20 text-ink-2' : j.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-brand/10 text-brand-soft'}`}>{j.status}</span>
                </div>
                <p className="text-[11px] text-ink-3">{formatWhen(j.runAt)}{j.recurrence ? ` · ${j.recurrence}` : ''}</p>
                {j.lastError && <p className="text-[10px] text-red-300">{j.lastError}</p>}
                <div className="flex gap-1.5 pt-0.5">
                  {j.status === 'scheduled' && (
                    <button onClick={() => jobAction(j.id, 'pause')} className="text-[10px] px-2 py-0.5 rounded-md bg-line/5 hover:bg-line/10 text-ink-2 flex items-center gap-1"><Pause className="w-3 h-3" />Pause</button>
                  )}
                  {(j.status === 'paused' || j.status === 'failed') && (
                    <button onClick={() => jobAction(j.id, 'resume')} className="text-[10px] px-2 py-0.5 rounded-md bg-line/5 hover:bg-line/10 text-ink-2 flex items-center gap-1"><Play className="w-3 h-3" />Resume</button>
                  )}
                  <button onClick={() => jobAction(j.id, 'cancel')} className="text-[10px] px-2 py-0.5 rounded-md bg-line/5 hover:bg-red-500/10 text-ink-2 hover:text-red-300 flex items-center gap-1"><Ban className="w-3 h-3" />Cancel</button>
                </div>
              </div>
            ))}
          </section>
        </aside>
      )}
    </div>
  );
}
