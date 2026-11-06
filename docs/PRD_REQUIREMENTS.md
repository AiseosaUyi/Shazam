# Shazam AI — Product Requirements (Vetting Checklist)

> **North star:** Claude-level agent experience (Code + Co-Work + Chat) running on free or BYOK models.
> This file is the source of truth for vetting every build. A feature is **not done** until each of its
> acceptance tests passes **by hand in the deployed app**, not just in unit tests.
> It supplements `01_Shazam_AI_PRD.docx`; when they conflict, this file wins.

Last QA: 2026-10-30. Score history in §9. Setup steps that need an account owner: `docs/SETUP.md`.

---

## 0. Non-negotiable rules (apply to every feature)

| ID | Rule | How to vet |
|---|---|---|
| R0.1 | **No fake success.** Never show "sent", "scheduled", "tests passed", "connected", or "file written" unless a real API, tool, or command result proves it. | Do each action with the integration disconnected. The UI must say it is not connected. |
| R0.2 | **No invented tools.** The model sees, and may name, only MCP servers, tools, and skills that are actually connected for that user. | Ask Co-Work "what tools do you have?" with none connected. It must say none. |
| R0.3 | **No invented paths or files.** Code is written only to a path the model or user named. | Ask for `src/todo.ts`. No other file (e.g. `src/App.tsx`) may be created or overwritten. |
| R0.4 | **Honest errors.** Provider errors show the real cause (auth, billing, quota, model unavailable) and a fix. | Use a free Gemini key for an image. The error must say billing is needed, not "Vertex". |
| R0.5 | **Secrets never leave the server** and are encrypted at rest: API keys, MCP tokens, OAuth refresh tokens. No keys in URL query strings. | Inspect the D1 rows and network logs. |
| R0.6 | **Human approval before outward actions** (send email, post, delete, push to git). Approval is per action. | Every send or schedule shows a confirm step. |

---

## 1. Code agent ("like Claude Code")

| ID | Requirement | Acceptance test |
|---|---|---|
| C1 | Agent uses **native tool calling** (AI SDK `inputSchema` tools / provider function calling), with the text THOUGHT/ACTION protocol only as a fallback for models without tool support. | Network log shows `tools` in the provider request for Gemini/OpenAI/Anthropic/OpenRouter. |
| C2 | Tool set at parity with OpenCode / Claude Code: `list_files`, `glob`, `search_code` (grep), `read_file` (line ranges), `edit_file` (exact string replace with fuzzy fallback), `create_file`, `run_command`, `todo_write`, `web_fetch`, `finish_task`. | The agent finishes "rename function X across the repo" without the user pasting code. |
| C3 | The agent's system prompt and tool definitions **reach the model every turn**. *(Fixed 2026-10-30: they were being dropped.)* | Unit test, plus a provider request log. |
| C4 | One model per task. No re-routing mid-loop unless the model fails, and then it is announced in the UI. *(Fixed 2026-10-30.)* | The `react_model` SSE event fires once. |
| C5 | **Real execution environment.** `run_command` runs in a real sandbox (Vercel Sandbox or E2B) or the local bridge. The bridge is called **from the browser or desktop app**, never from the server to `localhost`. | `npm test` output in the UI matches running it locally. |
| C6 | Without a sandbox or bridge, commands are reported as **NOT RUN**. *(Fixed 2026-10-30: it previously faked "All checks passed".)* | Unit test `react_engine_honesty`. |
| C7 | Writes go to the project as diffs the user can review, accept, reject, or roll back (checkpoints). Writing to the local disk requires the bridge plus approval. | Accept or reject a diff and restore a checkpoint. |
| C8 | Loop budget of at least 25 steps, with a visible step timeline (thought → tool → result) and a Stop button. | A long task does not end at step 6. |
| C9 | Repo map / index (Aider-style) is sent as context. Large repos are summarized, not truncated blindly. | A 2k-file repo still answers "where is auth handled?". |
| C10 | Git: show diff, commit, branch, open a PR (via the bridge or GitHub app) after approval. | A PR is created on a test repo. |
| C11 | Benchmark: pass at least 60% of a 20-task internal eval (small SWE-style tasks) on the default free model. Track the score per build. | `npm run eval:agent` prints the pass rate. |

