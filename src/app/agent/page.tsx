'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUp,
  Square,
  Plus,
  Cloud,
  Monitor,
  FileCode2,
  FolderOpen,
  ExternalLink,
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  Upload,
  Check,
  Terminal,
  Zap,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { AgentSuggestion } from '@/components/AgentSuggestion';
import { StepList, type ToolStep } from '@/components/agent/StepList';
import { useDialog } from '@/components/ui/dialog';
import { SystemStrip } from '@/components/SystemStrip';
import { QuestionCard, PlanCard } from '@/components/agent/AgentCards';

/**
 * Arcwork Code, Codex / Claude Code style: pick where it works (a cloud project with a real
 * sandbox, or a folder on your computer through the desktop app), describe the task, and
 * the agent writes the files, runs them and shows a live preview. No mode toggles, no
 * "copy this code" replies, no setup questions.
 */

interface Project {
  id: string;
  name: string;
}
interface Device {
  id: string;
  name: string;
  kind: 'desktop' | 'browser';
  online: boolean;
  capabilities: { workspaces?: string[]; localModels?: Array<{ id: string }> };
}
type Workspace = { kind: 'cloud'; project: Project | null } | { kind: 'local'; root: string; device: string };

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: ToolStep[];
  files?: string[];
  commands?: Array<{ command: string; exitCode: number }>;
  preview?: string | null;
  model?: string;
  error?: string;
}

const MODELS = [
  { id: 'auto', label: 'Auto', hint: 'Best available, free first' },
  { id: 'route_gateway_qwen3_coder_free', label: 'Qwen3 Coder', hint: 'Free' },
  { id: 'route_gateway_kimi_k2_free', label: 'Kimi K2', hint: 'Free' },
  { id: 'local', label: 'Local model', hint: 'Runs on your computer' },
];

const workspaceKey = (w: Workspace) => (w.kind === 'local' ? `local:${w.root}` : `cloud:${w.project?.id || 'new'}`);
const runProjectKey = (w: Workspace) => (w.kind === 'local' ? `local:${w.root}` : w.project?.id || null);

interface RunEvent {
  type: string;
  text: string;
}
interface Run {
  id: string;
  agent: string;
  prompt: string;
  projectId: string | null;
  status: string;
  model: string | null;
  events: RunEvent[];
  result: string | null;
  filesChanged: string[];
  error: string | null;
}

/** Rebuilds the step list, files and preview from a run's persisted progress log. */
function digest(run: Run) {
  const steps: ToolStep[] = [];
  const files = new Set<string>();
  let preview: string | null = null;
  let project: string | null = null;
  let plan: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> = [];
  const questions: Array<{ id: string; question: string; options: string[]; answer?: string }> = [];
  const commands: Array<{ command: string; exitCode: number }> = [];
  for (const e of run.events) {
    if (e.type === 'plan') {
      try { plan = JSON.parse(e.text); } catch { /* partial */ }
      continue;
    }
    if (e.type === 'question') {
      try { questions.push(JSON.parse(e.text)); } catch { /* partial */ }
      continue;
    }
    if (e.type === 'answer') {
      try { const a = JSON.parse(e.text); const q = questions.find((x) => x.id === a.id); if (q) q.answer = a.answer; } catch { /* partial */ }
      continue;
    }
    if (e.type === 'step') {
      const space = e.text.indexOf(' ');
      const tool = space === -1 ? e.text : e.text.slice(0, space);
      let args: any = {};
      try {
        args = JSON.parse(e.text.slice(space + 1));
      } catch {
        args = {};
      }
      steps.push({ step: steps.length + 1, tool, args });
    } else if ((e.type === 'result' || e.type === 'error') && steps.length) {
      const last = steps[steps.length - 1];
      if (last.observation === undefined) {
        last.observation = e.text;
        last.isError = e.type === 'error';
        const m = e.text.match(/^\$ (.+)\nexit code: (\d+)/);
        if (m) commands.push({ command: m[1], exitCode: Number(m[2]) });
      }
    } else if (e.type === 'file') files.add(e.text);
    else if (e.type === 'preview') preview = e.text;
    else if (e.type === 'project') project = e.text;
  }
  return { steps, files: Array.from(files), preview, project, commands, plan, questions };
}

