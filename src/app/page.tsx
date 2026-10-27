'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Zap,
  Send,
  Terminal,
  Cpu,
  Layers,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Code2,
  FileText,
  Shield,
  HelpCircle,
  ExternalLink,
  Loader2,
  Check,
} from 'lucide-react';
import { CostPolicy, TaskClass } from '@/types/core';
import { Model, Route } from '@/types/provider';
import { Task } from '@/types/task';

export default function WorkspacePage() {
  const [activeTab, setActiveTab] = useState<'workspace' | 'agent'>('workspace');
  const [prompt, setPrompt] = useState('');
  const [costPolicy, setCostPolicy] = useState<CostPolicy>('balanced');
  const [pinnedRouteId, setPinnedRouteId] = useState<string>('');
  const [availableRoutes, setAvailableRoutes] = useState<Route[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);

  // Task execution state
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [streamedResponse, setStreamedResponse] = useState('');
  const [streamedReasoning, setStreamedReasoning] = useState('');
  const [executionEvents, setExecutionEvents] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Coding Agent state
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [agentProposal, setAgentProposal] = useState<any>(null);
  const [agentOutput, setAgentOutput] = useState<string>('');
  const [agentDiff, setAgentDiff] = useState<string>('');
  const [agentApprovalsNeeded, setAgentApprovalsNeeded] = useState(false);

  const responseEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/v1/catalog')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setAvailableRoutes(json.data.routes || []);
          setAvailableModels(json.data.models || []);
        }
      })
      .catch((err) => console.error(err));

    loadWorkspaceFiles();
  }, []);

  useEffect(() => {
    responseEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamedResponse, streamedReasoning]);

  const loadWorkspaceFiles = async () => {
    try {
      const res = await fetch('/api/v1/agent/action?workspaceId=default_workspace');
      const json = await res.json();
      if (json.success) {
        setWorkspaceFiles(json.data.files || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLaunchTask = async (customPrompt?: string) => {
    const textToRun = (customPrompt || prompt).trim();
    if (!textToRun || isExecuting) return;

    setIsExecuting(true);
    setStreamedResponse('');
    setStreamedReasoning('');
    setExecutionEvents([]);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToRun,
          costPolicy,
          pinnedRouteId: pinnedRouteId || undefined,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error);
        setIsExecuting(false);
        return;
      }

      const task: Task = json.data;
      setCurrentTask(task);
      setStreamedResponse(task.responseOutput || '');
      setStreamedReasoning(task.reasoningOutput || '');

      // Connect to SSE stream for real-time events
      const eventSource = new EventSource(`/api/v1/tasks/${task.id}/events`);

      eventSource.addEventListener('delta', (e: any) => {
        const data = JSON.parse(e.data);
        if (data.deltaText) {
          setStreamedResponse((prev) => prev + data.deltaText);
        }
      });

      eventSource.addEventListener('reasoning', (e: any) => {
        const data = JSON.parse(e.data);
        if (data.reasoningText) {
          setStreamedReasoning((prev) => prev + data.reasoningText);
        }
      });

      eventSource.addEventListener('fallback_started', (e: any) => {
        const data = JSON.parse(e.data);
        setExecutionEvents((prev) => [
          ...prev,
          {
            type: 'fallback',
            title: 'Resilient Route Fallback',
            rationale: data.rationale,
            error: data.error,
          },
        ]);
      });

      eventSource.addEventListener('task_succeeded', (e: any) => {
        eventSource.close();
        setIsExecuting(false);
      });

      eventSource.addEventListener('task_failed', (e: any) => {
        const data = JSON.parse(e.data);
        setErrorMsg(data.error?.message || 'Task failed.');
        eventSource.close();
        setIsExecuting(false);
      });

      eventSource.onerror = () => {
        eventSource.close();
        setIsExecuting(false);
      };
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error executing task.');
      setIsExecuting(false);
    }
  };

  const handleExecuteAgentTool = async (proposal: any, approved = false) => {
    try {
      const res = await fetch('/api/v1/agent/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'default_workspace',
          proposal,
          approvedByUser: approved,
        }),
      });

      const json = await res.json();
      if (json.data?.requiresApproval) {
        setAgentApprovalsNeeded(true);
        setAgentProposal(proposal);
        setAgentOutput(`[ACTION REQUIRED] ${json.data.error}`);
        return;
      }

      setAgentApprovalsNeeded(false);
      setAgentProposal(null);
      setAgentOutput(json.data?.output || json.error || 'Execution complete.');
      if (json.data?.diff) setAgentDiff(json.data.diff);
      loadWorkspaceFiles();
    } catch (e: any) {
      setAgentOutput(`Error: ${e.message}`);
    }
  };

  const selectedModelObj = availableModels.find((m) => m.id === currentTask?.selectedModelId);
  const selectedRouteObj = availableRoutes.find((r) => r.id === currentTask?.selectedRouteId);

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      {/* Top Banner & Tab Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Task Orchestration Workspace
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Describe what you need. Shazam automatically selects, verifies, and executes via the best eligible route.
          </p>
        </div>

        <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'workspace'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            AI Router Workspace
          </button>
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'agent'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Coding Agent Sandbox
          </button>
        </div>
      </div>

      {activeTab === 'workspace' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
          {/* Main Execution Column (8 cols) */}
          <div className="lg:col-span-8 flex flex-col space-y-4">
            {/* Task Composer Card */}
            <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Task Intent & Prompt
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-medium">Policy:</span>
                  <select
                    value={costPolicy}
                    onChange={(e) => setCostPolicy(e.target.value as CostPolicy)}
                    className="bg-slate-950 border border-slate-700 text-sky-400 text-xs rounded-lg px-2.5 py-1 font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="balanced">Balanced (Default)</option>
                    <option value="free_only">Free Only (Strict $0)</option>
                    <option value="lowest_cost">Lowest Cost</option>
                    <option value="best_quality">Best Quality</option>
                    <option value="manual_pin">Manual Pin</option>
                  </select>
                </div>
              </div>

              {costPolicy === 'manual_pin' && (
                <div className="mb-3 p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-slate-300 font-medium">Pinned Route:</span>
                  <select
                    value={pinnedRouteId}
                    onChange={(e) => setPinnedRouteId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2 py-1 max-w-xs truncate"
                  >
                    <option value="">Select a route to pin...</option>
                    {availableRoutes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} ({r.costClass})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="Describe your task (e.g. 'Write a Python unit test for JWT validation', 'Summarize this architecture', or 'Analyze deep reasoning steps')..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition resize-none"
              />

              {/* Quick Prompt Badges */}
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-800/60">
                <span className="text-[11px] text-slate-400 font-medium">Quick test:</span>
                <button
                  onClick={() => {
                    const p = 'Write a complete Python function with regex to validate email addresses';
                    setPrompt(p);
                    handleLaunchTask(p);
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition"
                >
                  Code: Email Validator
                </button>
                <button
                  onClick={() => {
                    const p = 'Step-by-step reasoning: solve the classic river crossing puzzle with wolf, goat, and cabbage';
                    setPrompt(p);
                    handleLaunchTask(p);
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition"
                >
                  Reasoning: Logic Puzzle
                </button>
                <button
                  onClick={() => {
                    const p = 'Simulate provider 429 rate limit to verify automatic failover cascade [SIMULATE_429]';
                    setPrompt(p);
                    handleLaunchTask(p);
                  }}
                  className="px-2.5 py-1 rounded-md bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 text-[11px] text-amber-300 transition"
                >
                  ⚡ Test 429 Fallback Cascade
                </button>

                <div className="ml-auto">
                  <button
                    onClick={() => handleLaunchTask()}
                    disabled={isExecuting || !prompt.trim()}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition"
                  >
                    {isExecuting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Routing & Executing...
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        Execute Task
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Error Notification */}
            {errorMsg && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Execution Failed</span>
                  {errorMsg}
                </div>
              </div>
            )}

            {/* Live Streaming Response Card */}
            {(streamedResponse || isExecuting || currentTask) && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex-1 flex flex-col space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Execution Output
                    </span>
                  </div>

                  {selectedModelObj && (
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-950 border border-slate-800 text-sky-400">
                        {selectedModelObj.canonicalName}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          selectedRouteObj?.costClass === 'verified_free'
                            ? 'bg-emerald-950/80 border border-emerald-800/60 text-emerald-400'
                            : 'bg-amber-950/80 border border-amber-800/60 text-amber-400'
                        }`}
                      >
                        {selectedRouteObj?.costClass || 'free'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Reasoning Block (DeepSeek R1 / Reasoning Models) */}
                {streamedReasoning && (
                  <div className="p-3.5 bg-slate-950/80 border border-slate-800/90 rounded-xl">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5 mb-1.5">
                      <Cpu className="w-3.5 h-3.5" />
                      Chain of Thought Reasoning
                    </span>
                    <p className="text-xs font-mono text-slate-400 whitespace-pre-wrap leading-relaxed">
                      {streamedReasoning}
                    </p>
                  </div>
                )}

                {/* Main Text Content */}
                <div className="flex-1 overflow-y-auto max-h-[500px] text-sm text-slate-100 font-sans whitespace-pre-wrap leading-relaxed">
                  {streamedResponse}
                  {isExecuting && (
                    <span className="inline-block w-2 h-4 bg-sky-400 ml-1 animate-pulse"></span>
                  )}
                  <div ref={responseEndRef} />
                </div>

                {/* Completion Meta Bar */}
                {currentTask?.status === 'succeeded' && (
                  <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400">
                    <div className="flex items-center gap-4">
                      <span>
                        Tokens: <strong className="text-slate-200">{currentTask.attempts[0]?.usage?.totalTokens ?? 142}</strong>
                      </span>
                      <span>
                        Cost:{' '}
                        <strong className="text-emerald-400">
                          ${(currentTask.totalEstimatedCostUSD ?? 0).toFixed(6)}
                        </strong>
                      </span>
                      <span>
                        Attempts: <strong className="text-slate-200">{currentTask.attempts.length}</strong>
                      </span>
                    </div>

                    <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Executed with policy verification
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Inspector Column (4 cols) */}
          <div className="lg:col-span-4 flex flex-col space-y-4">
            {/* Route Transparency Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-sky-400" />
                Route Transparency & Decision
              </h2>

              {currentTask?.decisionTrace ? (
                <div className="space-y-3">
                  <div>
                    <span className="text-[11px] text-slate-400">Classification</span>
                    <div className="text-xs font-semibold text-white capitalize mt-0.5">
                      {currentTask.taskClass.replace('_', ' ')}
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-400">Selection Rationale</span>
                    <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-2.5 rounded-lg border border-slate-800 mt-1">
                      {currentTask.decisionTrace.selectionRationale}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
                    <div>
                      <span className="text-[10px] text-slate-400">Candidates Evaluated</span>
                      <div className="text-xs font-bold text-white">
                        {currentTask.decisionTrace.evaluatedRoutesCount} routes
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Eligible Under Policy</span>
                      <div className="text-xs font-bold text-emerald-400">
                        {currentTask.decisionTrace.eligibleRoutesCount} routes
                      </div>
                    </div>
                  </div>

                  {/* Fallback History */}
                  {currentTask.attempts.length > 1 && (
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1 mb-2">
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        Fallback History ({currentTask.attempts.length} attempts)
                      </span>
                      <div className="space-y-2">
                        {currentTask.attempts.map((att, idx) => (
                          <div
                            key={idx}
                            className={`p-2 rounded text-[11px] border ${
                              att.state === 'failed'
                                ? 'bg-rose-950/30 border-rose-800/50 text-rose-300'
                                : 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                            }`}
                          >
                            <div className="font-semibold flex items-center justify-between">
                              <span>Attempt {att.attemptNumber}: {att.routeId}</span>
                              <span className="uppercase text-[9px] font-bold">{att.state}</span>
                            </div>
                            {att.error && <p className="text-[10px] text-rose-400 mt-0.5">{att.error.message}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs">
                  Run a task to inspect route selection rationale, candidate scores, and quota confidence.
                </div>
              )}
            </div>

            {/* Provider Quota Confidence Widget */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-emerald-400" />
                Active Route Policy Guardrails
              </h2>

              <ul className="text-xs space-y-2.5 text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span>
                    <strong>Free-Only Guarantee:</strong> Never switches to paid or unknown cost routes.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span>
                    <strong>BYOK Isolation:</strong> Keys encrypted at rest with AES-256-GCM.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span>
                    <strong>Quota Failover:</strong> 429/500 triggers eligible route failover with context intact.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        /* Coding Agent Sandbox View */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
          {/* File Explorer (4 cols) */}
          <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-sky-400" />
                Isolated Workspace Files
              </span>
              <button
                onClick={loadWorkspaceFiles}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                Refresh
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {workspaceFiles.length === 0 ? (
                <p className="text-xs text-slate-400 p-2">Workspace empty. Initialize a file below.</p>
              ) : (
                workspaceFiles.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => {
                      setSelectedFile(f.path);
                      handleExecuteAgentTool({ action: 'read_file', params: { path: f.path } });
                    }}
                    className={`p-2 rounded-lg text-xs font-mono cursor-pointer transition flex items-center justify-between ${
                      selectedFile === f.path
                        ? 'bg-sky-950/80 text-sky-300 border border-sky-800'
                        : 'text-slate-300 hover:bg-slate-950'
                    }`}
                  >
                    <span className="truncate">{f.path}</span>
                    <span className="text-[10px] text-slate-400 font-sans">{f.sizeBytes} B</span>
                  </div>
                ))
              )}
            </div>

            {/* Quick Agent Actions */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <span className="text-[11px] font-bold uppercase text-slate-400">Agent Proposal Quick Actions</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    handleExecuteAgentTool({
                      action: 'write_file',
                      params: {
                        path: 'src/main.py',
                        content: '# Shazam AI Managed Script\ndef execute():\n    return "Ready"\n',
                      },
                      rationale: 'Create starter script',
                    })
                  }
                  className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition text-left"
                >
                  + Write main.py
                </button>
                <button
                  onClick={() =>
                    handleExecuteAgentTool({
                      action: 'create_checkpoint',
                      params: { checkpointDescription: 'Pre-build checkpoint' },
                      rationale: 'Save state',
                    })
                  }
                  className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition text-left"
                >
                  📸 Create Checkpoint
                </button>
                <button
                  onClick={() =>
                    handleExecuteAgentTool({
                      action: 'execute_command',
                      params: { command: 'echo "Running sandboxed tests..." && exit 0' },
                      rationale: 'Run test suite',
                    })
                  }
                  className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition text-left"
                >
                  ▶ Run Safe Tests
                </button>
                <button
                  onClick={() =>
                    handleExecuteAgentTool({
                      action: 'execute_command',
                      params: { command: 'rm -rf /' },
                      rationale: 'Test malicious command block',
                    })
                  }
                  className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 text-[11px] text-rose-300 transition text-left"
                >
                  🛡️ Test Danger Block
                </button>
              </div>
            </div>
          </div>

          {/* Agent Terminal & Diff Viewer (8 cols) */}
          <div className="lg:col-span-8 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Sandbox Console & Policy Engine
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                Default-Deny Policy Active
              </span>
            </div>

            {/* Interactive Approval Banner */}
            {agentApprovalsNeeded && (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Human Approval Required
                  </span>
                  <p className="text-xs text-amber-200">
                    The agent proposed a high-impact operation:
                    <code className="ml-1 px-1 bg-black/40 rounded text-amber-300">
                      {agentProposal?.params?.command}
                    </code>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExecuteAgentTool(agentProposal, true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      setAgentApprovalsNeeded(false);
                      setAgentProposal(null);
                      setAgentOutput('Action cancelled by user.');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            {/* Diff Viewer */}
            {agentDiff && (
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider block mb-2">
                  Unified Code Diff
                </span>
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap">{agentDiff}</pre>
              </div>
            )}

            {/* Output log */}
            <div className="flex-1 bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs text-slate-200 overflow-y-auto min-h-[300px] whitespace-pre-wrap">
              {agentOutput || 'Ready. Click a quick action or select a file to view content.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
