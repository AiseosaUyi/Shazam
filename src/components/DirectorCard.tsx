'use client';

import { useEffect, useState, useRef } from 'react';

type DirectorOption = 'auto' | 'claude' | 'codex' | 'cursor' | 'antigravity' | 'arcwork';

const OPTIONS: { value: DirectorOption; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatic', hint: "Use whichever assistant sends the task; Arcwork directs its own tasks." },
  { value: 'claude', label: 'Claude', hint: 'Claude Code or the Claude app plans and reviews.' },
  { value: 'codex', label: 'ChatGPT Codex', hint: 'Codex plans and reviews.' },
  { value: 'cursor', label: 'Cursor', hint: "Cursor's agent plans and reviews." },
  { value: 'antigravity', label: 'Antigravity', hint: 'Antigravity plans and reviews.' },
  { value: 'arcwork', label: 'Arcwork only (no paid AI)', hint: "Arcwork's free model plans, builds and checks its own work." },
];

export function DirectorCard() {
  const [director, setDirector] = useState<DirectorOption>('auto');
  const savedRef = useRef<DirectorOption>('auto');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((r) => (r.ok ? r.json() : { preferences: {} }))
      .then((d) => {
        const dVal = d.preferences?.director;
        if (dVal && OPTIONS.some((o) => o.value === dVal)) {
          setDirector(dVal as DirectorOption);
          savedRef.current = dVal as DirectorOption;
        }
      })
      .catch(() => {});

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  async function select(value: DirectorOption) {
    setDirector(value);
    setSaveStatus(null);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ director: value }),
      });
      if (!res.ok) throw new Error('fail');
      savedRef.current = value;
      setSaveStatus('saved');
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setDirector(savedRef.current);
      setSaveStatus('error');
    }
  }

  return (
    <div className="rounded-2xl border border-line/[0.08] bg-surface p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">Who directs your work</p>
        <p className="text-xs text-ink-2">Pick the AI that plans and reviews. Arcwork's free models do the building either way.</p>
      </div>

      <div role="radiogroup" className="space-y-2">
        {OPTIONS.map((opt) => (
          <label key={opt.value} className={`flex items-start gap-2 rounded-xl border border-line/[0.06] p-2.5 cursor-pointer ${director === opt.value ? 'border-brand/40 bg-brand/[0.05]' : ''}`}>
            <input type="radio" name="director" value={opt.value} checked={director === opt.value} onChange={() => select(opt.value)} className="mt-1 shrink-0 accent-brand" />
            <div>
              <p className={`text-[13px] font-medium ${director === opt.value ? 'text-brand' : 'text-ink'}`}>{opt.label}</p>
              <p className="text-[11px] text-ink-3">{opt.hint}</p>
            </div>
          </label>
        ))}
      </div>

      {saveStatus === 'error' && (
        <p className="text-[11px] text-red-400">Couldn't save. Try again.</p>
      )}

      {saveStatus === 'saved' && (
        <p className="text-[11px] text-ink-3">Saved</p>
      )}
    </div>
  );
}
