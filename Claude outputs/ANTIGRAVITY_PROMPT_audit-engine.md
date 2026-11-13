# Build brief for Anti-Gravity: Maestro Audit Engine

You are building a new capability inside Maestro (and a small change in AutoApply). Read this whole brief before writing any code. Build all four phases in one continuous run. Do not stop between phases for review. Instead, pass each phase's self-check gate (section 5) before moving on, and produce one final review package at the end (section 8). Stop early only for a real blocker you cannot work around, and write it down.

---

## 0. What we are building, in one paragraph

Given a company URL, Maestro captures the product (several pages and key flows), runs a deep UX audit, ranks the top 5 lapses with evidence, lets the designer (Aise) pick 1 or 2, produces editable redesigns as real Maestro nodes, and builds a case-study deck in the style of a warm product walkthrough. AutoApply decides which companies are worth auditing and stages the outreach draft. A versioned "taste" skill learns from Aise's edits and answers so the critique and design quality improve over time. The output must be good enough that a founder would want to reply. Design quality is the headline.

## 1. Hard constraints (read twice)

1. **Free first, $0 cash per audit.** Aise is job hunting and has no budget.
   - Deterministic code does everything it can: crawling, capture, checks, brand extraction, DOM to nodes, export.
   - Judgment steps (vision critique, top-5 ranking, redesign composition, case-study writing) are designed to be driven by **Claude Code through Maestro's MCP server**, on Aise's existing Claude plan. Maestro must not call a paid API for these by default.
   - Bulk text steps (flow picking, step actions, finding labels, first drafts) use a **free OpenAI-compatible endpoint** (Groq, OpenRouter free models, Gemini's OpenAI-compatible endpoint, or local Ollama) configured by env.
   - Add a spend guard. `MAESTRO_MAX_SPEND_USD` defaults to `0`. Any provider marked paid is refused unless the guard allows it. Log every model call with provider, model, tokens and estimated cost.
   - No paid services: no Apollo, no Firecrawl cloud, no Browserbase, no fal.ai, no Figma paid MCP write tools, no code.to.design or Anima.
2. **Maestro's engineering rules are non-negotiable** (see `CLAUDE.md`): one zod schema in `packages/core/src/schema.ts`; every mutation is a named Command through `CommandBus`; layout is computed by `packages/layout`, never hand-placed; rendering is CanvasKit; AI never emits a whole document as JSON, it uses typed tools; free/OSS dependencies only; cross-platform Mac arm64/x64 and Windows x64; tests are not optional; "render and look at it".
3. **Copy style** in any user-facing text Maestro generates (reports, case studies, emails): plain sentences, no em dashes, no colons used as sentence connectors, no generic AI filler.
4. **Never send anything.** Outreach is always a draft that Aise approves in AutoApply.
5. **Be a good citizen on other people's sites.** Honour robots.txt and crawl-delay by default (a per-audit override must be explicit and logged). Rate-limit. Identify the user agent. Stop in code, before any model call, at login, CAPTCHA, OTP and payment pages. Never solve CAPTCHAs. Never create accounts or submit forms with real data unless the user opts in for that audit. Never submit payment. Keep captures local and private.
6. **Licenses.** Only MIT, Apache-2.0, BSD, ISC or MPL-2.0 dependencies (MPL is fine as an unmodified dependency). Nothing AGPL. Where a source repo has no confirmed license (UXAgent, Crit Studio, saliency repos), copy ideas, not code.

## 2. Read first, verify, then plan

Before Phase 1:

1. Read `docs/PROGRESS.md`, `docs/MAESTRO_2_SPEC.md` (especially 6.2 generation and 6.5 extraction), `docs/DECISIONS.md`, `CLAUDE.md`, and the READMEs and `src/index.ts` of `packages/ai`, `packages/core`, `packages/mcp`, `packages/import-figma`, `packages/export-code`, `packages/libraries`, `packages/figma-plugin`.
2. Confirm these research findings are still true, and write what differs into `docs/DECISIONS.md`:
   - The AI gateway has one chat provider (`OpenAIProvider`) and it accepts a `baseUrl`, but the env loader does not read one.
   - Generation uses ~10 typed composition tools and returns real computed layout.
   - The critic has 7 deterministic checks (contrast, spacing scale, overflow, overlaps, off-artboard, touch targets, empty frames) and an 8-category vision rubric.
   - `addImage` with query or generate throws.
   - The MCP server exposes `run_pipeline` (generate, remix, edit).
   - There is no web capture or DOM import anywhere.
3. Write `docs/AUDIT_ENGINE_PLAN.md`: package layout, the zod schemas below, the MCP tools, and the phase checklist. Keep it short. This file and `docs/PROGRESS.md` are the handoff docs.

## 3. Architecture

```
AutoApply (lead picked)            Maestro
  leads_inbox  ───────────────▶  packages/import-web   capture, brand tokens, DOM -> nodes      $0
                                 packages/audit        rules, flow walker, findings, ranking     $0 + free model
                                 Claude Code via MCP   critique, top 5, redesign, case study     Claude plan
                                 packages/ai           typed composition tools, critic, repair
                                 case-study deck       Maestro frames -> PDF + static web page
  upsert_lead / log_artifact /  ◀─ MCP calls
  draft_outreach_email (draft only, Aise approves)
taste/ skill files: principles, anti-patterns, work library, severity examples, eval set, changelog
```

### 3.1 Model providers (`packages/ai`)

- Add a provider setting, `MAESTRO_LLM_MODE = claude-code | free | openai`. The default is `claude-code`.
  - `claude-code` means no model call happens inside Maestro for judgment steps. The pipeline pauses at those steps and exposes materials and submit tools through MCP (section 3.6). Claude Code does the reasoning and calls the submit tool.
  - `free` reads `MAESTRO_LLM_BASE_URL`, `MAESTRO_LLM_API_KEY` and `MAESTRO_LLM_MODEL` (plus optional `MAESTRO_VISION_MODEL`) and uses the existing OpenAI provider with `baseUrl`.
  - `openai` is the current behaviour, guarded by the spend cap.
- Add a provider registry with `paid: boolean` per provider and model, and the spend guard. Write a unit test that a paid call with the guard at 0 throws before any network call.
- Add a JSON-schema output mode. Validate every model output with zod. Retry once with the validation error, then fail loudly.

### 3.2 `packages/import-web` (new)

Use Crawlee (Apache-2.0), playwright-core (Apache-2.0), robots-parser (MIT) and, optionally, `@duckduckgo/autoconsent` (MPL-2.0) for cookie banners. Run capture in an Electron utility or child process, never in the renderer. It must also run headless from Node for tests and the CLI.

1. **Preflight.** Read robots.txt and sitemaps. Record the policy.
2. **Discovery, deterministic.** Run a PlaywrightCrawler on the same hostname, opting in to app. and auth. subdomains. Drop assets, PDFs, locale duplicates and parameter explosions. Cap at 60 pages. Group URLs into path templates (`/blog/:slug`) and keep 1 to 2 exemplars per template. Score by nav and footer links, CTA text (`sign up|get started|try|pricing|plans|checkout|cart|book demo|log in`) and key paths (`/pricing /signup /register /onboarding /checkout /cart /contact`).
3. **Flow selection.** Make one call to a cheap model on a compact nav map (templates, nav labels, CTA texts, forms with field labels). It returns a zod-validated list of flows, each with an entry URL and a goal. In `claude-code` mode this is a materials-and-submit pair.
4. **Flow walking.** Run observe, decide, act on `locator.ariaSnapshot()` refs, never screenshots, at 5 to 12 steps per flow. Fill forms only with obvious dummy data and only when the audit's `allowFormFill` is true. Hard stops in code at login, CAPTCHA, OTP or payment, which record a `blocked` state. Cache resolved actions per site so re-audits replay at $0. Optionally, the user signs in by hand in a headed window and the walker resumes with that `storageState`. Never store third-party credentials.
5. **Per-state capture record** (zod `CaptureState`): `{ id, siteId, url, template, flowId?, stepIndex?, viewport: desktop|mobile, screenshotPath (full page, stitched via CDP if very tall), domSnapshotPath (CDP DOMSnapshot.captureSnapshot), ariaSnapshot, computedStyleSummary, assets[], consoleErrors[], timings, blocked? }`. Capture desktop at 1440 and mobile at 390.
6. **Brand tokens, $0.** From computed styles: cluster colours into a palette (with roles: background, surface, text, primary, accent), and extract the type scale (families, sizes, weights, line heights), radii, spacing steps and the logo (header img or svg, favicon, og:image). Write DTCG tokens into `packages/tokens` plus a short `brand.md` brief, similar to Google Stitch's DESIGN.md idea.
7. **Asset grounding.** Crop the real logo, hero imagery and icons from screenshots, using DOM rects first and a vision bounding-box pass only when the DOM gives nothing, following the screenshot-to-code pattern (MIT). Prefer DOM SVG where present. This replaces the unbuilt `addImage` generate path for redesigns.
8. **DOM to Maestro nodes.** Build a deterministic mapper modelled on `packages/import-figma`'s `map.ts`, emitting Commands rather than a JSON document.
   - Read computed styles plus `getBoundingClientRect`, and infer auto-layout from flex, gap, padding and box-sizing.
   - Fold borders into padding and convert margins to gap where uniform. Text gets FILL width and auto height.
   - **Verify and downgrade.** Re-solve the inferred layout with `packages/layout`, compare it with the captured rects, and fall back to absolute positioning only for subtrees off by more than 2px.
   - Record `maestro.source = { selector, capturedRect, confidence }` on each node.
   - Register captured web fonts through `packages/text` and record substitutions. Do not embed commercial fonts in exports.

### 3.3 `packages/audit` (new)

**Finding schema** (zod, single source):

```ts
Finding = {
  id, siteId, stateIds: string[],            // where it occurs
  category: 'ui' | 'ux_flow' | 'onboarding' | 'payment_trust' | 'forms' | 'accessibility' | 'performance' | 'content' | 'domain',
  tag: 'wrong' | 'weak' | 'taste',            // objective failure, craft, preference
  title,                                      // one line, plain
  evidence: { ruleId?, selector?, html?, measured?, threshold?, screenshotCrop?, quote? }[],
  principle,                                  // e.g. 'Nielsen #1 visibility of system status', 'WCAG 1.4.3', 'web.dev autofill'
  userImpact,                                 // one sentence, who is hurt and how
  businessImpact,                             // one sentence a founder cares about
  severity: 1 | 2 | 3 | 4,
  effort: 'S' | 'M' | 'L',
  confidence: number,                         // 0..1
  source: 'rule' | 'walker' | 'critic',
  fix,                                        // smallest concrete fix, never 'consider X'
  occurrences: number
}
```

**Deterministic layer, zero tokens:**

- axe-core 4.14 via `@axe-core/playwright` on every captured state, not just page load. Include modal-open states and form-after-empty-submit states.
- Custom form rules registered as custom axe rules:
  - missing autocomplete tokens on recognisable fields (name, email, tel, address, postal-code, cc-*, one-time-code)
  - wrong `type` or `inputmode`
  - placeholder-only labels
  - error wiring after an empty submit: `aria-invalid`, `aria-describedby` or `aria-errormessage`, focus moved to the first error, a live region
- Lighthouse 13.6 (pin the version, Node 22.19+), one run per debug port, run 3 times with the median. Use PageSpeed Insights API field data when available (free key optional). Map LCP, CLS and INP to trust and friction evidence, for example layout shift near a CTA.
- Design-discipline rules on computed styles, porting ideas from uxlint's collector (Apache-2.0) and synthux's rule packs (MIT):
  - type-scale sprawl
  - hue discipline (too many accent hues)
  - off-scale spacing and radii
  - edge alignment
  - duplicate or competing CTAs above the fold
  - nav item count over 7±2
  - heading order
  - tap targets 24 to 44px
  - contrast 4.5:1
  - console errors
  - generic labels and copy slop
- Group duplicates by rule plus a component signature, so the same failure across 40 nodes becomes one finding with `occurrences: 40`.

**Simulated walkthrough (optional per audit, one per critical flow).** Reuse the walker trace and score each step with the Avenir-UX rubric idea (Apache-2.0 per README, port to TS): SEQ, efficiency, clarity and confidence on 1 to 7, each with a one-line reason, and a friction flag at SEQ ≤ 3. The persona is applied only at scoring time, so one navigation can be re-scored for 2 to 3 personas. Show any SUS figure only as "indicative, model-derived". No persona swarms.

**Critic lenses** (judgment, `claude-code` mode by default):

- Lock a persona and the surface type first. Use lenses for UX flow, onboarding, payment trust, forms, visual craft and the domain (fintech, edtech, health and so on).
- Input is deduped failures, needs-review items and 1 to 3 crops per screen, never full raw dumps.
- Every claim needs evidence. Lead with a verdict (Ship, Tweak or Redo).
- Ban "consider X". Check a named slop list from `taste/anti-patterns.md`.
- A pruning pass keeps, drops as generic, or merges as duplicate.
- Rank by `severity × impact ÷ effort`, then produce exactly a **Top 5**.
- Also record what works, because the case study opens with credit.

**Accuracy discipline, Baymard-style.** Every deterministic rule has an id and a version. Create `tools/eval/audit/` with a gold set of 10 sites Aise grades by hand (start with 3). Report precision and recall per rule. Rules under 0.9 precision are hidden by default.

### 3.4 Redesign orchestrator (`packages/ai`)

For each picked finding:

1. Import the affected page or state as nodes (3.2 step 8).
2. Build a brief containing `mustKeepContent` (real copy), brand tokens, the cropped assets, the finding and fix, and the relevant `taste/` principles and work-library entries.
3. The model first writes a layout plan validated against the zod schema (frames, auto-layout direction, gap and padding as token refs, following the DOne paper's structure). It then builds through typed tools.
4. Add a `duplicate_subtree` tool and a `restyle_subtree` tool so captured sections are restyled, not rebuilt. Keep tool results terse: computed rects plus warnings.
5. Produce two directions: **Safe** (on-brand, fixes the lapse) and **Bold** (same tokens, stronger hierarchy).
6. **Render and look.** Render with CanvasKit, give the critic the before and after side by side, and run 1 to 3 scoped repair rounds via `runScopedEdit`. Pass the existing 7.5 threshold.
7. Show both directions in the compare grid. Aise's pick is a taste event.

Placing a candidate inserts ordinary editable nodes via `insertSubtree`. No HTML output anywhere in this path.

### 3.5 Case-study deck

Use the Granola sample Aise provided as the quality bar. It is a warm "how I use it, and what I'd love to see" walkthrough, not a roast. Build it as Maestro frames (16:10 slides) from a template in `packages/libraries`:

1. **Cover.** "How I use {Product}, and things I'd love to see." One line on who Aise is. Accent colour taken from the product's own brand.
2. **About me.** Two columns: what I use it for, and why it fits.
3. **What I noticed.** A checklist of the top 5. Items already fixed are ticked and credited, and the bigger idea is marked.
4. **Concept slides, 1 to 3.** One per picked finding. Each has the problem in one line, then the redesign in the product's own UI language with realistic sample data, numbered callouts (1, 2, 3) beside the canvas, a dashed "Concept" tag, and a footer naming it as a concept on example data.
5. **One bigger idea** (optional).
6. **Close.** An async Loom walkthrough link and a "reply on LinkedIn" line. **Never offer a call by default**, because Aise dislikes calls.
7. **Optional fun extra.** A small original sketch, never a copy of a known character.

Copy rules: short, plain, warm, no em dashes, no colon connectors, credit before critique. Export to PDF and to a static HTML page (via the existing export-code path) that can be hosted free on Vercel. Also write `case-study.md`, a text version with every finding, its evidence, the fix and the before/after image paths.

### 3.6 MCP tools (`packages/mcp`)

Add these, all zod-typed, each returning compact JSON plus file paths:

- `audit_capture({ url, allowFormFill?, headedLogin?, maxPages? })` → `siteId`, capture summary, blocked states
- `audit_run({ siteId, lenses?, persona? })` → deterministic findings, plus a materials bundle for judgment
- `audit_get_materials({ siteId, step })` → crops, deduped findings and nav map for the step Claude must judge
- `audit_submit({ siteId, step, payload })` → validates Claude's JSON (flows, critic findings, top 5) and continues the pipeline
- `audit_report({ siteId })` → the Top 5 with evidence, what works and the verdict
- `redesign_start({ siteId, findingId, direction })` / `redesign_submit_tools({ jobId, calls })` → typed tool calls applied through the CommandBus, returning rects and warnings
- `redesign_render({ jobId })` → before/after PNG paths for Claude to look at
- `case_study_build({ siteId, findingIds })` → deck frame ids, PDF path, web export path, `case-study.md`
- `taste_record({ event })`, `taste_questions({ siteId })`, `taste_eval()` (section 3.7)
- `autoapply_publish({ siteId, leadId?, draftBody })` → calls AutoApply's MCP (section 4)

Also add a `/maestro-audit` Claude Code skill in the repo that walks the whole flow: capture, run, judge, report, ask Aise to pick, redesign, render and look, case study, publish draft.

### 3.7 Taste skill (`taste/` at repo root, versioned)

```
taste/
  SKILL.md          voice, report and case-study format, which files to load when
  principles.md     Aise's rules, each with a one-line reason
  anti-patterns.md  rejections and AI-slop tells, in his words
  work-library/     his shipped work: screen, decisions, quotes, "cite when ..."
  severity.md       2 real examples per severity level
  case-study.md     voice and structure, built from the Granola sample
  eval/             frozen graded screens + expected Top 5
  CHANGELOG.md
  events.jsonl      captured signals (gitignored if he prefers)
```

- **Capture.**
  - Maestro command-log edits on AI output, as a diff summary.
  - Accept or reject on each finding.
  - Compare-grid picks.
  - Q&A answers. After each audit, ask 3 to 5 sharp questions on the least-confident findings, for example "I tagged the 3 competing CTAs as Weak. Would you call it Wrong?"
- **Distill.** A free model turns each event into a stated preference, as in the PRELUDE/CIPHER method.
- **Curate.** `maestro taste curate` proposes small diffs to the skill files. A rule becomes strong only after 3 or more events across 2 or more sites. Aise approves each diff.
- **Gate.** `taste_eval` re-runs the critic on `eval/` and measures agreement with Aise's grades. A diff is kept only if agreement improves. Use Anthropic's skill-creator eval approach (Apache-2.0).
- Keep personal taste separate from client brand choices. Never write a client's tokens into `taste/`.

### 3.8 Figma export, free

- Primary path: write a `.fig` with the vendored Open Pencil Kiwi codec (MIT, attributed per rule 11). Round-trip test it by decoding again, then open it in Figma by hand per the "look at it" rule.
- Backup path: the Maestro Bridge plugin imports a Maestro JSON export through the Plugin API. It runs as a development plugin on Figma's free plan. Add a "Send to Figma" action that writes the file or bundle and shows the steps.
- Do not use the Figma REST API to write (it can't create nodes), and do not use the paid MCP write tools.

## 4. AutoApply changes (separate repo: `~/Development/AutoApply`, follow its CLAUDE.md)

Small, additive changes:

1. New `Signal.kind` values with no schema change: `DESIGN_AUDIT` (evidence: `design_quality_score`, `top_lapses`, `audit_url`, `rubric_version`), `HIRING_DESIGNER`, `NO_DESIGN_TEAM`. Count `DESIGN_AUDIT` and `HIRING_DESIGNER` as strong evidence in `scoreLead`.
2. A design-outreach path through the fit gate, so weak-UX companies become Lead rows even without designer-role text. Do it with signals and a rubric mode, **not** a new `DESIGN_GAP` lane, because `upsert_lead` overwrites the lane.
3. A free design-signal worker after enrich, for companies with a website:
   - designer-role regex on public Greenhouse, Lever, Ashby and Workable job endpoints
   - a team-page scan for design titles
   - PageSpeed scores
   - an OSS Wappalyzer fork (enthec/webappanalyzer) for stack age
4. A rubric v3 design mode:

   | Signal | Points |
   | --- | --- |
   | Raised ≤ 90 days ago | 20 |
   | No designer on the team | 20 |
   | Visible weakness | 20 |
   | Launched ≤ 60 days ago | 15 |
   | Open design role | 15 |
   | Founder reachable | 10 |

   Gates come first: live product, Series B or earlier, 2 to 150 staff. Bands: 70+ gets a full case study, 50 to 69 gets a Loom audit, anything lower is skipped.
5. **No schema changes in this run.** Do not add an `auditUrl` field. Put the case-study URL in the existing `ProofArtifact.liveUrl` and the audit details in `Signal.evidence`. Never run `db:push`, `db:migrate` or anything else against the production database.
6. Maestro uses only existing MCP tools: `leads_inbox`, `upsert_lead`, `log_artifact` (TEARDOWN, `live_url`), `draft_outreach_email` (`artifact_id`, `draft_body`). Drafts only.
7. Do not use Apollo tools anywhere in this flow.

## 5. Phases and gates

Run the phases back to back. Each phase must pass its self-check gate before you start the next one:
- `pnpm turbo run typecheck lint test` green
- the Playwright e2e passing
- screenshots or PNGs you have actually looked at
- `docs/PROGRESS.md` and `docs/DECISIONS.md` updated
- a commit on that phase's branch
- a short entry in `docs/AUDIT_ENGINE_BUILD_LOG.md`: what was built, the test results, what you looked at, known gaps

If a gate fails and you can't fix it in a reasonable effort, record it in the build log as a known gap and continue, as long as later phases don't depend on the broken part. If they do, stop and write up the blocker.

Branches: `feat/audit-engine-phase-1` through `feat/audit-engine-phase-4`, each branched from the previous one. In AutoApply, use `feat/design-outreach-signals`.

**Phase 1: Capture and audit.**
- Build the provider modes and spend guard, `import-web` steps 1 to 7, `packages/audit` deterministic layer, the walker, the Finding schema, the MCP tools `audit_capture`, `audit_run`, `audit_get_materials`, `audit_submit` and `audit_report`, and the `/maestro-audit` skill (audit part).
- Test fixtures are local static sites in `tools/fixtures/sites/` with planted lapses: a form with no autocomplete, competing CTAs, low contrast, a broken error state and a login wall. CI never hits the live internet.
- **Done when** the fixture site yields the planted lapses in a Top 5 with evidence, and one real URL run by hand produces a cited Top 5 at $0 cash.

**Phase 2: Editable redesign.**
- Build the DOM-to-nodes mapper with verify-and-downgrade, `duplicate_subtree` and `restyle_subtree`, the redesign orchestrator, two directions, render-and-look repair, and the redesign MCP tools.
- Golden-image tests on fixture imports.
- **Done when** a redesign of a real page passes the 7.5 critic bar and its nodes are editable auto-layout (screenshot proof). First, run 3 real sites and report quality honestly.

**Phase 3: Case study and outreach.**
- Build the deck template, PDF, web export and `case-study.md`, `autoapply_publish`, and the AutoApply changes (section 4) in its own branch.
- **Done when** one lead goes from URL to an AutoApply draft with the case study attached, and nothing is sent.

**Phase 4: Taste and Figma.**
- Build the `taste/` files seeded from Aise's portfolio (aiseidahor.com, his work library), event capture, Q&A mode, curate, the eval gate, the `.fig` writer and the Bridge plugin path.
- **Done when** `taste_eval` runs on the graded set and a deck frame opens in Figma.

## 6. Quality bar

- **The case study.** Aise must be proud to send it as is, after light edits. It should look like the Granola sample: calm, credited, specific, in the product's own visual language.
- **Findings.** Each one cites evidence a founder can verify in 10 seconds.
- **Redesigns.** They must look designed, not templated. Follow `taste/anti-patterns.md`: no generic gradients, no emoji icons, no stock "AI slop" layouts.
- **Accuracy over volume.** When unsure, say less.

## 7. Working style

- Small commits on the phase branches, never on `main`. **Never push, never open a PR, never deploy.** Everything stays local until the review.
- No paid API calls at any point in the run, including for testing. Live-URL checks use `claude-code` or `free` mode only.
- When the spec is silent, match Figma or the existing Maestro behaviour, write it in `docs/DECISIONS.md`, and keep going. Flag real blockers instead of guessing.
- Never print or commit secrets. List env var names only.

## 8. Final review package (when all phases are done)

Write `docs/AUDIT_ENGINE_REVIEW.md` in Maestro containing:

1. **Summary.** What works end to end, in 5 to 10 lines.
2. **Phase table.** Phase, branch, last commit hash, gate status (pass, or pass with known gaps), tests run and their results.
3. **Demo evidence.** Paths to the PNGs you looked at: fixture audit report, real-URL Top 5, before and after redesigns, the case-study PDF, and the Figma round-trip screenshot.
4. **Honest quality notes.** The redesign critic scores per real site, where quality fell short, and what you would change.
5. **Known gaps and blockers.** Each one with its file and line, and why it was left.
6. **Risky areas for review.** Files where a bug would hurt most: the spend guard, the hard-stop wall detection, robots handling, the DOM-to-nodes mapper, the AutoApply fit-gate change.
7. **How to run it.** Exact commands for a fixture audit, a real-URL audit in `claude-code` mode, and the case-study build.
8. **Spend log.** Total model calls by provider and the estimated cost. It should be $0 for paid providers.

Then stop. Do not merge, push or deploy.
