# Shazam AI — Provider Verification & Model Audit Matrix

Last Audit Date: 2026-10-27
Status: Production-Oriented MVP Verification

> **Critical Rule:** Never infer API access or pricing from consumer chat subscriptions (e.g. ChatGPT Plus does NOT grant OpenAI API access; Claude Pro does NOT grant Anthropic API access). All routes must be independently verified. Unverified routes remain disabled.

---

## 1. Verified Provider & Route Matrix

| Provider | Provider Model ID | Canonical Name | Modality | Cost Class | Pricing (Per 1M Tokens / Units) | Quota Observability | Route Status | Notes & Verification Sources |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-2.5-flash` | Gemini 2.5 Flash | Text, Code, Vision | `verified_free` (Free Tier) / `paid` (Pay-as-you-go) | Free Tier: $0.00 (15 RPM / 1M TPM / 1500 RPD with data training)<br>Paid: ~$0.075 / 1M in, $0.30 / 1M out | `provider_reported` (HTTP response headers: `x-goog-quota-*`) | **Enabled** | [Google AI Studio Pricing](https://ai.google.dev/gemini-api/docs/pricing). Free tier consent for model improvement. |
| **Google Gemini** | `gemini-2.5-pro` | Gemini 2.5 Pro | Text, Code, Vision, Reasoning | `paid` (or limited Free tier allowance) | ~$1.25 / 1M in, $5.00 / 1M out | `provider_reported` | **Enabled** | Heavy reasoning, deep context window (up to 2M tokens). |
| **DeepSeek** | `deepseek-chat` (V3) | DeepSeek Chat V3 | Text, Code | `paid` | Input: $0.14 / 1M (cache miss), $0.014 / 1M (cache hit); Output: $0.28 / 1M | `provider_reported` (usage JSON field) | **Enabled** | [DeepSeek Pricing Docs](https://api-docs.deepseek.com/quick_start/pricing/). Extreme cost efficiency. No permanent free API tier. |
| **DeepSeek** | `deepseek-reasoner` (R1) | DeepSeek R1 | Text, Code, Deep Reasoning | `paid` | Input: $0.55 / 1M; Output: $2.19 / 1M | `provider_reported` | **Enabled** | Outputs chain-of-thought in `reasoning_content`. High mathematical and coding evaluation. |
| **OpenRouter** | `meta-llama/llama-3.3-70b-instruct:free` | Llama 3.3 70B (Free) | Text, Code | `verified_free` | $0.00 / 1M tokens | `headers` (Rate limit headers: `x-ratelimit-remaining`) | **Enabled** | [OpenRouter Free Models](https://openrouter.ai/collections/free-models). 20 req/min rate limit. Public aggregator route. |
| **OpenRouter** | `deepseek/deepseek-r1:free` | DeepSeek R1 (OpenRouter Free) | Text, Code, Reasoning | `verified_free` | $0.00 / 1M tokens | `headers` | **Enabled** | Aggregator-provided free compute route for deep reasoning. Subject to community congestion. |
| **OpenRouter** | `google/gemini-2.0-flash-exp:free` | Gemini 2.0 Flash Exp (Free) | Text, Code, Vision | `verified_free` | $0.00 / 1M tokens | `headers` | **Enabled** | Zero-cost multimodal aggregator candidate. |
| **OpenAI** | `gpt-4o-mini` | GPT-4o Mini | Text, Code, Vision | `paid` | Input: $0.15 / 1M; Output: $0.60 / 1M | `provider_reported` | **Enabled** | [OpenAI Pricing Docs](https://developers.openai.com/api/docs/pricing). Fast lightweight multi-modal. BYOK required. |
| **OpenAI** | `gpt-4o` | GPT-4o | Text, Code, Vision | `paid` | Input: $2.50 / 1M; Output: $10.00 / 1M | `provider_reported` | **Enabled** | High quality flagship general intelligence. BYOK required. |
| **OpenAI** | `o3-mini` | OpenAI o3-mini | Text, Code, STEM Reasoning | `paid` | Input: $1.10 / 1M; Output: $4.40 / 1M | `provider_reported` | **Enabled** | High-efficiency reasoning model with tier-based reasoning effort. |
| **OpenAI** | `gpt-6-astra` | GPT-6 Astra (Planning) | Reasoning, Deep Planning | `paid` | Requires enterprise/preview entitlement verification | `unknown` | **Disabled (Unverified)** | Candidate identified in preview documentation. Not enabled until verified live endpoint and account entitlement are confirmed. |
| **Anthropic** | `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet | Text, Code, Vision, Agentic | `paid` | Input: $3.00 / 1M; Output: $15.00 / 1M | `provider_reported` | **Enabled** | Leading coding and document reasoning model. BYOK required. |
| **Anthropic** | `claude-3-5-haiku-20241022` | Claude 3.5 Haiku | Text, Code | `paid` | Input: $0.80 / 1M; Output: $4.00 / 1M | `provider_reported` | **Enabled** | High-speed, cost-effective agent model. BYOK required. |
| **Alibaba Qwen** | `qwen-plus` | Qwen Plus | Text, Code, Multilingual | `paid` (with new user trial allowance) | Input: ~$0.11 / 1M; Output: ~$0.28 / 1M | `locally_estimated` | **Enabled** | [DashScope API Docs](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/). Strong East-Asian language support. |
| **Alibaba Qwen** | `qwen-2.5-coder-32b-instruct` | Qwen 2.5 Coder 32B | Code, Technical Writing | `paid` / `verified_free` via HF / OpenRouter | Depends on hosting route | `provider_reported` | **Enabled** | State of the art open code model. |
| **Hugging Face** | `Qwen/Qwen2.5-Coder-32B-Instruct` | Qwen 2.5 Coder (HF Serverless) | Code, Text | `verified_free` (Community tier) / `paid` (PRO) | Free community inference (rate-limited) | `headers` | **Enabled** | [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/index). |
| **Hugging Face** | `google/gemma-2-27b-it` | Gemma 2 27B IT | Text, Code | `verified_free` (Community tier) | Free community inference (rate-limited) | `headers` | **Enabled** | Open weights Google Gemma model hosted via HF router. |
| **Z.ai / GLM** | `glm-4-flash` | GLM 4 Flash | Text, Code | `verified_free` (in designated regions) / `paid` | Free tier for verified developers in mainland endpoints | `locally_estimated` | **Enabled** | [Zhipu AI BigModel Platform](https://open.bigmodel.cn/). |
| **Moonshot Kimi** | `moonshot-v1-8k` | Kimi Chat 8K | Text, Long Context | `paid` | Input: $1.60 / 1M; Output: $1.60 / 1M | `locally_estimated` | **Enabled** | [Moonshot Platform](https://platform.moonshot.cn/). No permanent free API tier. |
| **MiniMax** | `abab6.5s-chat` | MiniMax Hailuo | Text, Voice candidate | `paid` | Inquire / BYOK token rate | `unknown` | **Disabled (Unverified)** | Reserved for multimodal audio expansion. |
| **Kling AI** | `kling-v1` | Kling Video Gen | Video Generation | `paid` | Asynchronous per-credit / second billing | `unknown` | **Disabled (Unverified)** | Asynchronous video generation requiring dedicated webhook/polling queue and explicit payment consent. |

---

## 2. Verified Free vs Paid Rules

1. **Free Only Policy Guarantee:**
   - Any model marked `paid` or `unknown` is **strictly excluded** from candidate selection when user selects `Free Only`.
   - `verified_free` routes (e.g. Gemini Free Tier with consent, OpenRouter `:free` models, Hugging Face community tier) are permitted.
   - If an eligible `verified_free` route experiences a 429 rate limit or outage, fallback is ONLY permitted to another `verified_free` route.
   - If zero free routes remain, the task halts and provides a transparent explanation.

2. **Credential Requirements:**
   - BYOK providers (OpenAI, Anthropic, DeepSeek, Google Gemini, Qwen, OpenRouter) require the user to connect their own valid API key.
   - Saved keys are stored using AES-256-GCM encryption at rest and never exposed to client-side scripts.