### C11 agent benchmark: how to run

20 small SWE-style tasks live in `evals/agent/tasks/<name>/` (`task.json` instruction, `start/` fixtures, `solution/` reference, `check.js` deterministic checker run offline with `node` in a temp dir).

- `npm run eval:agent:dry`: no model or keys needed. Verifies every checker FAILS on `start/` and PASSES on `solution/` (20/20 required). Also runs in `npm test` (`tests/eval-agent-tasks.test.ts`).
- `npm run eval:agent`: runs the real `runToolAgent` loop per task against a local temp-dir executor, runs the checker, and prints per-task PASS/FAIL, steps, seconds and the pass rate (target >= 60%).
  - Model: default is the first free key found in `.env.local` / env (Gemini, Cerebras, OpenRouter, Groq, in that order); `--model provider/id` (e.g. `google/gemini-3.8-flash`) overrides; `--local` uses Ollama (`EVAL_LOCAL_MODEL`, default `qwen3.6:35b-a3b`).
  - Flags: `--limit N`, `--task name`, `--json out.json`, `--max-steps N` (default 25), `--min-pass 0.6` (exit 1 below the threshold; otherwise exit 0 unless the harness crashes).
- Results: every run writes `evals/agent/results/<timestamp>_<git sha>.json` (gitignored except `.gitkeep`) with the build sha, model and per-task outcome, so the score is tracked per build.


**Baseline (2026-11-06, commit f55b82d):** `npm run eval:agent -- --local` on `ollama/qwen3.6:35b-a3b` passed 19/20 (95%), 4-9 steps and 11-124 s per task. The one miss, `fix-email-regex`, still accepted `a@b..com`. **Repeat run (2026-11-06, commit 9cd913e):** same model passed 20/20 (100%), 4-10 steps and 10-60 s per task, so `fix-email-regex` is flaky rather than a fixed gap. These are small self-written tasks, so treat the number as a regression baseline, not a SWE-bench score. Cloud-model check: Gemini (`gemini-3-flash-preview`) passed 3/3 before the free daily quota ran out, so it is unscored; re-run on Gemini/Groq/Cerebras once quota or a key is available.

## 2. Co-Work ("like Claude Cowork")

| ID | Requirement | Acceptance test |
|---|---|---|
| W1 | Co-Work is an **agent loop with tools**, not regex keyword routing to canned canvases. | "Find my last 3 emails from X and summarize them" calls real Gmail tools. |
| W2 | **Email:** Gmail/Google OAuth connector. Draft, send, and reply, always with an approval step. | A test message is received at a test inbox. |
| W3 | **Scheduled email and scheduled tasks:** the user can say "send this Monday 9am" or "every Friday summarize my inbox". Each schedule is stored as a durable job (Vercel Workflow/Queues + cron trigger, or Cloudflare Workflows) with an idempotency key, can be listed, edited, paused, and cancelled, and shows a run history. | The email arrives at the scheduled time ±1 min. Cancelling it prevents the send. |
| W4 | Calendar: create, read, and find free time. | An event appears in Google Calendar. |
| W5 | Thread titles come from the user's request, never from a system prompt. *(Fixed 2026-10-30.)* | Unit test. |
| W6 | Co-Work can use any connected MCP tool (§3) and skill (§4) during its loop. | A startup MCP tool is called and its result is shown. |

## 3. MCP connectors (startup MCPs, Figma, Notion, …)

