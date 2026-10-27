# Shazam AI — Architecture Decision Records (ADR)

## AD-001: Next.js 15 Full-Stack Monolith with Modular Service Architecture
- **Status:** Accepted
- **Context:** Shazam AI requires high-performance web UI, Server-Sent Events (SSE) streaming, server-side API credential isolation, and fast iterations.
- **Decision:** Build a Next.js 15 App Router TypeScript application with cleanly partitioned internal domain modules (`src/lib/routing/`, `src/lib/providers/`, `src/lib/crypto/`, `src/lib/db/`, `src/lib/agent/`). Long-running media/agent jobs run via async job handlers with durable state.
- **Consequence:** Simplifies operational complexity, single repo deployment, eliminates cross-service network latency for router decisions, while maintaining strict domain encapsulation.

---

## AD-002: Dual-Driver Database Layer (PostgreSQL Primary + In-Memory / SQLite Test Harness)
- **Status:** Accepted
- **Context:** Production environments require PostgreSQL with strict foreign keys, indexing, and transactional isolation. Automated CI and local development require fast setup without external dependency barriers.
- **Decision:** Implement a database access layer with a consistent repository pattern supporting PostgreSQL in production (via pg/Prisma/SQL migrations) and an embedded zero-friction SQLite/in-memory driver for headless test execution.
- **Consequence:** 100% test reproducibility across environments with zero prerequisite daemons; production targets managed PostgreSQL.

---

## AD-003: Route as First-Class Entity (Separating Model from Route)
- **Status:** Accepted
- **Context:** The same underlying model (e.g. Llama 3.3 70B, Qwen 2.5 72B, DeepSeek V3) can be hosted by multiple distinct providers (e.g. OpenRouter, Hugging Face, DeepSeek direct, Alibaba DashScope) with drastically different cost classes, rate limits, data retention policies, and latency profiles.
- **Decision:** Model entity stores canonical attributes (context size, modalities, benchmark ratings). Route entity stores provider-specific endpoints, access modes (`direct_api`, `aggregator`, `byok`), pricing schedules, quota types, and regions.
- **Consequence:** The router selects the optimal **Route**, not merely a model name.

---

## AD-004: Two-Stage Routing Pipeline (Hard Eligibility Filters followed by Task-Weighted Scoring)
- **Status:** Accepted
- **Context:** An AI platform must guarantee compliance with user budgets, privacy policies, modality constraints, and rate limits. A high benchmark score must never override an incompatible cost or capability constraint.
- **Decision:**
  1. **Stage 1 (Hard Filters):** Candidate routes are evaluated against binary requirements: Modality match, Required capabilities (tools, code, vision), User cost policy, Budget ceiling, Regional compliance, Provider health status, Active rate-limit cooldown, and Credential availability. Failing routes are strictly dropped.
  2. **Stage 2 (Scoring):** Surviving candidates are ranked using normalized, task-specific evaluation weights:
     $$\text{Score} = w_q \cdot \text{Quality} + w_h \cdot \text{Health} + w_l \cdot \text{LatencyScore} + w_c \cdot \text{CostScore} + w_{qta} \cdot \text{QuotaConfidence} + w_p \cdot \text{PrivacyFit}$$
- **Consequence:** Prevents cost/capability/privacy violations while providing predictable, explainable routing decisions.

---

## AD-005: Strict Backend Cost Policy Enforcement (Free-Only Zero-Tolerance Guardrail)
- **Status:** Accepted
- **Context:** Users selecting "Free Only" must have absolute assurance that no surprise charges or paid API routes will be executed.
- **Decision:** All cost policy checks are enforced in the server-side router. In `free_only` mode:
  - Only routes with `cost_class === 'verified_free'` or an active `user_allowance` are eligible.
  - Any route with `paid` or `unknown` pricing is blocked.
  - Fallbacks during a `free_only` task can ONLY select alternative `verified_free` routes. If no free route remains, the task halts with a clear explanation rather than switching to paid.
- **Consequence:** Complete user trust and zero unexpected charges.

---

## AD-006: BYOK-First Security Model with AES-256-GCM Envelope Encryption & Secret Redaction
- **Status:** Accepted
- **Context:** Users connect their own provider API keys. If keys leak, users suffer financial and security damages.
- **Decision:**
  - Keys are encrypted at rest using AES-256-GCM with unique initialization vectors (IVs) and authentication tags.
  - Plaintext keys are never returned to client browsers after submission (masked as `sk-...abcd`).
  - Provider API calls are strictly executed server-side.
  - Logging infrastructure redacts authorization headers, API keys, and sensitive tokens automatically.
- **Consequence:** Production-grade key security meeting enterprise standards.

---

## AD-007: Event-Driven SSE Streaming with Resilient State Machine & Fallback Preservation
- **Status:** Accepted
- **Context:** Streaming text token by token is essential for user experience. When a provider fails midway (e.g. 429 rate limit or network drop), the user must not lose their task context.
- **Decision:** Implement Server-Sent Events (`/api/v1/tasks/:id/events`) backed by a durable task state machine (`created` $\to$ `classified` $\to$ `routing` $\to$ `running` $\to$ `streaming` $\to$ `succeeded` / `retry_wait` $\to$ `failed`). If a provider errors, the engine records the attempt, performs an eligible fallback, and sends a `route_switched` event to the client with the rationale.
- **Consequence:** Seamless resilience against intermittent provider rate limits.

---

## AD-008: Policy-Gated Virtual Sandboxing for Coding Agent Workspaces
- **Status:** Accepted
- **Context:** Coding agents execute file modifications, dependency installations, and shell commands. Executing arbitrary untrusted code directly on host servers risks complete system compromise.
- **Decision:**
  - Isolate coding tasks in scoped, disposable workspace directories.
  - Model tool proposals are intercepted by an independent deterministic policy engine.
  - High-risk operations (destructive file removal, external network downloads, deployment commands) require explicit human approval.
  - All outputs and diffs are captured, redacted, and presented in interactive UI controls.
- **Consequence:** Safe, productive agent execution without host risk.
