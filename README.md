# Shazam AI — Production MVP

> **Task-First, Multi-Model AI Platform with Intelligent Routing, Quota-Aware Fallbacks, and Autonomous Coding Agent Workspace.**
> Built on **Next.js 15 (App Router)**, **Cloudflare Workers** (`@opennextjs/cloudflare`), **Cloudflare D1 (SQLite)**, and **WebCrypto AES-256-GCM**.

Shazam AI allows users to access multiple AI models through a unified, high-performance interface. Instead of forcing users to guess which model or provider to choose, Shazam dynamically classifies the task, enforces strict user cost and privacy policies, and routes requests to the optimal eligible provider based on capability, latency, real task evaluation evidence, rate-limit health, and cost efficiency.

---

## ⚡ Core Architecture & Key Capabilities

### 1. Two-Stage Intelligent AI Routing Pipeline
- **Stage 1 (Hard Eligibility Filter):**
  - Binary capability and modality matching (code, reasoning, vision, documents).
  - **Strict Free-Only Policy Guarantee:** In `free_only` mode, paid or unknown-cost routes are strictly rejected. No surprise billing or silent upgrades.
  - Context window validation against request token estimates.
  - Active rate-limit cooldown and error-rate drop.
  - Credential availability check (BYOK or system default).
- **Stage 2 (Normalized Scoring Engine):**
  $$\text{Score} = w_q \cdot \text{Quality} + w_h \cdot \text{Health} + w_l \cdot \text{Latency} + w_c \cdot \text{Cost} + w_{qta} \cdot \text{QuotaConfidence} + w_p \cdot \text{Privacy}$$
  Weights are tuned according to user policy (`balanced`, `free_only`, `lowest_cost`, `best_quality`, `manual_pin`).

### 2. Multi-Provider Ecosystem & Verified Model Matrix (2026-10-27 Audit)
Built with an extensible provider adapter architecture:
- **Google Gemini:** `gemini-3.8-flash` (verified free tier / pay-as-you-go), `gemini-3.5-flash-lite` (verified free / paid tier), `gemini-4-argon` (deep reasoning & multimodal). Authenticates strictly via `x-goog-api-key` header (never in query URLs).
- **Anthropic:** `claude-sonnet-5.5`, `claude-haiku-5.5`, `claude-opus-5.5` via Messages API SSE streaming.
- **OpenAI:** `gpt-6.1-terra` (flagship reasoning), `gpt-6-luna` (high speed), `gpt-6.1-sol` (efficiency). (*Note: `gpt-6-astra` is recorded as preview/unverified and kept administratively disabled*).
- **DeepSeek:** `deepseek-v4-pro`, `deepseek-flash` with full `reasoning_content` extraction.
- **OpenRouter (Aggregator):** Verified `:free` community routes (`meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-r1:free`) with hourly D1 cache synchronization.
- **Simulation Test Provider:** Deterministic offline adapter for unit testing and CI (`SHAZAM_ENABLE_SIMULATION=true` only for offline test runs; disabled in production).

### 3. Quota-Aware Resilient Fallback Engine
- Intercepts provider 429 rate limits, 503 unavailability, and timeouts.
- Automatically places the failing route in a temporary cooldown window (supporting `Retry-After` headers).
- Re-filters remaining candidates under the same strict user policy (**Free-Only never switches to paid routes**).
- Preserves conversation and task context seamlessly without user data loss.

### 4. Model-Independent Coding Agent
- **D1 Workspace Filesystem:** Tenant-isolated workspace files stored directly in D1 with 256KB limits and strict relative-path security enforcement.
- **Safety Policy Engine:**
  - Path traversal attempts (`..`, absolute paths, leading slashes) are strictly rejected.
  - Secret files (`.env`, `*.pem`, `id_rsa`) are blocked from read/write.
  - **No Shell Execution on Host:** Shell execution is blocked with an honest container requirements disclosure (`assertNoShellExecution`).
- **Unified Diff Viewer & State Rollbacks:** Generates unified diffs and point-in-time workspace snapshots (checkpoints) with one-click restore.

