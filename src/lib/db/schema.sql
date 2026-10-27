-- Shazam AI Database Schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    default_cost_policy VARCHAR(32) NOT NULL DEFAULT 'balanced',
    max_cost_per_task_usd NUMERIC(10, 4) NOT NULL DEFAULT 1.0000,
    monthly_budget_usd NUMERIC(10, 4) NOT NULL DEFAULT 20.0000,
    privacy_mode VARCHAR(32) NOT NULL DEFAULT 'standard',
    allowed_providers JSONB,
    disallowed_providers JSONB,
    preferred_region VARCHAR(64),
    auto_fallback_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS providers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    official_docs_url TEXT NOT NULL,
    terms_url TEXT NOT NULL,
    pricing_url TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'enabled',
    requires_api_key BOOLEAN NOT NULL DEFAULT true,
    key_instructions_url TEXT,
    last_verified_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_credentials (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    encrypted_key TEXT NOT NULL,
    key_prefix VARCHAR(32) NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'valid',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_validated_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS models (
    id VARCHAR(64) PRIMARY KEY,
    provider_id VARCHAR(64) NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    canonical_name VARCHAR(255) NOT NULL,
    provider_model_id VARCHAR(255) NOT NULL,
    modalities JSONB NOT NULL,
    context_window_tokens INTEGER NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    supports_tools BOOLEAN NOT NULL DEFAULT false,
    supports_structured_output BOOLEAN NOT NULL DEFAULT false,
    supports_streaming BOOLEAN NOT NULL DEFAULT true,
    supports_reasoning_extraction BOOLEAN NOT NULL DEFAULT false,
    license VARCHAR(255) NOT NULL,
    quality_scores JSONB NOT NULL,
    last_verified_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
    id VARCHAR(64) PRIMARY KEY,
    model_id VARCHAR(64) NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    endpoint_url TEXT,
    region VARCHAR(64) NOT NULL DEFAULT 'global',
    access_mode VARCHAR(32) NOT NULL,
    cost_class VARCHAR(32) NOT NULL,
    pricing JSONB NOT NULL,
    quota_source VARCHAR(32) NOT NULL,
    quota_confidence VARCHAR(32) NOT NULL,
    rate_limit_rpm INTEGER,
    rate_limit_tpm INTEGER,
    status VARCHAR(32) NOT NULL DEFAULT 'enabled',
    terms_status VARCHAR(32) NOT NULL DEFAULT 'approved',
    privacy_policy JSONB NOT NULL,
    last_verified_at TIMESTAMP WITH TIME ZONE NOT NULL,
    official_doc_reference TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id VARCHAR(64),
    title TEXT,
    prompt TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    task_class VARCHAR(64) NOT NULL,
    task_spec JSONB NOT NULL,
    cost_policy VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    decision_trace JSONB,
    selected_route_id VARCHAR(64) REFERENCES routes(id),
    selected_model_id VARCHAR(64) REFERENCES models(id),
    selected_provider_id VARCHAR(64) REFERENCES providers(id),
    current_attempt INTEGER NOT NULL DEFAULT 1,
    attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
    response_output TEXT,
    reasoning_output TEXT,
    total_estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    total_actual_cost_usd NUMERIC(10, 6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS usage_events (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL,
    model_id VARCHAR(64) NOT NULL,
    route_id VARCHAR(64) NOT NULL,
    task_class VARCHAR(64) NOT NULL,
    cost_policy VARCHAR(32) NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL,
    provider_reported_cost_usd NUMERIC(10, 6),
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(255) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    outcome VARCHAR(32) NOT NULL,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_routes_status ON routes(status);
