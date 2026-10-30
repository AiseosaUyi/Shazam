# Shazam AI — Product Requirements (Vetting Checklist)

> **North star:** Claude-level agent experience (Code + Co-Work + Chat) running on free or BYOK models.
> This file is the source of truth for vetting every build. A feature is **not done** until each of its
> acceptance tests passes **by hand in the deployed app**, not just in unit tests.
> It supplements `01_Shazam_AI_PRD.docx`; when they conflict, this file wins.

Last QA: 2026-10-30, against https://shazam-opal.vercel.app. Score: **3/10** (see §9).

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

## 9. Scorecard history

| Date | Code | Co-Work | MCP | Skills | Image | Video | Overall | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-10-30 | 2 | 2 | 1 | 2 | 3 | 0 | **3/10** | Before the fixes in this commit: agent prompt was dropped, test output was faked, the App.tsx fallback overwrote files, MCP tools were fake, the image error was wrong, the email schedule was fake, and video only produced scripts. |