### 5. BYOK Security & Key Isolation
- All user API keys are encrypted at rest using **WebCrypto AES-256-GCM** envelope encryption with random 96-bit (12-byte) IVs and 128-bit authentication tags.
- Secrets are never returned to client browsers after submission (masked as `sk-...5678`).
- Provider API calls are strictly executed server-side.
- Automated secret redactor scrubs Bearer tokens and API keys from logs and error traces.
- Tenant isolation enforced across all D1 queries using parameterized SQL with strict `user_id` bounds.

### 6. Production-Ready Image Generation Architecture
- **Unified Image Capability Registry (`src/lib/image-gen/registry.ts`):** Defines verified technical capabilities, aspect ratios (`1:1`, `16:9`, `9:16`, `4:3`), and resolutions (`1K`, `2K`, `4K`).
- **Google Nano Banana 2.1 (`gemini-3.1-flash-image`):** Official multimodal image model powered by Google AI Studio keys. Provides exceptional human anatomy, facial fidelity, and sharp typography with invisible SynthID watermarking.
- **Hosted Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`):** Serverless, zero-watermark FLUX.1 generation utilizing Cloudflare's free daily Neurons quota.
- **Pollinations FLUX.1 Schnell Gateway:** Zero-key fallback enhanced with photographic token guidance to prevent anatomical distortion.
- **Zero Silent Substitution:** If a user selects or pins a model, the orchestrator reports the exact provider, resolution, and fallback status without misrepresenting sources.

---

## 🚀 Quickstart & Local Setup

### Prerequisites
- Node.js >= 20 (Node 22 or Node 24 supported)
- npm

### 1. Installation
```bash
git clone https://github.com/shazam-ai/shazam-ai.git
cd shazam-ai
npm install
```

### 2. Environment Configuration
Create a `.dev.vars` file for local development:
```ini
# AES-256-GCM 32-byte (64-hex) encryption key for BYOK Vault
SHAZAM_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Superadmin email(s) for /admin access
ADMIN_EMAILS=admin@shazam.ai

# Optional System Default Provider Keys (Users can also connect their own keys via BYOK)
GOOGLE_AI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
OPENROUTER_API_KEY=

# Settings
SHAZAM_SHARE_SYSTEM_KEYS=false
SHAZAM_ENABLE_SIMULATION=false
SHAZAM_ALLOW_SIGNUP=true
```

### 3. Run Automated Tests
Execute the 32 comprehensive tests (Unit, Security, Policy, Agent Sandbox, Routing):
```bash
npm test
```
All 32 automated tests pass with 100% success rate:
- ✅ **Admin RBAC Security Tests** (Access control & forbidden non-admin rejection)
- ✅ **Agent Security Policy Tests** (Path traversal, secrets blocking, 256KB limits, shell prohibition, unified diff)
- ✅ **Budget & Per-Task Cap Enforcement Tests** (Task ceiling & monthly budget validation)
- ✅ **Prompt Classifier & TaskSpec Tests** (Coding, reasoning, planning, image, user overrides)
- ✅ **Fallback Behavior Tests** (Zero fallback on content policy, 401 key invalidation, 429 cooldowns)
- ✅ **Free-Only Routing Policy Tests** (Zero-cost verified free routes, paid route exclusion, empty route rejection)
- ✅ **Model Pinning Tests** (Honors pin by providerModelId, refuses fallbacks when pinned)
- ✅ **Tenant Isolation Tests** (Credentials, tasks, conversations, and workspace files)
- ✅ **WebCrypto AES-256-GCM Vault Tests** (Envelope encryption, unique IVs, tamper detection, masking, secret redaction)

### 4. Build for Cloudflare Workers
Verify the OpenNext Cloudflare Workers compilation:
```bash
npm run typecheck
npm run build:cf
```
Worker bundle compiles successfully to `.open-next/worker.js` and `.open-next/assets`.

---

## ☁️ Cloudflare Workers & D1 Deployment Runbook

### Step 1: Authenticate with Cloudflare
```bash
npx wrangler login
```
*(Or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables).*

### Step 2: Create Cloudflare D1 Database
```bash
npx wrangler d1 create shazam-db
```
Copy the returned `database_id` into `wrangler.jsonc`:
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "shazam-db",
    "database_id": "<PASTE_DATABASE_ID_HERE>",
    "migrations_dir": "migrations"
  }
]
```

