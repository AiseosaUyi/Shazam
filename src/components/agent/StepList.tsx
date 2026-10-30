'use client';

import React, { useState } from 'react';
import { Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

/** Compact, expandable list of the tool steps an agent took (shared by Code and Co-Work). */

export interface ToolStep {
  step: number;
  tool: string;
  args?: any;
  observation?: string;
  isError?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  list_files: 'Looked at the files',
  grep: 'Searched the code',
  read_file: 'Read a file',
  edit_file: 'Edited a file',
  write_file: 'Wrote a file',
  delete_file: 'Deleted a file',
  run_command: 'Ran a command',
  start_preview: 'Started a preview',
  todo_write: 'Updated the plan',
  web_fetch: 'Read a web page',
  github_push: 'Pushed to GitHub',
  github_create_pr: 'Opened a pull request',
  github_clone: 'Cloned a repo',
  local_run_command: 'Ran a command on your computer',
  local_read_file: 'Read a file on your computer',
  local_write_file: 'Wrote a file on your computer',
  local_edit_file: 'Edited a file on your computer',
  local_list_files: 'Listed files on your computer',
  browser_open: 'Opened a page',
  browser_read: 'Read the page',
  browser_click: 'Clicked',
  browser_type: 'Typed',
  browser_screenshot: 'Took a screenshot',
  current_time: 'Checked the time',
  gmail_search: 'Searched Gmail',
  gmail_read: 'Read an email',
  gmail_create_draft: 'Saved a Gmail draft',
  gmail_send: 'Prepared an email to send',
  schedule_email: 'Prepared a scheduled email',
  schedule_task: 'Prepared a scheduled task',
  list_schedules: 'Checked schedules',
  cancel_schedule: 'Cancelled a schedule',
  calendar_list_events: 'Checked the calendar',
  calendar_create_event: 'Prepared a calendar event',
  generate_image: 'Generated an image',
  edit_video: 'Edited a video',
  transcribe_video: 'Transcribed media',
  list_media: 'Listed media',
  load_skill: 'Loaded a skill',
};

export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  if (name.includes('__')) {
    const [server, tool] = name.split('__');
    return `${server} · ${tool.replace(/_/g, ' ')}`;
  }
  return name.replace(/_/g, ' ');
}

export function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function StepList({ steps, live }: { steps: ToolStep[]; live?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!steps.length) return null;
  return (
    <ol className="relative ml-1.5 space-y-0.5 border-l border-brand/25 pl-4">
      {steps.map((s, i) => {
        const done = s.observation !== undefined;
        const running = !done && live;
        return (
          <li key={`${s.step}-${i}`} className="relative">
            <span className={`absolute -left-[21px] top-[9px] h-2 w-2 rounded-full ring-4 ring-canvas ${running ? 'bg-brand shz-live' : s.isError ? 'bg-red-400' : 'bg-brand/70'}`} />
            <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-[12.5px] text-ink-2 hover:text-ink">
              <span className="truncate">{toolLabel(s.tool)}</span>
              {s.args?.path && <span className="shz-mono truncate text-[11px] text-ink-3">{String(s.args.path).split('/').slice(-2).join('/')}</span>}
              {s.args?.command && <span className="shz-mono truncate text-[11px] text-ink-3">{String(s.args.command).slice(0, 60)}</span>}
              {running && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand" />}
              {s.isError && <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />}
              <span className="ml-auto shrink-0 text-ink-3">{open === i ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</span>
            </button>
            {open === i && (
              <div className="mb-2 space-y-1.5">
                {s.args && Object.keys(s.args).length > 0 && (
                  <pre className="shz-mono max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-[10.5px] text-ink-3">{JSON.stringify(s.args, null, 2)}</pre>
                )}
                {s.observation && (
                  <pre className={`shz-mono max-h-60 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-[10.5px] ${s.isError ? 'bg-red-500/5 text-red-300' : 'bg-surface text-ink-2'}`}>{s.observation}</pre>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