function runToTurns(run: Run): Turn[] {
  const d = digest(run);
  const done = ['done', 'no_changes', 'stalled', 'error', 'cancelled'].includes(run.status);
  return [
    { id: `${run.id}-u`, role: 'user', content: run.prompt },
    ...(done
      ? [{ id: `${run.id}-a`, role: 'assistant' as const, content: run.status === 'cancelled' ? (run.result || 'Stopped. Here is what it did before you stopped it.') : (run.result || ''), steps: d.steps, files: run.filesChanged.length ? run.filesChanged : d.files, commands: d.commands, preview: d.preview, model: run.model || undefined, error: run.error || undefined }]
      : []),
  ];
}

export default function CodePage() {
  const dialog = useDialog();
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>({ kind: 'cloud', project: null });
  const [threads, setThreads] = useState<Record<string, Turn[]>>({});
  const [files, setFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('auto');
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autorun, setAutorun] = useState(false);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState<{ text: string; steps: ToolStep[]; preview: string | null; backend: string | null; model: string | null; plan?: any[]; questions?: any[] }>({ text: '', steps: [], preview: null, backend: null, model: null });
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const desktop = devices.find((d) => d.kind === 'desktop' && d.online);
  const localFolders = desktop?.capabilities.workspaces || [];
  const turns = threads[workspaceKey(workspace)] || [];

  const loadProjects = useCallback(async () => {
    const r = await fetch('/api/v1/projects').then((res) => (res.ok ? res.json() : { projects: [] })).catch(() => ({ projects: [] }));
    setProjects(r.projects || []);
    return (r.projects || []) as Project[];
  }, []);

  const loadFiles = useCallback(async (projectId: string) => {
    const r = await fetch(`/api/v1/projects/${projectId}/files`).then((res) => (res.ok ? res.json() : { files: [] })).catch(() => ({ files: [] }));
    setFiles(r.files || []);
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadProjects();
      const q = new URLSearchParams(window.location.search);
      const pid = q.get('project');
      const pre = q.get('prompt');
      if (pre) setPrompt(pre);
      if (pre && q.get('autorun') === '1') setAutorun(true);
      // A request routed from Chat starts a fresh cloud project instead of reusing the last one.
      const chosen = (pid && list.find((p) => p.id === pid)) || (q.get('autorun') === '1' ? null : list[0]) || null;
      setWorkspace({ kind: 'cloud', project: chosen });
      setReady(true);
      if (q.get('autorun')) window.history.replaceState(null, '', '/agent');
    })();
    const loadDevices = () =>
      fetch('/api/v1/bridge/devices').then((r) => (r.ok ? r.json() : { devices: [] })).then((d) => setDevices(d.devices || [])).catch(() => {});
    loadDevices();
    const t = setInterval(loadDevices, 20000);
    return () => clearInterval(t);
  }, [loadProjects]);

  useEffect(() => {
    setOpenFile(null);
    if (workspace.kind === 'cloud' && workspace.project) loadFiles(workspace.project.id);
    else setFiles([]);
  }, [workspace, loadFiles]);

  useEffect(() => {
    if (autorun && ready && prompt.trim() && !busy) {
      setAutorun(false);
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, ready, prompt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, live.text, live.steps.length]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [prompt]);

  async function newCloudProject() {
    const name = await dialog.prompt({ title: 'New cloud project', body: 'Files live in Arcwork and run in a private cloud sandbox.', placeholder: 'e.g. Gruve landing page', confirmLabel: 'Create' });
    if (!name?.trim()) return;
    const r = await fetch('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }).then((res) => res.json());
    if (r.project) {
      await loadProjects();
      setWorkspace({ kind: 'cloud', project: r.project });
    }
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || workspace.kind !== 'cloud' || !workspace.project) return;
    const payload: Array<{ path: string; content: string }> = [];
    for (const f of Array.from(list)) {
      if (f.size > 256 * 1024) continue;
      payload.push({ path: (f as any).webkitRelativePath || f.name, content: await f.text() });
    }
    if (!payload.length) return;
    await fetch(`/api/v1/projects/${workspace.project.id}/files/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: payload }) });
    loadFiles(workspace.project.id);
  }

  const loadThread = useCallback(async (w: Workspace) => {
    const key = runProjectKey(w);
    if (!key) return;
    const r = await fetch('/api/v1/runs').then((res) => (res.ok ? res.json() : { runs: [] })).catch(() => ({ runs: [] }));
    const runs: Run[] = (r.runs || []).filter((x: Run) => x.agent === 'code' && x.projectId === key).reverse();
    setThreads((prev) => ({ ...prev, [workspaceKey(w)]: runs.flatMap(runToTurns) }));
    const running = runs.find((x) => x.status === 'queued' || x.status === 'running' || x.status === 'paused');
    if (running && !busy) follow(running.id, w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) loadThread(workspace);
  }, [workspace, ready, loadThread]);

  function follow(runId: string, w: Workspace) {
    runIdRef.current = runId;
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const tick = async () => {
      if (controller.signal.aborted) return;
      const r = await fetch(`/api/v1/runs/${runId}`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
      const run: Run | undefined = r?.run;
      if (run) {
        const d = digest(run);
        setLive({ text: '', steps: d.steps, preview: d.preview, backend: null, model: run.model, plan: d.plan, questions: d.questions });
        if (['done', 'no_changes', 'stalled', 'error', 'cancelled'].includes(run.status)) {
          setBusy(false);
          abortRef.current = null;
          let target = w;
          if (d.project && w.kind === 'cloud' && !w.project) {
            const list = await loadProjects();
            const p = list.find((x) => x.id === d.project);
            if (p) target = { kind: 'cloud', project: p };
          }
          if (target !== w) setWorkspace(target);
          else loadThread(target);
          if (target.kind === 'cloud' && target.project) loadFiles(target.project.id);
          return;
        }
      }
      setTimeout(tick, 1500);
    };
    tick();
  }

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    const key = workspaceKey(workspace);
    const history = turns.filter((t) => t.content).slice(-10).map((t) => ({ role: t.role, content: t.content.slice(0, 6000) }));
    setPrompt('');
    setThreads((prev) => ({ ...prev, [key]: [...(prev[key] || []), { id: crypto.randomUUID(), role: 'user', content: text }] }));
    setLive({ text: '', steps: [], preview: null, backend: null, model: null });
    const res = await fetch('/api/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'code',
        prompt: text,
        history,
        pinnedModel: model === 'auto' ? undefined : model,
        ...(workspace.kind === 'local' ? { localRoot: workspace.root } : { projectId: workspace.project?.id }),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.run) {
      setThreads((prev) => ({ ...prev, [key]: [...(prev[key] || []), { id: crypto.randomUUID(), role: 'assistant', content: '', error: data.error || 'Could not start the task.' }] }));
      return;
    }
    follow(data.run.id, workspace);
  }

  async function stop() {
    // Cancel the run on the server (the runner watches for it), then show what it did so far.
    const id = runIdRef.current;
    if (id) await fetch(`/api/v1/runs/${id}`, { method: 'DELETE' }).catch(() => {});
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    // A run that created its project mid-flight belongs to a project this page isn't showing yet: switch to it.
    const run: Run | undefined = id ? await fetch(`/api/v1/runs/${id}`).then((res) => (res.ok ? res.json() : null)).then((r) => r?.run).catch(() => undefined) : undefined;
    const project = run ? digest(run).project : null;
    if (project && workspace.kind === 'cloud' && !workspace.project) {
      const list = await loadProjects();
      const p = list.find((x) => x.id === project);
      if (p) {
        setWorkspace({ kind: 'cloud', project: p });
        loadFiles(p.id);
        return;
      }
    }
    loadThread(workspace);
  }

  const where = workspace.kind === 'local' ? `${workspace.root.split('/').pop()} · ${workspace.device}` : workspace.project?.name || 'New cloud project';
  const fileTree = useMemo(() => files.map((f) => f.path).sort(), [files]);
  const latestPreview = live.preview || [...turns].reverse().find((t) => t.preview)?.preview || null;

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-canvas text-ink">
      {/* Sidebar */}
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-line/[0.06] bg-sidebar md:flex">
        <div className="p-3">
          <button onClick={() => { const next = workspace.kind === 'cloud' ? ({ kind: 'cloud', project: null } as typeof workspace) : workspace; setWorkspace(next); setThreads((p) => ({ ...p, [workspaceKey(next)]: [] })); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface-2">
            <Plus className="h-4 w-4 text-brand" /> New task
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-ink-3">On your computer</p>
          {desktop ? (
            localFolders.length ? (
              localFolders.map((root) => {
                const active = workspace.kind === 'local' && workspace.root === root;
                return (
                  <button key={root} onClick={() => setWorkspace({ kind: 'local', root, device: desktop.name })} className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] ${active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2/60 hover:text-ink'}`} title={root}>
                    <Monitor className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{root.split('/').pop()}</span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-1 text-[12px] text-ink-3">Add a folder in the desktop app.</p>
            )
          ) : (
            <Link href="/connections#devices" className="mx-1 mt-1 block rounded-xl border border-dashed border-line/10 px-3 py-2 text-[12px] text-ink-3 hover:border-brand/30 hover:text-ink-2">
              Connect the desktop app to work in your own folders and run locally.
            </Link>
          )}

          <div className="flex items-center justify-between px-3 pb-1 pt-4">
            <p className="text-[11px] font-medium text-ink-3">Cloud projects</p>
            <button onClick={newCloudProject} className="rounded-md p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="New cloud project">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {projects.length === 0 && <p className="px-3 py-1 text-[12px] text-ink-3">Your first task creates one.</p>}
          {projects.map((p) => {
            const active = workspace.kind === 'cloud' && workspace.project?.id === p.id;
            return (
              <button key={p.id} onClick={() => setWorkspace({ kind: 'cloud', project: p })} className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] ${active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2/60 hover:text-ink'}`}>
                <Cloud className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.name}</span>
              </button>
            );
          })}

          {workspace.kind === 'cloud' && fileTree.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-4 text-[11px] font-medium text-ink-3">Files</p>
              {fileTree.map((path) => (
                <button key={path} onClick={() => setOpenFile(files.find((f) => f.path === path) || null)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-1 text-left font-mono text-[12px] ${openFile?.path === path ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:text-ink'}`}>
                  <FileCode2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{path}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/[0.06] px-4">
          {workspace.kind === 'local' ? <Monitor className="h-4 w-4 text-ink-3" /> : <Cloud className="h-4 w-4 text-ink-3" />}
          <span className="hidden truncate text-[13px] font-medium text-ink md:inline">{where}</span>
          {/* Mobile: the sidebar is hidden, so the workspace name opens a picker */}
          <div className="relative md:hidden">
            <button onClick={() => setPickerOpen((v) => !v)} className="flex max-w-[60vw] items-center gap-1 text-[13px] font-medium text-ink">
              <span className="truncate">{where}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            </button>
            {pickerOpen && (
              <div className="absolute left-0 top-8 z-30 w-72 rounded-xl border border-line/10 bg-surface p-1 shadow-2xl animate-shz-in">
                {desktop && localFolders.map((root) => (
                  <button key={root} onClick={() => { setWorkspace({ kind: 'local', root, device: desktop.name }); setPickerOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                    <Monitor className="h-3.5 w-3.5" /> <span className="truncate">{root.split('/').pop()}</span>
                  </button>
                ))}
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { setWorkspace({ kind: 'cloud', project: p }); setPickerOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                    <Cloud className="h-3.5 w-3.5" /> <span className="truncate">{p.name}</span>
                  </button>
                ))}
                <div className="my-1 h-px bg-line/[0.06]" />
                <button onClick={() => { setPickerOpen(false); newCloudProject(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                  <Plus className="h-3.5 w-3.5" /> New cloud project
                </button>
              </div>
            )}
          </div>
          <span className="hidden text-[12px] text-ink-3 sm:inline">{workspace.kind === 'local' ? '· runs on your computer' : '· runs in a private cloud sandbox'}</span>
          {latestPreview && (
            <a href={latestPreview} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1 text-[12px] font-medium text-brand-soft hover:bg-brand/15">
              Preview <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Thread */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
              <div className="mx-auto max-w-3xl space-y-7">
                {turns.length === 0 && !busy && (
                  <div className="shz-atmosphere -mx-8 -mt-8 px-8 pb-6 pt-[13vh] text-center">
                    <p className="shz-mono text-[11px] tracking-[0.2em] text-brand/80">Code</p>
                    <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.025em] text-ink">What should we build?</h1>
                    <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2">
                      Describe it in plain words. Arcwork writes the code {workspace.kind === 'local' ? `in ${workspace.root.split('/').pop()} on your computer` : 'in a cloud project'}, runs it and hands you a live preview.
                    </p>
                    <div className="mt-5"><SystemStrip show={['models', 'sandbox', 'desktop']} /></div>
                  </div>
                )}

                {turns.map((t) =>
                  t.role === 'user' ? (
                    <div key={t.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-4 py-2.5 text-[14px] text-ink">{t.content}</div>
                    </div>
                  ) : (
                    <div key={t.id} className="space-y-3">
                      {t.steps && t.steps.length > 0 && <StepList steps={t.steps.filter((x) => x.tool !== 'todo_write' && x.tool !== 'ask_user')} />}
                      {t.content && <MarkdownRenderer content={t.content} className="text-[14px] text-ink" />}
                      {t.files?.length || t.commands?.length || t.preview ? (
                        <div className="flex flex-wrap gap-1.5">
                          {t.files?.map((f) => (
                            <button key={f} onClick={() => { const file = files.find((x) => x.path === f); if (file) setOpenFile(file); }} className="flex items-center gap-1.5 rounded-lg border border-line/[0.08] bg-surface px-2 py-1 font-mono text-[11px] text-ink-2 hover:text-ink">
                              <FileCode2 className="h-3 w-3" /> {f.split('/').slice(-2).join('/')}
                            </button>
                          ))}
                          {t.commands?.slice(-3).map((c, i) => (
                            <span key={i} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11px] ${c.exitCode === 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                              <Terminal className="h-3 w-3" /> {c.command.slice(0, 40)} {c.exitCode === 0 ? <Check className="h-3 w-3" /> : `· ${c.exitCode}`}
                            </span>
                          ))}
                          {t.preview && (
                            <a href={t.preview} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand-soft">
                              Open preview <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ) : null}
                      {t.model && <p className="text-[11px] text-ink-3">{t.model}</p>}
                      {t.error && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {t.error}
                        </div>
                      )}
                    </div>
                  )
                )}

                {busy && (
                  <div className="space-y-3">
                    <p className="flex items-center gap-2 text-[12px] text-ink-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                      Working {live.backend || ''}
                      {live.model ? ` · ${live.model}` : ''}
                    </p>
                    {live.plan && live.plan.length > 0 && <PlanCard todos={live.plan} />}
                    <StepList steps={live.steps.filter((x) => x.tool !== 'todo_write' && x.tool !== 'ask_user')} live />
                    {live.questions?.map((q) => <QuestionCard key={q.id} id={q.id} question={q.question} options={q.options} answered={q.answer} />)}
                    {live.text && <MarkdownRenderer content={live.text} className="text-[14px] text-ink" />}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>

            {/* Composer */}
            <div className="shrink-0 px-4 pb-4 sm:px-8">
              <div className="mx-auto max-w-3xl">
                {!busy && <AgentSuggestion prompt={prompt} current="code" />}
                <div className="shz-composer">
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder={turns.length ? 'Ask for a change…' : 'Build a landing page for…'}
                    className="w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
                  />
                  <div className="flex items-center gap-1 px-2 pb-2">
                    <div className="relative">
                      <button onClick={() => setPlusOpen((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Add">
                        <Plus className="h-4 w-4" />
                      </button>
                      {plusOpen && (
                        <div className="absolute bottom-10 left-0 z-20 w-64 rounded-xl border border-line/10 bg-surface p-1 shadow-2xl animate-shz-in" onMouseLeave={() => setPlusOpen(false)}>
                          <button disabled={workspace.kind !== 'cloud' || !workspace.project} onClick={() => { setPlusOpen(false); uploadRef.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
                            <Upload className="h-4 w-4" /> Upload files to this project
                          </button>
                          <button onClick={() => { setPlusOpen(false); newCloudProject(); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                            <Cloud className="h-4 w-4" /> New cloud project
                          </button>
                          <Link href="/connections#devices" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                            <FolderOpen className="h-4 w-4" /> Use a folder on my computer
                          </Link>
                        </div>
                      )}
                      <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
                    </div>

                    <div className="relative">
                      <button onClick={() => setModelOpen((v) => !v)} className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                        {MODELS.find((m) => m.id === model)?.label} <ChevronDown className="h-3 w-3" />
                      </button>
                      {modelOpen && (
                        <div className="absolute bottom-10 left-0 z-20 w-56 rounded-xl border border-line/10 bg-surface p-1 shadow-2xl animate-shz-in" onMouseLeave={() => setModelOpen(false)}>
                          {MODELS.filter((m) => m.id !== 'local' || desktop?.capabilities.localModels?.length).map((m) => (
                            <button key={m.id} onClick={() => { setModel(m.id); setModelOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-surface-2">
                              <span>
                                <span className="block text-[13px] text-ink">{m.label}</span>
                                <span className="block text-[11px] text-ink-3">{m.hint}</span>
                              </span>
                              {model === m.id && <Check className="h-3.5 w-3.5 text-brand" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="ml-auto">
                      {busy ? (
                        <button onClick={stop} className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-ink hover:bg-line/10" aria-label="Stop watching" title="Stop watching (the task keeps running in the background)">
                          <Square className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button onClick={send} disabled={!prompt.trim()} className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-ink transition hover:bg-brand-soft disabled:opacity-30" aria-label="Send">
                          <Zap className="h-4 w-4 fill-current" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* File viewer */}
          {openFile && (
            <aside className="hidden w-[46%] max-w-[720px] shrink-0 flex-col border-l border-line/[0.06] bg-sidebar lg:flex">
              <div className="flex h-10 items-center gap-2 border-b border-line/[0.06] px-3">
                <FileCode2 className="h-3.5 w-3.5 text-ink-3" />
                <span className="truncate font-mono text-[12px] text-ink-2">{openFile.path}</span>
                <button onClick={() => setOpenFile(null)} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close file">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-[1.6] text-ink-2">
                {openFile.content.split('\n').map((line, i) => (
                  <div key={i} className="flex">
                    <span className="w-10 shrink-0 select-none pr-3 text-right text-ink-3/60">{i + 1}</span>
                    <span className="whitespace-pre">{line}</span>
                  </div>
                ))}
              </pre>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
