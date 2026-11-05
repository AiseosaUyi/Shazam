'use client';

import Link from 'next/link';
import { SkillsManager } from '@/components/SkillsManager';
import { DeleteAccountCard } from '@/components/DeleteAccountCard';
import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Save,
  CheckCircle2,
  Shield,
  Lock,
  AlertCircle,
  Network,
  Plus,
  Trash2,
  ExternalLink,
  RefreshCw,
  Terminal,
  Server,
  Check,
  Zap,
  Mail,
  Globe,
  FileText,
  Video,
  BarChart3,
  Key,
  Send,
  ToggleLeft,
  ToggleRight,
  Info,
} from 'lucide-react';
import type { UserPreferences } from '@/lib/types';
import { errMessage } from '@/lib/errors';

interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: string;
  status: string;
  tools?: Array<{ name: string; description?: string }>;
  createdAt?: string;
}

interface SkillConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: 'mail' | 'globe' | 'file' | 'video' | 'chart';
  enabled: boolean;
  capabilities: string[];
  settings: {
    recipient?: string;
    deliveryMode?: 'gmail_web' | 'client' | 'api';
    apiKey?: string;
    senderName?: string;
    workspace?: string;
    engine?: string;
    format?: string;
  };
}

const DEFAULT_SKILLS: SkillConfig[] = [
  {
    id: 'google_workspace',
    name: 'Google Workspace & Email Dispatcher',
    category: 'Productivity & Communication',
    description: 'Autonomous email drafting, recipient dispatching, and Google Calendar event scheduling.',
    icon: 'mail',
    enabled: true,
    capabilities: [
      'Draft email to recipient (aise@gruve.events)',
      '1-Click Gmail Web Compose & Mailto prefill',
      'Direct Background API Delivery (Resend / SendGrid / SMTP)',
      'Calendar scheduling and meeting invitations',
    ],
    settings: {
      recipient: 'aise@gruve.events',
      deliveryMode: 'gmail_web',
      apiKey: '',
      senderName: 'Arcwork Assistant',
    },
  },
  {
    id: 'chrome_browser',
    name: 'Chrome Browser Agent',
    category: 'Web Automation & Scraping',
    description: 'Headless browser automation via Chrome DevTools Protocol to inspect websites, crawl documentation, and audit social feeds.',
    icon: 'globe',
    enabled: true,
    capabilities: [
      'Headless Chromium session',
      'DOM tree analysis and screenshot verification',
      'Dynamic content scraping',
      'Social profile auditing (IG, X, LinkedIn)',
    ],
    settings: {
      engine: 'Headless Chromium (DevTools Protocol)',
    },
  },
  {
    id: 'notion_kb',
    name: 'Notion Knowledge Base (MCP)',
    category: 'Documentation & Knowledge',
    description: 'Direct MCP connector to search Notion workspaces, retrieve PRDs, query specifications, and append meeting summaries.',
    icon: 'file',
    enabled: true,
    capabilities: [
      'Search Notion databases and pages',
      'Read spec sheets and architectural wikis',
      'Sync task updates directly to Notion boards',
    ],
    settings: {
      workspace: 'Gruve Events & Engineering Wiki',
    },
  },
  {
    id: 'video_scripting',
    name: 'Video & Media Scripting Studio',
    category: 'Creative & Social Media',
    description: 'Pacing algorithms, viral storyboard generation, scene-by-scene audio/visual hooks, and TikTok/Reels captions.',
    icon: 'video',
    enabled: true,
    capabilities: [
      '60-second video storyboards',
      'Pacing & visual retention hooks',
      'Voiceover timing markers',
      'Social media captions and hashtags',
    ],
    settings: {
      format: '9:16 Shorts & Reels',
    },
  },
  {
    id: 'sheets_analyst',
    name: 'Sheets & Business Analyst',
    category: 'Data & Financials',
    description: 'Generates tabular summaries, computes financial unit economics, and formats CSV/spreadsheet models ready for export.',
    icon: 'chart',
    enabled: true,
    capabilities: [
      'Cohort analysis and retention modeling',
      'Financial unit economics projections',
      'CSV table and spreadsheet export',
      'SQL data pivoting',
    ],
    settings: {},
  },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'preferences' | 'mcp' | 'skills'>('preferences');
  const [pref, setPref] = useState<UserPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Skills State
  const [skills, setSkills] = useState<SkillConfig[]>(DEFAULT_SKILLS);
  const [skillsSaved, setSkillsSaved] = useState(false);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loadingMcp, setLoadingMcp] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'sse' | 'http' | 'websocket'>('http');
  const [newMcpToken, setNewMcpToken] = useState('');
  const [addingMcp, setAddingMcp] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    // Check URL parameters for active tab
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === 'skills' || tabParam === 'mcp' || tabParam === 'preferences') {
        setActiveTab(tabParam as any);
      } else if (window.location.hash === '#skills') {
        setActiveTab('skills');
      } else if (window.location.hash === '#mcp') {
        setActiveTab('mcp');
      }

      // Load skills configuration from localStorage
      try {
        const stored = localStorage.getItem('shazam_skills_config');
        if (stored) {
          const parsed = JSON.parse(stored);
          setSkills((prev) =>
            prev.map((s) => {
              const found = parsed.find((p: any) => p.id === s.id);
              return found ? { ...s, ...found, settings: { ...s.settings, ...found.settings } } : s;
            })
          );
        }
      } catch {
        // ignore
      }
    }

    fetch('/api/v1/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Please sign in to view and edit settings.');
        return res.json();
      })
      .then((json) => {
        if (json.preferences) setPref(json.preferences);
      })
      .catch((err) => setError(err.message));

    loadMcpServers();
  }, []);

  function handleSaveSkills() {
    try {
      localStorage.setItem('shazam_skills_config', JSON.stringify(skills));
      setSkillsSaved(true);
      setTimeout(() => setSkillsSaved(false), 3000);
    } catch {
      // ignore
    }
  }

  function toggleSkill(id: string) {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  }

  function updateSkillSettings(id: string, newSettings: Record<string, any>) {
    setSkills((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, settings: { ...s.settings, ...newSettings } } : s
      )
    );
  }

  async function loadMcpServers() {
    setLoadingMcp(true);
    try {
      const res = await fetch('/api/v1/mcp');
      const data = await res.json();
      if (res.ok && data.servers) {
        setMcpServers(data.servers);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMcp(false);
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pref) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultCostPolicy: pref.defaultCostPolicy,
          maxCostPerTaskUSD: Number(pref.maxCostPerTaskUSD),
          monthlyBudgetUSD: Number(pref.monthlyBudgetUSD),
          privacyMode: pref.privacyMode,
          autoFallbackEnabled: pref.autoFallbackEnabled,
          allowPaidFallback: pref.allowPaidFallback,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save settings.');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  async function handleAddMcp(e: React.FormEvent) {
    e.preventDefault();
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;

    setAddingMcp(true);
    setMcpError(null);
    try {
      const res = await fetch('/api/v1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMcpName.trim(),
          url: newMcpUrl.trim(),
          transport: newMcpTransport,
          authToken: newMcpToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.server) {
        setMcpServers((prev) => [data.server, ...prev]);
        setMcpModalOpen(false);
        setNewMcpName('');
        setNewMcpUrl('');
        setNewMcpToken('');
      } else {
        setMcpError(data.error || 'Failed to connect MCP server.');
      }
    } catch (err) {
      setMcpError(errMessage(err) || 'Network error.');
    } finally {
      setAddingMcp(false);
    }
  }

  async function handleDeleteMcp(id: string) {
    try {
      await fetch(`/api/v1/mcp/${id}`, { method: 'DELETE' });
      setMcpServers((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  }

  if (!pref) {
    return (
      <div className="flex-1 max-w-md w-full mx-auto p-8 flex flex-col items-center justify-center text-center">
        {error ? (
          <div className="p-6 rounded-2xl bg-surface border border-line/10 text-center space-y-4 shadow-xl w-full">
            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand mx-auto">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">Sign In Required</h2>
              <p className="text-xs text-ink-2 mt-1">{error}</p>
            </div>
            <a
              href="/login"
              className="inline-block w-full py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs transition shadow-md"
            >
              Sign In to Access Settings
            </a>
          </div>
        ) : (
          <div className="text-ink-3 text-sm font-sans text-center py-16">Loading settings...</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 h-full min-h-0 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 font-sans">
        {/* Header */}
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Settings</h1>
          <p className="text-sm text-ink-2 mt-1">
            How Arcwork picks models, what it may spend, and your skills.
          </p>
        </div>

      {/* Tabs */}
      <div className="flex border-b border-line/[0.08] gap-6">
        <button
          onClick={() => setActiveTab('preferences')}
          className={`pb-3 text-sm font-medium transition flex items-center gap-2 relative ${
            activeTab === 'preferences' ? 'text-brand font-semibold' : 'text-ink-2 hover:text-ink'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Preferences</span>
          {activeTab === 'preferences' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand rounded-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('skills')}
          className={`pb-3 text-sm font-medium transition flex items-center gap-2 relative ${
            activeTab === 'skills' ? 'text-brand font-semibold' : 'text-ink-2 hover:text-ink'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Skills</span>
          <span className="px-1.5 py-0.2 rounded-full bg-brand/20 text-brand-soft text-[10px] font-mono">
            Skills
          </span>
          {activeTab === 'skills' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand rounded-full" />
          )}
        </button>

        <Link href="/connections#apps" className="relative flex items-center gap-2 pb-3 text-sm font-medium text-ink-2 transition hover:text-ink">
          <Network className="h-4 w-4" />
          <span>MCP servers</span>
          <span className="text-[11px] text-ink-3">moved to Connections →</span>
        </Link>
      </div>

      {saved && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Settings successfully saved.
        </div>
      )}

      {skillsSaved && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Skills saved.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab 1: Routing & Budget */}
      {activeTab === 'preferences' && (
        <form onSubmit={handleSave} className="bg-surface border border-line/[0.08] rounded-2xl p-6 shadow-xl space-y-6">
          {/* Cost Policy Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-ink-2 font-sans">
              How to pick models
            </label>
            <p className="text-xs text-ink-2">
              “Free only” never uses a paid model, even with your keys connected.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {[
                { id: 'free_only', title: 'Free only', desc: 'Never spend money. Uses free and local models only.' },
                { id: 'lowest_cost', title: 'Cheapest', desc: 'Free first, the cheapest paid model only when needed.' },
                { id: 'balanced', title: 'Balanced', desc: 'Recommended. Good quality without surprise costs.' },
                { id: 'best_quality', title: 'Best quality', desc: 'The strongest model you have, whatever it costs.' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPref({ ...pref, defaultCostPolicy: p.id as any })}
                  className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                    pref.defaultCostPolicy === p.id
                      ? 'border-brand bg-brand/10 text-ink'
                      : 'border-line/[0.06] bg-line/[0.02] text-ink-2 hover:text-ink hover:bg-line/[0.04]'
                  }`}
                >
                  <span className="text-xs font-semibold text-ink">{p.title}</span>
                  <span className="text-[11px] text-ink-2 mt-1 leading-relaxed">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Financial Ceilings */}
          <div className="pt-4 border-t border-line/[0.06] grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-ink-2 font-sans mb-1">
                Spend limit per task (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.001"
                max="50"
                value={pref.maxCostPerTaskUSD}
                onChange={(e) => setPref({ ...pref, maxCostPerTaskUSD: parseFloat(e.target.value) || 0.01 })}
                className="w-full px-3.5 py-2.5 bg-black/40 border border-line/[0.08] rounded-xl text-sm text-ink font-mono focus:outline-none focus:border-brand"
              />
              <p className="text-[11px] text-ink-3 mt-1">Paid models that would cost more are skipped.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-2 font-sans mb-1">
                Monthly spend limit (USD)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="5000"
                value={pref.monthlyBudgetUSD}
                onChange={(e) => setPref({ ...pref, monthlyBudgetUSD: parseFloat(e.target.value) || 1.0 })}
                className="w-full px-3.5 py-2.5 bg-black/40 border border-line/[0.08] rounded-xl text-sm text-ink font-mono focus:outline-none focus:border-brand"
              />
              <p className="text-[11px] text-ink-3 mt-1">Arcwork switches to free models once you reach it.</p>
            </div>
          </div>

          {/* Privacy Mode */}
          <div className="pt-4 border-t border-line/[0.06] space-y-2">
            <label className="block text-xs font-semibold text-ink-2 font-sans">
              Privacy
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPref({ ...pref, privacyMode: 'standard' })}
                className={`flex-1 p-3.5 rounded-xl border text-left transition ${
                  pref.privacyMode === 'standard'
                    ? 'border-brand bg-brand/10 text-ink'
                    : 'border-line/[0.06] bg-line/[0.02] text-ink-2'
                }`}
              >
                <div className="text-xs font-semibold text-ink">Standard</div>
                <div className="text-[11px] text-ink-2 mt-0.5">Allows free tier routes with standard provider policies.</div>
              </button>
              <button
                type="button"
                onClick={() => setPref({ ...pref, privacyMode: 'strict' })}
                className={`flex-1 p-3.5 rounded-xl border text-left transition ${
                  pref.privacyMode === 'strict'
                    ? 'border-brand bg-brand/10 text-ink'
                    : 'border-line/[0.06] bg-line/[0.02] text-ink-2'
                }`}
              >
                <div className="text-xs font-semibold text-brand flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" /> Strict Privacy
                </div>
                <div className="text-[11px] text-ink-2 mt-0.5">Excludes any route where user data may be used for model training.</div>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-line/[0.06] flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs rounded-xl transition flex items-center gap-2 shadow-md disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </form>
      )}
      {activeTab === 'preferences' && <DeleteAccountCard />}

      {/* Tab 2: Autonomous Skills & Connectors */}
      {activeTab === 'skills' && <SkillsManager />}

      {/* Tab 3: MCP Connectors & Tools */}
      {activeTab === 'mcp' && (
        <div className="rounded-2xl border border-line/[0.08] bg-surface p-5 text-[13px] text-ink-2">
          MCP servers now live in <Link href="/connections#apps" className="text-brand-soft underline-offset-2 hover:underline">Connections → Apps</Link>, next to Gmail and GitHub.
        </div>
      )}

      {/* Add MCP Modal */}
      {mcpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-line/10 rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h3 className="text-base font-semibold text-ink">Add Custom MCP Server</h3>
              <p className="text-xs text-ink-2 mt-1">
                Provide the SSE or HTTP endpoint for your Model Context Protocol server.
              </p>
            </div>

            {mcpError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs">
                {mcpError}
              </div>
            )}

            <form onSubmit={handleAddMcp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Server Name</label>
                <input
                  type="text"
                  placeholder="e.g. Postgres DB Inspector"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-line/10 rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Server URL</label>
                <input
                  type="url"
                  placeholder="https://mcp.yourdomain.com/sse"
                  value={newMcpUrl}
                  onChange={(e) => setNewMcpUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-line/10 rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">Transport</label>
                  <select
                    value={newMcpTransport}
                    onChange={(e) => setNewMcpTransport(e.target.value as any)}
                    className="w-full px-3 py-2 bg-black/40 border border-line/10 rounded-xl text-xs text-ink focus:outline-none focus:border-brand"
                  >
                    <option value="sse">Server-Sent Events (SSE)</option>
                    <option value="http">HTTP POST / Stream</option>
                    <option value="websocket">WebSocket</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">Auth Token (Optional)</label>
                  <input
                    type="password"
                    placeholder="Bearer token"
                    value={newMcpToken}
                    onChange={(e) => setNewMcpToken(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-line/10 rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line/5">
                <button
                  type="button"
                  onClick={() => setMcpModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-ink-2 hover:text-ink transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingMcp}
                  className="px-4 py-2 bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs rounded-xl transition shadow-md disabled:opacity-50"
                >
                  {addingMcp ? 'Connecting...' : 'Connect Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
