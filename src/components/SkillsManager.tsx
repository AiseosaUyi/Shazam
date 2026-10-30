'use client';

import { useDialog } from '@/components/ui/dialog';
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Upload, Download, Trash2, Sparkles, Loader2, Save, X } from 'lucide-react';

/**
 * Server-side skills in the open SKILL.md format. The agent sees only each skill's name and
 * description and loads the full instructions on demand.
 */

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  modes: Array<'chat' | 'cowork' | 'code'>;
  enabled: boolean;
  version: number;
}

const MODES: Array<{ id: 'cowork' | 'code' | 'chat'; label: string }> = [
  { id: 'cowork', label: 'Co-Work' },
  { id: 'code', label: 'Code' },
  { id: 'chat', label: 'Chat' },
];

const EXAMPLE = `---
name: Weekly investor update
description: Use when the user asks for an investor or stakeholder update email. Produces a concise, numbers-first update in our house style.
---

# Weekly investor update

1. Ask for (or look up) this week's metrics: revenue, users, burn, runway.
2. Structure: TL;DR (3 bullets) → Wins → Challenges → Asks.
3. Keep it under 250 words. No hype words. Sign off as the founder.
`;

export function SkillsManager() {
  const dialog = useDialog();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/v1/skills').then((res) => res.json()).catch(() => ({ skills: [] }));
    setSkills(r.skills || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    const body = { name: editing.name, description: editing.description, instructions: editing.instructions, modes: editing.modes };
    const res = editing.id
      ? await fetch(`/api/v1/skills/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/v1/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error || 'Could not save skill.');
    setEditing(null);
    load();
  }

  async function importMarkdown(markdown: string, label: string) {
    const res = await fetch('/api/v1/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(`${label}: ${data.error || 'import failed'}`);
  }

  async function importFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) await importMarkdown(await file.text(), file.name);
    load();
  }

  async function toggle(skill: Skill) {
    await fetch(`/api/v1/skills/${skill.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !skill.enabled }) });
    load();
  }

  async function remove(skill: Skill) {
    if (!(await dialog.confirm({ title: `Delete “${skill.name}”?`, body: 'Agents will no longer use this skill.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await fetch(`/api/v1/skills/${skill.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="bg-surface border border-line/[0.08] rounded-2xl p-6 shadow-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">Skills</h3>
          <p className="text-xs text-ink-2 mt-1 max-w-xl">
            Reusable instructions the agents load when a task matches. Uses the open SKILL.md format, so skills from other agents import directly.
          </p>
        </div>
        <div className="flex gap-2 self-start">
          <input ref={fileRef} type="file" accept=".md,text/markdown" multiple className="hidden" onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl bg-line/5 hover:bg-line/10 text-ink text-xs flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Import SKILL.md
          </button>
          <button onClick={() => setEditing({ name: '', description: '', instructions: '', modes: ['cowork', 'code'] })} className="px-3 py-2 rounded-xl bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New skill
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

      {editing && (
        <div className="rounded-xl border border-brand/30 bg-black/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-brand-soft">{editing.id ? `Edit ${editing.name}` : 'New skill'}</p>
            <button onClick={() => setEditing(null)}><X className="w-4 h-4 text-ink-2 hover:text-ink" /></button>
          </div>
          <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Name (e.g. Weekly investor update)" maxLength={64} className="w-full bg-black/40 border border-line/10 rounded-lg px-3 py-2 text-xs text-ink" />
          <textarea value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="When should the agent use this? (the agent decides from this line)" rows={2} maxLength={1024} className="w-full bg-black/40 border border-line/10 rounded-lg px-3 py-2 text-xs text-ink" />
          <textarea value={editing.instructions || ''} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} placeholder={EXAMPLE.split('---\n')[2]} rows={10} className="w-full bg-black/40 border border-line/10 rounded-lg px-3 py-2 text-xs text-ink font-mono" />
          <div className="flex items-center gap-3 text-xs text-ink-2">
            <span className="text-ink-3">Available in:</span>
            {MODES.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={(editing.modes || []).includes(m.id)}
                  onChange={(e) => setEditing({ ...editing, modes: e.target.checked ? [...(editing.modes || []), m.id] : (editing.modes || []).filter((x) => x !== m.id) })}
                />
                {m.label}
              </label>
            ))}
          </div>
          <button onClick={save} disabled={saving || !editing.name || !editing.description || !editing.instructions} className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-soft disabled:opacity-40 text-brand-ink font-semibold text-xs flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save skill
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-ink-3 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading skills…</div>
      ) : skills.length === 0 && !editing ? (
        <div className="rounded-xl border border-dashed border-line/10 p-6 text-center space-y-2">
          <Sparkles className="w-5 h-5 text-brand mx-auto" />
          <p className="text-xs text-ink-2">No skills yet. Create one or import a SKILL.md.</p>
          <button onClick={() => importMarkdown(EXAMPLE, 'example').then(load)} className="text-[11px] text-brand-soft hover:underline">Add an example skill</button>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => (
            <div key={s.id} className="rounded-xl border border-line/[0.06] bg-line/[0.02] p-3 flex items-start gap-3">
              <button onClick={() => toggle(s)} className={`mt-0.5 w-8 h-4.5 rounded-full relative shrink-0 transition ${s.enabled ? 'bg-brand' : 'bg-zinc-700'}`} style={{ height: 18 }} title={s.enabled ? 'Disable' : 'Enable'}>
                <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition ${s.enabled ? 'left-4' : 'left-0.5'}`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink font-medium">{s.name} <span className="text-[10px] text-ink-3 font-normal">v{s.version} · {s.modes.join(', ')}</span></p>
                <p className="text-xs text-ink-2 mt-0.5">{s.description}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing(s)} className="px-2 py-1 rounded-md text-[11px] text-ink-2 hover:bg-line/5">Edit</button>
                <a href={`/api/v1/skills/${s.id}?format=md`} className="p-1.5 rounded-md text-ink-2 hover:bg-line/5" title="Download SKILL.md"><Download className="w-3.5 h-3.5" /></a>
                <button onClick={() => remove(s)} className="p-1.5 rounded-md text-ink-2 hover:text-red-400 hover:bg-line/5" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
