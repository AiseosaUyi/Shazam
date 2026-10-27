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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.07] pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">Coding Studio</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tracking-wide uppercase">
              Isolated Workspace
            </span>
          </div>
          <p className="text-sm text-zinc-400">
            Safe multi-file code proposals, visual unified diff reviews, and instant rollback snapshots.
          </p>
        </div>

        {/* Safety Container Banner */}
        <div className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2 text-xs text-zinc-400">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Non-destructive diff sandbox active</span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-950/30 border border-red-500/20 text-red-300 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: File Tree & Checkpoints */}
        <div className="lg:col-span-1 space-y-6">
          {/* Files Panel */}
          <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-amber-400" /> Files ({files.length})
              </span>
              <button
                onClick={() => setCreatingFile(!creatingFile)}
                className="p-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition"
                title="New file"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {creatingFile && (
              <form onSubmit={handleCreateFile} className="space-y-2 p-3 bg-black/40 rounded-xl border border-white/10">
                <input
                  type="text"
                  placeholder="src/index.ts"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white/[0.03] border border-white/10 rounded-lg text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-500/50"
                  required
                />
                <textarea
                  placeholder="File content..."
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white/[0.03] border border-white/10 rounded-lg text-xs text-zinc-200 font-mono h-20 focus:outline-none focus:border-amber-500/50"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreatingFile(false)}
                    className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            {files.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs">No files yet. Add one above.</div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {files.map((file) => (
                  <div
                    key={file.path}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono transition cursor-pointer ${
                      selectedFile?.path === file.path
                        ? 'bg-amber-500/10 text-amber-300 font-semibold border border-amber-500/20'
                        : 'text-zinc-300 hover:bg-white/[0.04] border border-transparent'
                    }`}
                    onClick={() => setSelectedFile(file)}
                  >
                    <span className="truncate flex items-center gap-2">
                      <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      {file.path}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.path);
                      }}
                      className="text-zinc-500 hover:text-red-400 p-1 rounded"
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
          <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-amber-400" /> Snapshots
              </span>
            </div>

            <form onSubmit={handleCreateCheckpoint} className="flex gap-2">
              <input
                type="text"
                placeholder="Snapshot label..."
                value={checkpointDesc}
                onChange={(e) => setCheckpointDesc(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-white/[0.03] border border-white/10 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs rounded-xl font-medium transition"
              >
                Save
              </button>
            </form>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {checkpoints.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-xs">No snapshots saved.</div>
              ) : (
                checkpoints.map((cp) => (
                  <div
                    key={cp.id}
                    className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between text-xs"
                  >
                    <div className="truncate">
                      <p className="font-medium text-zinc-200 truncate">{cp.description}</p>
                      <p className="text-[10px] text-zinc-500">{new Date(cp.createdAt).toLocaleTimeString()}</p>
                    </div>
                    <button
                      onClick={() => handleRestoreCheckpoint(cp.id)}
                      title="Restore snapshot"
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-400 hover:bg-white/5 transition"
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
          <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl overflow-hidden flex flex-col h-[400px] shadow-sm">
            <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-300 font-semibold flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" />
                {selectedFile ? selectedFile.path : 'No file selected'}
              </span>
              {selectedFile && (
                <span className="text-[11px] text-zinc-500">
                  Updated {new Date(selectedFile.updatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex-1 p-4 font-mono text-xs overflow-auto bg-[#0a0d14]/70 text-zinc-200 whitespace-pre leading-relaxed">
              {selectedFile ? selectedFile.content : '// Select or create a file from the left sidebar'}
            </div>
          </div>

          {/* Bottom: Proposals Review */}
          <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-5 space-y-4 shadow-sm">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Code2 className="w-4 h-4 text-amber-400" /> Pending Code Proposals ({proposals.filter(p => p.status === 'pending').length})
            </h2>

            {proposals.filter((p) => p.status === 'pending').length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs border border-dashed border-white/10 rounded-2xl">
                No pending proposals. Ask a coding task in the Workspace to propose file modifications.
              </div>
            ) : (
              proposals
                .filter((p) => p.status === 'pending')
                .map((proposal) => (
                  <div key={proposal.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-100">{proposal.summary}</h4>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{proposal.instruction}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDecideProposal(proposal.id, 'applied')}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs flex items-center gap-1.5 shadow-sm transition"
                        >
                          <Check className="w-3.5 h-3.5" /> Apply
                        </button>
                        <button
                          onClick={() => handleDecideProposal(proposal.id, 'rejected')}
                          className="px-3.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 font-semibold text-xs flex items-center gap-1.5 transition"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </div>

                    {/* Diff Viewer */}
                    <div className="space-y-2">
                      {proposal.changes.map((change, idx) => (
                        <div key={idx} className="rounded-xl border border-white/10 overflow-hidden">
                          <div className="px-3 py-1.5 bg-white/[0.04] text-[11px] font-mono font-semibold text-zinc-300 flex items-center justify-between">
                            <span>{change.action.toUpperCase()}: {change.path}</span>
                          </div>
                          {change.diff && (
                            <pre className="p-3 bg-black/40 text-[11px] font-mono overflow-x-auto text-zinc-300 whitespace-pre">
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