| ID | Requirement | Acceptance test |
|---|---|---|
| M1 | Adding a server **actually connects** (MCP `initialize` + `tools/list` over Streamable HTTP) and stores the real tool list. If it can't connect, the user gets an error, not placeholder tools. *(Fixed 2026-10-30.)* | Add a public test MCP. The real tool names are listed. |
| M2 | Auth tokens are encrypted at rest. *(Fixed 2026-10-30: they were stored in plain text.)* | Inspect the D1 row. |
| M3 | **OAuth 2.1 for remote MCPs** (dynamic client registration + PKCE) with refresh tokens per user. Migrate to `@modelcontextprotocol/client` v2 or `@ai-sdk/mcp`. | Connect Notion's remote MCP via OAuth. |
| M4 | **Figma:** Figma's remote MCP allow-lists clients. Apply to Figma's MCP client program. Until accepted, support Figma through the desktop bridge (local Figma MCP) or the Figma REST API with a personal token. **Do not spoof another client's name.** | Read a frame's design context from a Figma URL. |
| M5 | Tool calls at runtime: `tools/call`, with results streamed into chat. Per-tool approval for write/mutate tools. Per-server enable/disable. | Disable a server and its tools disappear from the model's tool list. |
| M6 | Block private and loopback URLs server-side (SSRF). Local MCPs are reachable only via the bridge. *(Basic guard added 2026-10-30.)* | Adding `https://127.0.0.1/mcp` is rejected. |
| M7 | Catalog of one-click connectors: Gmail, Google Calendar, Drive, Notion, Linear, GitHub, Slack, Figma, Supabase, Stripe, plus "custom MCP URL". | Each connects end to end. |

## 4. Skills

| ID | Requirement | Acceptance test |
|---|---|---|
| S1 | Skills follow the open **SKILL.md** standard (agentskills.io): a folder with YAML `name` + `description` frontmatter, a body, and optional scripts/references. | Import an existing SKILL.md folder. It appears and works. |
| S2 | Stored **server-side per user** (D1/Blob), not localStorage. Sync across devices. | Log in on a second browser. The skills are there. |
| S3 | Progressive disclosure: only `name` + `description` go into context. The full body loads when the model selects the skill. | The token count stays flat with 30 skills installed. |
| S4 | Create and edit skills in the UI, enable or disable per mode (Chat, Co-Work, Code), and version them. | Edit a skill, then roll it back. |

## 5. Image generation

| ID | Requirement | Acceptance test |
|---|---|---|
| I1 | **Prompt enhancement:** a cheap LLM rewrites the user's prompt into a structured spec (subject, style, composition, lighting, lens, text-in-image). Show the rewritten prompt. Let the user turn it off. | The rewritten prompt is visible under the image. |
| I2 | Free default is better than FLUX.1-schnell via Pollinations: Cloudflare Workers AI **FLUX.2 [klein]** (verify the request format; FLUX.2 may need multipart input) using the platform's daily free Neurons quota. | The 10-prompt benchmark set (§8) is scored by hand at ≥ 7/10 on average. |
| I3 | BYOK premium: Google **Nano Banana 2.1** (`gemini-nano-banana-2.1`), Nano Banana Pro, OpenAI image models. Error messages are correct about Gemini needing billing (no free tier). *(Error honesty fixed 2026-10-30.)* | A free key shows the billing message. A paid key generates an image. |
| I4 | Image editing: upload an image, or reference the previous image ("make her hair red"), and get an image-to-image result. | The edit keeps the subject's identity. |
| I5 | Images are saved to the user's Artifacts with prompt, model, seed, and cost. They are not base64 blobs inside chat messages. | Images survive reload. The chat payload is under 50KB. |
| I6 | The UI states which model actually produced each image (no silent substitution). | A label is shown on each image. |

## 6. Video editing

| ID | Requirement | Acceptance test |
|---|---|---|
| V1 | Upload a video (direct Blob upload, since functions cap request bodies at 4.5 MB) and get a transcript plus shot list. | A 2-minute clip is transcribed. |
| V2 | Agent edits by tool: trim, cut, concatenate, captions/subtitles, resize to 9:16 / 1:1, add music, and speed changes. Runs **ffmpeg in a sandbox** (Vercel Sandbox / E2B), not inside a serverless function. | "Cut the silences and add captions, make it 9:16" returns a playable MP4. |
| V3 | Generative or motion edits through **Remotion** compositions written by the agent. Check Remotion's license tier: it is free only for companies of up to 3 people. | The title card renders. |
| V4 | Preview before final render, plus a job status UI (durable job). | You can close the tab and the render still finishes. |

## 7. Platform

| ID | Requirement |
|---|---|
| P1 | Model picker shows only real, current, verified models. *(QA found stale "Claude 3.5 Sonnet / GPT-4o / Gemini 2.0 Flash" entries in the Code picker.)* |
| P2 | Free-only mode works with zero keys for chat and code: OpenRouter `:free`, Gemini free text tier, Cloudflare Workers AI. |
| P3 | Long tasks run as durable jobs (Workflow) and survive refreshes and function timeouts. |
| P4 | Observability: per-task trace (model, tools, tokens, cost, errors). |

