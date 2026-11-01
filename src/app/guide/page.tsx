'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, Hammer, MessageSquare } from 'lucide-react';
import { CopyText, Step } from '@/components/guide/Steps';
import { BRAND_NAME } from '@/lib/brand';

/**
 * Walkthrough: use Arcwork from your code editor (Cursor, VS Code, Claude Code, Codex) so the
 * assistant you pay for only plans and reviews, and Arcwork's free models do the building.
 */

const RULE = `# Arcwork first (save my AI plan's usage)
You plan and review; Arcwork (MCP server "Arcwork") builds on free models.
1. Before any build or edit task, say in one line: the task, how complex it is, and where it goes.
2. By default send the work to Arcwork with start_task. Don't write the code yourself.
3. If a task truly needs your own reasoning (architecture, a subtle bug, security), explain why and ask me "Go ahead?" first. Only continue after I say yes.
4. If Arcwork fails the same thing twice, tell me what keeps failing and ask before taking over.
5. Give Arcwork one complete brief: goal, folder path (local_folder), constraints, how to check it's done.
6. Keep calling get_task_status until it's done (it waits on Arcwork's side). Review the summary and the diff; open files only if something looks wrong. Send fixes with send_feedback.`;

const WHERE: { id: string; label: string; steps: React.ReactNode }[] = [
  { id: 'claude-code', label: 'Claude Code', steps: <>Add it to <code className="shz-mono">~/.claude/CLAUDE.md</code> (all projects) or <code className="shz-mono">CLAUDE.md</code> in one project.</> },
  { id: 'claude-app', label: 'Claude app', steps: <>In a Project, open <b>Project instructions</b> and paste it. For every chat: Settings → Profile → personal preferences.</> },
  { id: 'cursor', label: 'Cursor', steps: <>Settings → <b>Rules</b> → User Rules (all projects), or a file in <code className="shz-mono">.cursor/rules/</code> for one project.</> },
  { id: 'codex', label: 'Codex', steps: <>Add it to <code className="shz-mono">~/.codex/AGENTS.md</code> (all projects) or <code className="shz-mono">AGENTS.md</code> in one project.</> },
];

const EXAMPLES = [
  'Add a waitlist form to the homepage of ~/Projects/my-app. Email field, success message, store signups in the existing database.',
  'Write tests for the checkout flow in ~/Projects/shop and fix anything that fails.',
  'Plan how we should add team accounts to ~/Projects/my-app, then have Arcwork build it step by step.',
];