### Step 3: Run Database Migrations
Apply the D1 database migrations:
```bash
# Local development test
npx wrangler d1 migrations apply shazam-db --local

# Production Cloudflare D1
npx wrangler d1 migrations apply shazam-db --remote
```

### Step 4: Configure Production Secrets
Set the required production secrets in Cloudflare Workers:
```bash
# 32-byte hex encryption key
npx wrangler secret put SHAZAM_ENCRYPTION_KEY

# Comma-separated admin emails
npx wrangler secret put ADMIN_EMAILS

# (Optional) System provider keys
npx wrangler secret put GOOGLE_AI_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

### Step 5: Deploy
Deploy the worker bundle and assets to Cloudflare:
```bash
npm run deploy
```

---

## 📚 API Surface Summary (`/api/v1`)

| Method | Path | Description | Security |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/signup` | Register new user account | Public |
| `POST` | `/api/v1/auth/login` | Authenticate user & set session cookie | Public |
| `POST` | `/api/v1/auth/logout` | Invalidate session | Public |
| `GET` | `/api/v1/auth/me` | Current authenticated user profile | User Session |
| `GET` | `/api/v1/catalog` | List all verified models, routes, and pricing schedules | Public |
| `GET` | `/api/v1/providers` | Get provider connection status with masked key hints | User Session |
| `GET/POST` | `/api/v1/credentials` | Read masked credentials or store encrypted API key via AES-256-GCM vault | User Session |
| `DELETE`| `/api/v1/credentials/:id` | Revoke a connected provider credential | User Session |
| `POST` | `/api/v1/tasks` | Create and execute an intelligent routed task (SSE streaming response) | User Session |
| `GET` | `/api/v1/tasks` | List previous user tasks | User Session |
| `GET` | `/api/v1/tasks/:id` | Retrieve task details, decision trace, and attempts | User Session |
| `POST` | `/api/v1/tasks/:id/cancel` | Cancel an in-flight task execution | User Session |
| `GET` | `/api/v1/tasks/:id/events` | SSE streaming endpoint for live tokens, reasoning, and fallbacks | User Session |
| `GET` | `/api/v1/conversations` | List conversation threads | User Session |
| `GET/POST`| `/api/v1/conversations/:id` | Get messages or add message to conversation | User Session |
| `GET` | `/api/v1/usage` | Auditable usage ledger, token counts, and budget reports | User Session |
| `GET/PATCH` | `/api/v1/settings` | Read and update routing policies, cost caps, and privacy mode | User Session |
| `POST` | `/api/v1/feedback` | Record user thumbs up/down and comment on task result | User Session |
| `GET/PUT/DELETE` | `/api/v1/workspace/files` | Manage sandboxed coding workspace files | User Session |
| `GET/POST` | `/api/v1/workspace/proposals` | Create and view diff proposals | User Session |
| `POST` | `/api/v1/workspace/proposals/:id/decide` | Approve or reject code diff proposals | User Session |
| `GET/POST` | `/api/v1/workspace/checkpoints` | Create and list workspace snapshots | User Session |
| `POST` | `/api/v1/workspace/checkpoints/:id/restore` | Rollback workspace to a previous checkpoint | User Session |
| `GET/POST` | `/api/v1/admin/overrides` | View and create route/provider emergency overrides | Admin RBAC |
| `PATCH`| `/api/v1/admin/providers/:id` | Emergency kill switch for provider routes | Admin RBAC |
| `GET` | `/api/v1/admin/audit` | View tamper-evident system audit log | Admin RBAC |

---

## 🛡️ Security & Incident Response

### 1. Emergency Provider Kill Switch
If a provider experiences degraded performance or an unannounced price hike:
1. Navigate to `/admin`.
2. Toggle the **Status** switch next to the affected route/provider.
3. The router immediately disqualifies all matching routes during Stage 1 candidate filtering.

### 2. Secret Compromise Incident Procedure
1. Rotate `SHAZAM_ENCRYPTION_KEY` using `npx wrangler secret put SHAZAM_ENCRYPTION_KEY`.
2. Invalidate all stored user credentials in D1 via an administrative query or migration.
3. Audit `/api/v1/admin/audit` and `/api/v1/usage` to verify whether anomalous token consumption occurred.