## 8. QA protocol (run before every release)

1. **Code:** "Create src/todo.ts CLI + tests, run tests." Expect exactly those files, real test output (or NOT RUN), and no App.tsx.
2. **Code:** an edit task in an existing 50-file repo. Expect search → read → edit → run.
3. **Co-Work:** "What tools do you have?" with nothing connected. Expect an honest "none".
4. **Co-Work:** schedule an email to a test inbox for 2 minutes from now. Expect it to arrive, and expect it not to arrive if cancelled.
5. **MCP:** add a real public MCP. Expect real tools. Add a bogus URL. Expect an error.
6. **Image:** 10-prompt benchmark (people, hands, text-on-sign, product shot, logo, landscape, anime, 9:16 poster, edit-previous, multi-subject). Score each out of 10.
7. **Video:** trim + captions + 9:16 on a sample clip.
8. Record a score for each section in §9 and fail the release on any R0 violation.

## 10. Delegation from paid assistants (offset Claude / ChatGPT / Gemini subscriptions)

| ID | Requirement | Acceptance test |
|---|---|---|
| D1 | Shazam is a remote **MCP server** at `/api/mcp` (Streamable HTTP, stateless, `mcp-handler` 2.x). | `tools/list` returns suggest_agent, start_task, get_task_status, send_feedback, list_tasks, list/read_project_file(s), generate_image, list_pending_approvals, decide_approval. |
| D2 | Long work is **async**: start_task returns a task_id in under 1s; get_task_status shows progress, result and files; it works within Codex's 60s and Desktop's ~4 min tool limits. | A 5-minute code task completes while the client polls. |
| D3 | **Review loop**: send_feedback continues in the same project with the previous result as context. | Claude asks for a change; tests are re-run and pass. *(Verified 2026-10-30: slugify + maxLength, 18/18 tests.)* |
| D4 | Auth: personal access tokens (Claude Code, Codex, Antigravity, Cursor) **and** OAuth 2.1 (DCR + PKCE S256 + rotating refresh) for claude.ai / Claude Desktop connectors. RFC 9728 401 challenge with `resource` = MCP URL. | Connect claude.ai with the custom connector URL and run a task. |
| D5 | Live view `/runs/<id>` for every delegated run. | The link from start_task shows live steps. |
| D6 | Outward actions stay human-approved: decide_approval only after the human approves in the conversation. | Email is not sent until approved. |

## 11. Smart routing and the vetted model lineup

| ID | Requirement |
|---|---|
| M-R1 | Before running, every composer shows the **suggested agent + model + missing connections** (deterministic and instant). Suggestions for the wrong page link to the right one with the prompt prefilled. |
| M-R2 | **Fail-over chain** for every agent run: the user's routed key, then their other free keys (Gemini, Groq, Cerebras, OpenRouter), then the local model, then the free platform models. Rate limits and outages switch models per step without failing the run. *(Verified live: 5 RPM limit on Qwen3 Coder → Kimi K2.)* |
| M-R3 | A curated catalog only, with no dead or unverifiable free routes. 2026-10-30 lineup: Gemini 3.8 Flash and 3.5 Flash Lite (free AI Studio key; free-tier data may be used for training, which must be disclosed), Groq Qwen3.8-27B, Cerebras gpt-oss-120b, OpenRouter Nemotron 3 Ultra and Gemma 4 `:free`, platform Qwen3 Coder Next, Kimi K2, GLM 4.6 and gpt-oss-120b, FLUX.2 klein for images, local Qwen3.8 27B and gpt-oss 20B, plus BYOK Claude, GPT and DeepSeek. Removed: Pollinations FLUX.1 schnell, Hugging Face (no free credits), Alibaba (unverified), DALL-E 3, GPT-6 Astra, outdated local models. Re-vet quarterly. |
| M-R4 | **Local LLMs** (Ollama / LM Studio) through the desktop bridge tunnel. Only `/v1/*` on the local LLM ports is reachable. *(Verified with an LM Studio-compatible server, 17 tools passed.)* |

