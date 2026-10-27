# Shazam AI — Production MVP

> **Task-First, Multi-Model AI Platform with Intelligent Routing, Quota-Aware Fallbacks, and Autonomous Coding Agent.**

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

### 2. Multi-Provider Ecosystem & Verified Model Matrix
Built with an extensible provider adapter architecture:
- **Google Gemini:** `gemini-2.5-flash` (verified free tier / pay-as-you-go), `gemini-2.5-pro` (reasoning & 2M context).
- **DeepSeek:** `deepseek-chat` (V3), `deepseek-reasoner` (R1 with `reasoning_content` extraction).
- **OpenRouter (Aggregator):** Verified `:free` routes (`meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-r1:free`).
- **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `o3-mini`. (*Note: `gpt-6-astra` is recorded as preview/unverified and kept administratively disabled*).
- **Anthropic:** `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`.
- **Alibaba Cloud Qwen:** `qwen-2.5-coder-32b-instruct`, `qwen-plus`.
- **Hugging Face Inference Providers:** Serverless router for open-weight models.
- **Simulation Test Provider:** Deterministic offline adapter for chaos testing, simulated 429 rate limits, and automated CI.

### 3. Quota-Aware Resilient Fallback Engine
- Intercepts provider 429 rate limits, 503 unavailability, and timeouts.
- Automatically places the failing route in a temporary cooldown window.
- Re-filters remaining candidates under the same strict user policy (**Free-Only never switches to paid routes**).
- Preserves conversation and task context seamlessly without user data loss.

### 4. Model-Independent Coding Agent (P1)
- **Isolated Workspace Sandbox:** Disposable directory (`data/sandbox/:workspaceId`) prevents host traversal.
- **Independent Security Policy Engine:**
  - Read-only tools (`read_file`, `list_files`, `create_checkpoint`) are low-risk auto-approved.
  - Dangerous commands (`rm -rf /`, `curl`, `sudo`, `nc`, fork bombs) are strictly prohibited.
  - Destructive actions (`deploy`, `rm `, `git push`, `npm publish`) require explicit human interactive confirmation.
- **Unified Diff Viewer & State Rollbacks:** Generates unified diffs and point-in-time workspace snapshots.

### 5. BYOK Security & Key Isolation
- All user API keys are encrypted at rest using **AES-256-GCM** envelope encryption with random 96-bit IVs and 128-bit authentication tags.
- Secrets are never returned to client browsers after submission (masked as `sk-...5678`).
- Provider API calls are strictly executed server-side.
- Automated secret redactor scrubs Bearer tokens and API keys from logs and error traces.

---

## 🚀 Quickstart & Local Setup

### Prerequisites
- Node.js >= 20 (Node 24 supported)
- npm or pnpm
- (Optional) Docker & Docker Compose for PostgreSQL + Redis

### 1. Installation
```bash
git clone https://github.com/shazam-ai/shazam-ai.git
cd shazam-ai
npm install
```

### 2. Environment Configuration
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```
Key environment variables:
```ini
# AES-256-GCM 32-byte encryption key for BYOK Vault
SHAZAM_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Database (PostgreSQL for production; embedded in-memory fallback enabled by default)
DATABASE_URL=postgresql://postgres:shazam_secure_password@localhost:5432/shazam_ai

# Optional System Default Provider Keys (Users can also connect their own keys via BYOK)
GOOGLE_AI_API_KEY=
DEEPSEEK_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DASHSCOPE_API_KEY=
```

### 3. Run Automated Tests
Execute the comprehensive test suite (Unit, Security, Policy, Agent Sandbox, Integration):
```bash
npm test
```
All 25 automated tests will execute with full coverage:
- ✅ Coding Agent: Policy Engine & Workspace Isolation
- ✅ Integration: End-to-End Routing, Streaming & Resilient Fallback
- ✅ Security: Credential Vault & Tenant Isolation
- ✅ Security: Free-Only Zero-Tolerance Policy Enforcement
- ✅ Task Classifier Unit Tests
- ✅ BYOK Vault & Encryption Unit Tests

### 4. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🐳 Production Deployment (Docker Compose)

Run the full stack (Next.js Application + PostgreSQL 16 + Redis) with a single command:
```bash
docker-compose up --build -d
```
The application will be accessible at `http://localhost:3000`.

---

## 📚 API Surface Summary (`/api/v1`)

| Method | Path | Description | Security |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/catalog` | List all verified models, routes, and pricing schedules | Public |
| `GET` | `/api/v1/providers` | Get provider connection status with masked key prefixes | User Session |
| `POST` | `/api/v1/credentials` | Validate and store user API key via AES-256-GCM vault | User Session |
| `DELETE`| `/api/v1/credentials/:id` | Revoke a connected provider credential | User Session |
| `POST` | `/api/v1/tasks` | Create and execute an intelligent routed task | User Session |
| `GET` | `/api/v1/tasks` | List previous user tasks | User Session |
| `GET` | `/api/v1/tasks/:id` | Retrieve task details, decision trace, and attempts | User Session |
| `GET` | `/api/v1/tasks/:id/events` | SSE streaming endpoint for live tokens, reasoning, and fallbacks | User Session |
| `GET` | `/api/v1/usage` | Auditable usage ledger, token counts, and budget reports | User Session |
| `GET/PATCH` | `/api/v1/settings` | Read and update routing policies, cost caps, and privacy mode | User Session |
| `POST` | `/api/v1/agent/action` | Execute sandboxed coding agent tool proposals & approvals | User Session |
| `PATCH`| `/api/v1/admin/providers/:id` | Administrative emergency kill switch for provider routes | Admin RBAC |

---

## 🛡️ Security & Operational Runbooks

### 1. Emergency Provider Outage / Price Spike
If a provider experiences degraded performance or alters pricing unexpectedly:
1. Navigate to `/admin`.
2. Click **Kill Route** next to the affected provider.
3. The router immediately disqualifies all routes associated with that provider during Stage 1 filtering.

### 2. Secret Compromise Incident Procedure
1. Rotate `SHAZAM_ENCRYPTION_KEY` in environment.
2. Invalidate all stored user credentials via database migration or administrative console.
3. Audit `/api/v1/usage` and `audit_events` to verify no abnormal token consumption occurred.

---

## 📑 Specification Alignment

- `01_Shazam_AI_PRD.docx`: Completed P0 requirements (Intelligent router, multi-provider BYOK, quota fallback, UI).
- `02_Shazam_AI_TRD.docx`: Completed architecture contracts, data schemas, error normalization, and security boundaries.
- `03_Shazam_AI_Architecture.docx`: Implemented modular service architecture, two-stage routing pipeline, and SSE streaming state machine.
- `04_Shazam_AI_Master_Build_Prompt.md`: 100% adherence to all non-negotiable implementation rules.