function Section({ id, n, title, children }: { id?: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-line/[0.08] bg-surface p-5">
      <p className="shz-mono text-[11px] text-brand">STEP {n}</p>
      <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function GuidePage() {
  const [where, setWhere] = useState('claude-code');
  const target = WHERE.find((w) => w.id === where)!;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8 sm:px-6">
        <header>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Build from your editor, for free</h1>
          <p className="mt-2 text-[14px] text-ink-2">
            Keep using Claude, Codex or Cursor where you already work. Your assistant plans and checks the work; {BRAND_NAME}&apos;s free models do the
            building. Your paid plan lasts much longer.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <MessageSquare className="h-4 w-4" />, t: 'You ask', b: 'In your editor, the way you always do.' },
            { icon: <Bot className="h-4 w-4" />, t: 'Your assistant plans & reviews', b: 'Uses a little of your plan. Asks before doing heavy work itself.' },
            { icon: <Hammer className="h-4 w-4" />, t: `${BRAND_NAME} builds`, b: 'Writes the code, runs it, fixes it. Free.' },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-line/[0.08] bg-surface p-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">{c.icon}</div>
              <p className="mt-2.5 text-[13px] font-semibold text-ink">{c.t}</p>
              <p className="mt-0.5 text-[12px] text-ink-2">{c.b}</p>
            </div>
          ))}
        </div>

        <Section n={1} title="Connect your assistant">
          <p className="text-[13px] text-ink-2">Pick Claude, Codex, Antigravity or Cursor and follow the steps. For Claude it&apos;s a sign-in, no key.</p>
          <Link href="/connections#assistants" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-ink hover:bg-brand-soft">
            Connect my assistant <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Section>

        <Section id="computer" n={2} title="Let Arcwork work in your project folders">
          <p className="text-[13px] text-ink-2">
            So {BRAND_NAME} can edit and run code in your real repos, connect your computer once. It only touches folders you allow, and risky commands
            ask you first. Skip this if you&apos;re happy for {BRAND_NAME} to build in its own cloud projects.
          </p>
          <ol className="mt-3 space-y-3">
            <Step n={1} title={<>In {BRAND_NAME}, open <b>Connections → Devices</b> and click <b>Get pairing code</b>.</>} />
            <Step n={2} title={<>Open a terminal in your editor (<b>Terminal → New Terminal</b>) and paste the four commands shown there, one at a time.</>}>
              <p className="mt-1 text-[11px] text-ink-3">They download the connector, pair it, allow your projects folder, and start it. Needs Node 18 or newer.</p>
            </Step>
            <Step n={3} title="Leave that terminal tab open while you work. Next time, just run:">
              <CopyText value="node ~/.arcwork-bridge.js start" />
            </Step>
          </ol>
          <Link href="/connections#devices" className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-ink ring-1 ring-line/10 hover:bg-surface-2">
            Get my pairing code <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Section>

        <Section n={3} title="Tell your assistant to use Arcwork first">
          <p className="text-[13px] text-ink-2">
            Paste this rule once. Your assistant will send building work to {BRAND_NAME}, and ask you before spending your plan on heavy work itself.
          </p>
          <CopyText value={RULE} mono={false} />
          <p className="mt-3 text-[12px] text-ink-3">Where to paste it:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WHERE.map((w) => (
              <button
                key={w.id}
                onClick={() => setWhere(w.id)}
                aria-pressed={where === w.id}
                className={`rounded-full px-3 py-1 text-[12px] ring-1 transition ${where === w.id ? 'bg-brand/10 text-ink ring-brand/40' : 'text-ink-2 ring-line/10 hover:bg-surface-2'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-ink">{target.steps}</p>
        </Section>

        <Section n={4} title="Ask for something">
          <p className="text-[13px] text-ink-2">Start a new chat so your assistant picks up {BRAND_NAME}, then ask normally. A few to try:</p>
          {EXAMPLES.map((e) => (
            <CopyText key={e} value={e} mono={false} />
          ))}
          <p className="mt-3 text-[12px] text-ink-3">
            You&apos;ll see a one-line plan first. Simple jobs go straight to {BRAND_NAME}. For hard ones your assistant asks &ldquo;Go ahead?&rdquo; before using
            your plan. Watch any task live from the link it shares.
          </p>
        </Section>

        <section className="rounded-2xl border border-line/[0.08] bg-surface p-5">
          <h2 className="text-[15px] font-semibold text-ink">Tips and fixes</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] text-ink-2">
            <li><b className="text-ink">Save even more:</b> while your assistant is only handing work off, switch it to a smaller model (in Claude Code type <code className="shz-mono">/model</code>).</li>
            <li><b className="text-ink">&ldquo;Arcwork tools not found&rdquo;:</b> start a new chat. Assistants load connectors when a chat begins.</li>
            <li><b className="text-ink">&ldquo;Your computer is not connected&rdquo;:</b> run <code className="shz-mono">node ~/.arcwork-bridge.js start</code> in a terminal and keep it open.</li>
            <li><b className="text-ink">Arcwork keeps getting it wrong:</b> your assistant will tell you what&apos;s failing and ask if it should take over that part.</li>
            <li><b className="text-ink">Want zero use of your plan?</b> Use {BRAND_NAME}&apos;s own <Link href="/agent" className="underline underline-offset-2">Code</Link> page directly.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