## 12. Devices (desktop app, CLI bridge, Chrome extension)

| ID | Requirement |
|---|---|
| B1 | Devices connect **out** (long-poll) with a one-time 8-character pairing code. Device tokens are stored hashed and can be revoked in Connections. |
| B2 | Desktop/CLI acts only inside folders the user allowed: symlink-safe path guard, secret files blocked, and risky commands (push, rm -rf, sudo, publish, deploy) need a native Allow/Deny. *(Verified: git init, commit and log ran on the Mac; push was blocked.)* |
| B3 | GitHub push and PRs from the cloud sandbox with the user's fine-grained token, passed as an env var and redacted from output. |
| B4 | Chrome extension (MV3): one dedicated agent tab, numbered elements, approval notifications before clicks and typing, never types into password or payment fields, screenshots go to Blob. **Not yet live-tested in Chrome**: load `extensions/chrome` unpacked and pair. |

## 13. Product UX and brand (vet every UI change)

| ID | Rule |
|---|---|
| U1 | **No jargon in the UI.** No "ReAct", "routes", "D1", "ledger", "smart route", "BYOK vault". Use plain verbs: "Runs on your computer", "Add key", "Free". |
| U2 | **One composer per mode**: text, a "+" menu and a model picker ("Auto" first). No mode toggles: intent is inferred (image, code, co-work), and Chat routes to Code or Co-Work automatically. |
| U3 | **No canned suggestion cards.** Empty states show a heading, one line and the live system strip. |
| U4 | **Act first, ask rarely.** Agents plan with a visible checklist and ask with `ask_user` only when the answer materially changes the result (at most 2 per task), via in-stream cards with options. |
| U5 | **No browser dialogs.** Use `useDialog()` (confirm, alert, prompt) and inline expanding rows. No `window.alert`, `confirm` or `prompt`. |
| U6 | **Shell**: the logo sits over the sidebar column; the mode switcher appears only on Chat, Co-Work and Code; account pages show "← Back to <mode>" plus the title; the profile menu is top-right; there's one profile UI, never two. |
| U7 | **Information architecture**: Connections is the single place for models, apps (Google, GitHub, MCP), devices and assistants. `/models` redirects there. Settings holds preferences and skills. Usage covers cost and limits only. |
| U8 | **Brand**: graphite neutrals and Volt `#C6F432` (to Ion `#34E1D8` for gradients) through tokens only (`bg-surface`, `text-ink-2`, `bg-brand`…), no raw hex in components. Signature elements: the live system strip, the energized composer ring, the timeline step rail, mono metadata and a dot-grid atmosphere. No all-caps labels and no emoji in UI. Distinct from Claude: no serif greeting, no flat cream surfaces. |
| U9 | **Durable work**: Code tasks run as background runs (they survive refresh, tab close and network blips), files save as they're written, and threads rebuild from runs. |
| U10 | Every screen is checked at 1440px and 390px before shipping. |

## 9. Scorecard history

| Date | Code | Co-Work | MCP | Skills | Image | Video | Overall | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-10-30 | 2 | 2 | 1 | 2 | 3 | 0 | **3/10** | Before the fixes in this commit: agent prompt was dropped, test output was faked, the App.tsx fallback overwrote files, MCP tools were fake, the image error was wrong, the email schedule was fake, and video only produced scripts. |
| 2026-10-30 (pm) | 9 | 8 | 9 | 8 | 8 | 8 | **8.5/10** (local QA) | Native tool-calling agent with real sandbox (tests fail → fix → pass, free models); Co-Work with Gmail, Calendar, schedules, approvals and a cron runner; real MCP; SKILL.md skills; FLUX.2 images; ffmpeg video; Turso adapter; device bridge; MCP server with OAuth; fail-over. **Production pending owner setup (SETUP.md).** |
| 2026-10-30 (eve) | 9 | 8.5 | 9 | 8 | 8.5 | 8 | **8.7/10** (local QA; UX ~8) | Redesign: brand and tokens, new shell, merged Connections, inline keys with validation, branded dialogs, intent auto-routing, durable Code runs with previews, local-folder mode, plan and ask_user cards. Still pending: production (owner setup), Chrome extension live test, Gmail live test. |
