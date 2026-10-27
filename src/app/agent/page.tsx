'use client';

import { useState, useEffect } from 'react';
import {
  Code2,
  FileCode,
  FolderTree,
  Plus,
  Trash2,
  Check,
  X,
  History,
  Save,
  AlertCircle,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';

interface WorkspaceFile {
  path: string;
  content: string;
  updatedAt: string;
}

interface Proposal {
  id: string;
  instruction: string;
  summary: string;
  status: 'pending' | 'applied' | 'rejected';
  changes: Array<{ path: string; action: 'create' | 'update' | 'delete'; diff?: string; content?: string }>;
  createdAt: string;
}

interface Checkpoint {
  id: string;
  description: string;
  createdAt: string;
}

export default function AgentPage() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);
  const [checkpointDesc, setCheckpointDesc] = useState('');

  async function loadWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const [filesRes, proposalsRes, checkpointsRes] = await Promise.all([
        fetch('/api/v1/workspace/files'),
        fetch('/api/v1/workspace/proposals'),
        fetch('/api/v1/workspace/checkpoints'),
      ]);

      if (filesRes.status === 401) {
        setError('Please sign in to access your isolated coding workspace.');
        setLoading(false);
        return;
      }

      const filesData = await filesRes.json();
      const proposalsData = await proposalsRes.json();
      const checkpointsData = await checkpointsRes.json();

      setFiles(filesData.files || []);
      setProposals(proposalsData.proposals || []);
      setCheckpoints(checkpointsData.checkpoints || []);

      if (filesData.files?.length > 0 && !selectedFile) {
        setSelectedFile(filesData.files[0]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  async function handleCreateFile(e: React.FormEvent) {
    e.preventDefault();
    if (!newFilePath) return;

    try {
      const res = await fetch('/api/v1/workspace/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newFilePath, content: newFileContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create file');

      setNewFilePath('');
      setNewFileContent('');
      setCreatingFile(false);
      await loadWorkspace();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteFile(path: string) {
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await fetch(`/api/v1/workspace/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      if (selectedFile?.path === path) setSelectedFile(null);
      await loadWorkspace();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDecideProposal(id: string, decision: 'applied' | 'rejected') {
    try {
      const res = await fetch(`/api/v1/workspace/proposals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to decide proposal');
      await loadWorkspace();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreateCheckpoint(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/workspace/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: checkpointDesc || 'Manual snapshot' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create checkpoint');
      setCheckpointDesc('');
      await loadWorkspace();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRestoreCheckpoint(id: string) {
    if (!confirm('Restoring this checkpoint will overwrite all current files. Continue?')) return;
    try {
      const res = await fetch(`/api/v1/workspace/checkpoints/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to restore checkpoint');
      await loadWorkspace();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#232736] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono">Coding Agent Workspace</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
              D1 Tenant Isolated
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Safe file proposals, unified diff inspection, and atomic checkpoints without arbitrary host execution.
          </p>
        </div>

        {/* Safety Container Banner */}
        <div className="p-2.5 rounded-lg bg-[#141824] border border-[#232736] flex items-center gap-2 text-xs text-zinc-400">
          <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
          <span>Running code needs an isolated container, not available in this deployment</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: File Tree & Checkpoints */}
        <div className="lg:col-span-1 space-y-6">
          {/* Files Panel */}
          <div className="bg-[#10131d] border border-[#232736] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#1e2333]">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5" /> Workspace Files ({files.length})
              </span>
              <button
                onClick={() => setCreatingFile(!creatingFile)}
                className="p-1 rounded bg-[#1e2333] hover:bg-zinc-700 text-zinc-300 transition"
                title="New file"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {creatingFile && (
              <form onSubmit={handleCreateFile} className="space-y-2 p-2 bg-[#151926] rounded-lg border border-[#232736]">
                <input
                  type="text"
                  placeholder="src/index.ts"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  className="w-full px-2 py-1 bg-[#090b10] border border-[#232736] rounded text-xs text-zinc-200 font-mono"
                  required
                />
                <textarea
                  placeholder="File content..."
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full px-2 py-1 bg-[#090b10] border border-[#232736] rounded text-xs text-zinc-200 font-mono h-20"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCreatingFile(false)}
                    className="px-2 py-1 text-[10px] text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-[10px] bg-amber-500 text-zinc-950 font-semibold rounded"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            {files.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-xs">No files yet. Add one above.</div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {files.map((file) => (
                  <div
                    key={file.path}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                      selectedFile?.path === file.path
                        ? 'bg-[#1e2436] text-amber-400 font-semibold'
                        : 'text-zinc-300 hover:bg-[#151926]'
                    }`}
                    onClick={() => setSelectedFile(file)}
                  >
                    <span className="truncate flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 shrink-0" />
                      {file.path}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.path);
                      }}
                      className="text-zinc-500 hover:text-red-400 p-1"
                      title="Delete file"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Checkpoints Panel */}
          <div className="bg-[#10131d] border border-[#232736] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#1e2333]">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Checkpoints
              </span>
            </div>

            <form onSubmit={handleCreateCheckpoint} className="flex gap-1.5">
              <input
                type="text"
                placeholder="Checkpoint label..."
                value={checkpointDesc}
                onChange={(e) => setCheckpointDesc(e.target.value)}
                className="flex-1 px-2 py-1 bg-[#090b10] border border-[#232736] rounded text-xs text-zinc-200"
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-[#1e2333] hover:bg-zinc-700 text-zinc-200 text-xs rounded font-medium"
              >
                Snapshot
              </button>
            </form>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {checkpoints.length === 0 ? (
                <div className="text-center py-4 text-zinc-500 text-xs">No snapshots saved.</div>
              ) : (
                checkpoints.map((cp) => (
                  <div
                    key={cp.id}
                    className="p-2 rounded bg-[#141824] border border-[#202538] flex items-center justify-between text-xs"
                  >
                    <div className="truncate">
                      <p className="font-semibold text-zinc-200 truncate">{cp.description}</p>
                      <p className="text-[10px] text-zinc-500">{new Date(cp.createdAt).toLocaleTimeString()}</p>
                    </div>
                    <button
                      onClick={() => handleRestoreCheckpoint(cp.id)}
                      title="Restore snapshot"
                      className="p-1 rounded text-zinc-400 hover:text-amber-400 hover:bg-[#1e2333]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center: File Viewer */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-[#10131d] border border-[#232736] rounded-xl overflow-hidden flex flex-col h-[400px]">
            <div className="px-4 py-2.5 bg-[#141824] border-b border-[#232736] flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-300 font-semibold flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-500" />
                {selectedFile ? selectedFile.path : 'No file selected'}
              </span>
              {selectedFile && (
                <span className="text-[10px] text-zinc-500">
                  Updated {new Date(selectedFile.updatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex-1 p-4 font-mono text-xs overflow-auto bg-[#0a0d14] text-zinc-200 whitespace-pre">
              {selectedFile ? selectedFile.content : '// Select or create a file from the left sidebar'}
            </div>
          </div>

          {/* Bottom: Proposals Review */}
          <div className="bg-[#10131d] border border-[#232736] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold font-mono text-white flex items-center gap-2">
              <Code2 className="w-4 h-4 text-amber-500" /> Pending Model Proposals ({proposals.filter(p => p.status === 'pending').length})
            </h2>

            {proposals.filter((p) => p.status === 'pending').length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-xs border border-dashed border-[#232736] rounded-lg">
                No pending proposals. Ask a coding task in the Workspace to propose file modifications.
              </div>
            ) : (
              proposals
                .filter((p) => p.status === 'pending')
                .map((proposal) => (
                  <div key={proposal.id} className="p-4 rounded-lg bg-[#141824] border border-[#232736] space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-zinc-100">{proposal.summary}</h4>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{proposal.instruction}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDecideProposal(proposal.id, 'applied')}
                          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1 shadow-sm transition"
                        >
                          <Check className="w-3.5 h-3.5" /> Apply
                        </button>
                        <button
                          onClick={() => handleDecideProposal(proposal.id, 'rejected')}
                          className="px-3 py-1.5 rounded-md bg-red-950 border border-red-800 text-red-300 hover:bg-red-900 font-semibold text-xs flex items-center gap-1 transition"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </div>

                    {/* Diff Viewer */}
                    <div className="space-y-2">
                      {proposal.changes.map((change, idx) => (
                        <div key={idx} className="rounded border border-[#1e2333] overflow-hidden">
                          <div className="px-3 py-1 bg-[#181d2c] text-[11px] font-mono font-semibold text-zinc-300 flex items-center justify-between">
                            <span>{change.action.toUpperCase()}: {change.path}</span>
                          </div>
                          {change.diff && (
                            <pre className="p-3 bg-[#0a0d14] text-[11px] font-mono overflow-x-auto text-zinc-300 whitespace-pre">
                              {change.diff}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
