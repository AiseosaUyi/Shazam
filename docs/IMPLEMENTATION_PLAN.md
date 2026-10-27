# Shazam AI — Implementation Plan

## Executive Summary

Shazam AI is a task-first, multi-provider AI workspace with intelligent routing, quota-aware fallback, cost policy enforcement, and autonomous coding agent workflows.

This implementation plan delivers a production-oriented MVP fulfilling:
- `01_Shazam_AI_PRD.docx` (Product Requirements Document)
- `02_Shazam_AI_TRD.docx` (Technical Requirements Document)
- `03_Shazam_AI_Architecture.docx` (System Architecture)
- `04_Shazam_AI_Master_Build_Prompt.md` (Implementation Specifications)

---

## Scope & Phased Roadmap

### Milestone 1 — Repository Audit, Architecture & Documentation
- [x] Audit workspace, environment tools, and specifications.
- [x] Create `docs/IMPLEMENTATION_PLAN.md`.
- [x] Create `docs/ARCHITECTURE_DECISIONS.md`.
- [x] Create `docs/PROVIDER_VERIFICATION.md`.
- [x] Define data schema, API contracts, routing algorithms, and sandbox boundaries.

### Milestone 2 — System Foundation & Core Infrastructure
- [ ] Initialize Next.js 15 App Router TypeScript project with Tailwind CSS.
- [ ] Database layer with clean schema:
  - Users, UserPreferences, Providers, ProviderCredentials, Models, ModelCapabilities, Routes, QuotaSnapshots, RouteTelemetry, Conversations, Messages, Tasks, TaskAttempts, UsageEvents, Assets, AuditEvents.
- [ ] BYOK Vault with AES-256-GCM encryption at rest, key validation, and zero client leakage.
- [ ] Authentication & session isolation (multi-tenant ready with tenant-scoped database queries).
- [ ] Responsive UI shell: Workspace, Task Composer, Model Catalogue, Connections, Usage Dashboard, Settings, Admin Portal.

### Milestone 3 — Provider Adapter Layer & Verification
- [ ] Typed `ProviderAdapter` contract interface.
- [ ] Adapters:
  - Google Gemini adapter (`gemini-2.5-flash`, `gemini-2.5-pro`) with streaming, token tracking, and free-tier detection.
  - DeepSeek adapter (`deepseek-chat`, `deepseek-reasoner` R1) with reasoning token extraction.
  - OpenRouter aggregator adapter (including `:free` tier routing and aggregator header attribution).
  - Hugging Face Inference Providers adapter.
  - OpenAI adapter (`gpt-4o`, `gpt-4o-mini`, `o3-mini`, premium reasoning).
  - Anthropic adapter (`claude-3-5-sonnet`, `claude-3-5-haiku`).
  - Qwen / Alibaba Cloud Model Studio adapter.
  - Mock/Simulation adapter for offline automated tests, determinism, and chaos testing.
- [ ] Provider error normalization (`invalid_credentials`, `rate_limited`, `quota_exhausted`, `model_unavailable`, `timeout`, etc.).
- [ ] Health checks, rate limit observability, and quota tracking.

### Milestone 4 — Intelligent Task Classifier & Routing Engine
- [ ] Intent & Task Classification:
  - Categories: Writing, General Chat, Reasoning, Planning, Coding, Document Analysis, Vision, Image Generation, Video Generation, Audio.
- [ ] Two-Stage Router:
  - Stage 1: Hard eligibility filters (modality, capabilities, cost policy, budget ceiling, region, provider status, quota cooldown, privacy).
  - Stage 2: Multi-factor scoring (Task Quality Weight $w_q$, Health $w_h$, Latency $w_l$, Cost Efficiency $w_c$, Quota Risk $w_{qta}$, Privacy $w_p$).
- [ ] Routing Policies:
  - `Free Only`: Strict zero-cost guarantee; blocking any paid or unknown route.
  - `Lowest Cost`: Minimizes estimated cost among capable routes.
  - `Balanced` (Default): Balances quality benchmark vs latency and cost.
  - `Best Quality`: Maximizes task-specific evaluation quality within user budget.
  - `Manual Pin`: Direct user-selected route with explicit override consent.
- [ ] Quota-Aware Fallback Engine:
  - Context-preserving failover on 429 / quota exhaustion / 5xx.
  - Fallback history tracing (`attempts`, `reason`, `switchRationale`).
  - Strict policy re-evaluation before fallback (never falling back to paid in Free-Only).

### Milestone 5 — Real Coding Agent (P1 Implementation)
- [ ] Virtual Isolated Workspace (disposable filesystem sandbox).
- [ ] Policy-gated tool execution:
  - `read_file`, `write_file`, `list_files`, `execute_command`, `run_tests`, `create_checkpoint`.
- [ ] Independent Policy Engine:
  - Default-deny dangerous shell commands (destructive deletion, network egress, privilege escalation).
  - Interactive approval workflow for destructive changes.
- [ ] Unified diff viewer and checkpoint rollbacks.

### Milestone 6 — Testing, Security & Verification Suite
- [ ] Automated Unit Tests:
  - Task classifier, candidate filters, score weights, cost policy enforcement, quota transitions, error normalization.
- [ ] Security Tests:
  - Free-Only zero-tolerance guardrail (preventing any paid route invocation).
  - BYOK secret redaction and zero credential leakage.
  - Prompt injection & tool permission sandboxing.
  - Tenant isolation and IDOR protections.
- [ ] Integration Tests:
  - End-to-end task execution, SSE streaming, fallback cascades, usage ledger accounting.

### Milestone 7 — Deployment Readiness & Operations
- [ ] Dockerfile and `docker-compose.yml` for turnkey deployment (Web + PostgreSQL + Redis).
- [ ] Environment configuration template (`.env.example`).
- [ ] Database seed data with verified models and benchmark weights.
- [ ] Production runbooks: incident response, secret rotation, provider outages, and admin kill switches.
