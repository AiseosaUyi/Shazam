import { getDb } from '@/lib/env';
import type {
  CostPolicy,
  DecisionTrace,
  PrivacyMode,
  ProviderError,
  TaskAttempt,
  TaskClass,
  TaskRecord,
  TaskStatus,
  User,
  UserPreferences,
} from '@/lib/types';

export class DbRepo {
  constructor(private db = getDb()) {}

  // -------------------------------------------------------------
  // USERS & AUTH
  // -------------------------------------------------------------
  async getUserCount(): Promise<number> {
    const res = await this.db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
    return res?.count ?? 0;
  }

  async createUser(user: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    role: 'user' | 'admin';
  }): Promise<User> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, status, onboarded, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`
      )
      .bind(user.id, user.email.toLowerCase().trim(), user.name.trim(), user.passwordHash, user.role, now)
      .run();

    // Default user preferences
    await this.db
      .prepare(
        `INSERT INTO user_preferences (user_id, default_cost_policy, max_cost_per_task_usd, monthly_budget_usd, privacy_mode, retention_days, auto_fallback_enabled, allow_paid_fallback, updated_at)
         VALUES (?, 'balanced', 0.25, 10.0, 'standard', 90, 1, 0, ?)`
      )
      .bind(user.id, now)
      .run();

    return {
      id: user.id,
      email: user.email.toLowerCase().trim(),
      name: user.name.trim(),
      role: user.role,
      status: 'active',
      onboarded: false,
      createdAt: now,
    };
  }

  async getUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
    const row = await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email.toLowerCase().trim())
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      role: row.role as 'user' | 'admin',
      status: row.status as 'active' | 'suspended',
      onboarded: Boolean(row.onboarded),
      createdAt: row.created_at,
    };
  }

  async getUserById(id: string): Promise<User | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as 'user' | 'admin',
      status: row.status as 'active' | 'suspended',
      onboarded: Boolean(row.onboarded),
      createdAt: row.created_at,
    };
  }

  async markUserOnboarded(userId: string): Promise<void> {
    await this.db.prepare('UPDATE users SET onboarded = 1 WHERE id = ?').bind(userId).run();
  }

  // -------------------------------------------------------------
  // SESSIONS
  // -------------------------------------------------------------
  async createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, userId, expiresAt, now)
      .run();
  }

  async getSession(tokenHash: string): Promise<{ session: { id: string; userId: string; expiresAt: string }; user: User } | null> {
    const row = await this.db
      .prepare(
        `SELECT s.id as session_id, s.user_id, s.expires_at,
                u.id, u.email, u.name, u.role, u.status, u.onboarded, u.created_at
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = ?`
      )
      .bind(tokenHash)
      .first<any>();

    if (!row) return null;

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.deleteSession(tokenHash);
      return null;
    }

    return {
      session: {
        id: row.session_id,
        userId: row.user_id,
        expiresAt: row.expires_at,
      },
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
        onboarded: Boolean(row.onboarded),
        createdAt: row.created_at,
      },
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
  }

  // -------------------------------------------------------------
  // USER PREFERENCES
  // -------------------------------------------------------------
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const row = await this.db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(userId).first<any>();
    if (!row) {
      const now = new Date().toISOString();
      return {
        defaultCostPolicy: 'balanced',
        maxCostPerTaskUSD: 0.25,
        monthlyBudgetUSD: 10.0,
        privacyMode: 'standard',
        retentionDays: 90,
        allowedProviders: null,
        preferredRegion: null,
        autoFallbackEnabled: true,
        allowPaidFallback: false,
        updatedAt: now,
      };
    }
    return {
      defaultCostPolicy: row.default_cost_policy as CostPolicy,
      maxCostPerTaskUSD: row.max_cost_per_task_usd,
      monthlyBudgetUSD: row.monthly_budget_usd,
      privacyMode: row.privacy_mode as PrivacyMode,
      retentionDays: row.retention_days,
      allowedProviders: row.allowed_providers ? JSON.parse(row.allowed_providers) : null,
      preferredRegion: row.preferred_region ?? null,
      autoFallbackEnabled: Boolean(row.auto_fallback_enabled),
      allowPaidFallback: Boolean(row.allow_paid_fallback),
      updatedAt: row.updated_at,
    };
  }

  async updateUserPreferences(userId: string, prefs: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getUserPreferences(userId);
    const updated = { ...current, ...prefs, updatedAt: new Date().toISOString() };
    await this.db
      .prepare(
        `INSERT INTO user_preferences (user_id, default_cost_policy, max_cost_per_task_usd, monthly_budget_usd, privacy_mode, retention_days, allowed_providers, preferred_region, auto_fallback_enabled, allow_paid_fallback, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           default_cost_policy = excluded.default_cost_policy,
           max_cost_per_task_usd = excluded.max_cost_per_task_usd,
           monthly_budget_usd = excluded.monthly_budget_usd,
           privacy_mode = excluded.privacy_mode,
           retention_days = excluded.retention_days,
           allowed_providers = excluded.allowed_providers,
           preferred_region = excluded.preferred_region,
           auto_fallback_enabled = excluded.auto_fallback_enabled,
           allow_paid_fallback = excluded.allow_paid_fallback,
           updated_at = excluded.updated_at`
      )
      .bind(
        userId,
        updated.defaultCostPolicy,
        updated.maxCostPerTaskUSD,
        updated.monthlyBudgetUSD,
        updated.privacyMode,
        updated.retentionDays,
        updated.allowedProviders ? JSON.stringify(updated.allowedProviders) : null,
        updated.preferredRegion,
        updated.autoFallbackEnabled ? 1 : 0,
        updated.allowPaidFallback ? 1 : 0,
        updated.updatedAt
      )
      .run();
    return updated;
  }

  // -------------------------------------------------------------
  // CREDENTIALS (BYOK)
  // -------------------------------------------------------------
  async getCredentials(userId: string): Promise<Array<{ id: string; providerId: string; keyHint: string; status: string; lastValidatedAt?: string }>> {
    const { results } = await this.db
      .prepare('SELECT id, provider_id, key_hint, status, last_validated_at FROM provider_credentials WHERE user_id = ?')
      .bind(userId)
      .all<any>();
    return results.map((r) => ({
      id: r.id,
      providerId: r.provider_id,
      keyHint: r.key_hint,
      status: r.status,
      lastValidatedAt: r.last_validated_at,
    }));
  }

  async getCredential(userId: string, providerId: string): Promise<{ id: string; encryptedKey: string; keyHint: string; status: string } | null> {
    const row = await this.db
      .prepare('SELECT id, encrypted_key, key_hint, status FROM provider_credentials WHERE user_id = ? AND provider_id = ?')
      .bind(userId, providerId)
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      encryptedKey: row.encrypted_key,
      keyHint: row.key_hint,
      status: row.status,
    };
  }

  async setCredential(cred: {
    id: string;
    userId: string;
    providerId: string;
    encryptedKey: string;
    keyHint: string;
    status?: 'valid' | 'invalid' | 'untested';
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO provider_credentials (id, user_id, provider_id, encrypted_key, key_hint, status, created_at, last_validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider_id) DO UPDATE SET
           encrypted_key = excluded.encrypted_key,
           key_hint = excluded.key_hint,
           status = excluded.status,
           last_validated_at = excluded.last_validated_at`
      )
      .bind(
        cred.id,
        cred.userId,
        cred.providerId,
        cred.encryptedKey,
        cred.keyHint,
        cred.status ?? 'valid',
        now,
        now
      )
      .run();
  }

  async deleteCredential(userId: string, providerId: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM provider_credentials WHERE user_id = ? AND provider_id = ?')
      .bind(userId, providerId)
      .run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async markCredentialStatus(userId: string, providerId: string, status: 'valid' | 'invalid'): Promise<void> {
    await this.db
      .prepare('UPDATE provider_credentials SET status = ?, last_validated_at = ? WHERE user_id = ? AND provider_id = ?')
      .bind(status, new Date().toISOString(), userId, providerId)
      .run();
  }

  // -------------------------------------------------------------
  // ROUTE HEALTH & COOLDOWNS
  // -------------------------------------------------------------
  async getRouteHealth(routeId: string, scope: string): Promise<{ cooldownUntil: string | null; consecutiveErrors: number } | null> {
    const row = await this.db
      .prepare('SELECT cooldown_until, consecutive_errors FROM route_health WHERE route_id = ? AND scope = ?')
      .bind(routeId, scope)
      .first<any>();
    if (!row) return null;
    return {
      cooldownUntil: row.cooldown_until,
      consecutiveErrors: row.consecutive_errors,
    };
  }

  async setRouteCooldown(routeId: string, scope: string, cooldownUntil: string, errorType: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO route_health (route_id, scope, cooldown_until, consecutive_errors, error_count, last_error_type, updated_at)
         VALUES (?, ?, ?, 1, 1, ?, ?)
         ON CONFLICT(route_id, scope) DO UPDATE SET
           cooldown_until = excluded.cooldown_until,
           consecutive_errors = consecutive_errors + 1,
           error_count = error_count + 1,
           last_error_type = excluded.last_error_type,
           updated_at = excluded.updated_at`
      )
      .bind(routeId, scope, cooldownUntil, errorType, now)
      .run();
  }

  async recordRouteSuccess(routeId: string, scope: string, latencyMs?: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO route_health (route_id, scope, cooldown_until, consecutive_errors, success_count, ewma_latency_ms, updated_at)
         VALUES (?, ?, NULL, 0, 1, ?, ?)
         ON CONFLICT(route_id, scope) DO UPDATE SET
           cooldown_until = NULL,
           consecutive_errors = 0,
           success_count = success_count + 1,
           ewma_latency_ms = CASE WHEN ewma_latency_ms IS NULL THEN excluded.ewma_latency_ms ELSE (ewma_latency_ms * 0.8 + excluded.ewma_latency_ms * 0.2) END,
           updated_at = excluded.updated_at`
      )
      .bind(routeId, scope, latencyMs ?? 500, now)
      .run();
  }

  // -------------------------------------------------------------
  // CONVERSATIONS & MESSAGES
  // -------------------------------------------------------------
  async getConversations(userId: string, projectId?: string | null): Promise<Array<{ id: string; projectId?: string | null; title: string; createdAt: string; updatedAt: string }>> {
    let query = 'SELECT id, project_id, title, created_at, updated_at FROM conversations WHERE user_id = ?';
    const params: any[] = [userId];

    if (projectId !== undefined) {
      if (projectId === null) {
        query += ' AND project_id IS NULL';
      } else {
        query += ' AND project_id = ?';
        params.push(projectId);
      }
    }

    query += ' ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const { results } = await stmt.bind(...params).all<any>();
    return results.map((r) => ({
      id: r.id,
      projectId: r.project_id || null,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async listConversations(userId: string, projectId?: string | null): Promise<Array<{ id: string; projectId?: string | null; title: string; createdAt: string; updatedAt: string }>> {
    return this.getConversations(userId, projectId);
  }

  async createConversation(userId: string, id: string, title: string, projectId?: string | null): Promise<{ id: string; projectId?: string | null; title: string; createdAt: string; updatedAt: string }> {
    const now = new Date().toISOString();
    await this.db
      .prepare('INSERT INTO conversations (id, user_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, userId, projectId || null, title, now, now)
      .run();
    return { id, projectId: projectId || null, title, createdAt: now, updatedAt: now };
  }

  async getConversation(userId: string, id: string): Promise<{ id: string; projectId?: string | null; title: string; createdAt: string; updatedAt: string } | null> {
    const row = await this.db
      .prepare('SELECT id, project_id, title, created_at, updated_at FROM conversations WHERE user_id = ? AND id = ?')
      .bind(userId, id)
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id || null,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deleteConversation(userId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM conversations WHERE user_id = ? AND id = ?')
      .bind(userId, id)
      .run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async setConversationProject(userId: string, id: string, projectId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE conversations SET project_id = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .bind(projectId, now, userId, id)
      .run();
  }

  async touchConversation(userId: string, id: string, title?: string): Promise<void> {
    const now = new Date().toISOString();
    if (title) {
      await this.db
        .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .bind(title, now, userId, id)
        .run();
    } else {
      await this.db
        .prepare('UPDATE conversations SET updated_at = ? WHERE user_id = ? AND id = ?')
        .bind(now, userId, id)
        .run();
    }
  }

  async getMessages(userId: string, conversationId: string): Promise<Array<{ id: string; role: 'user' | 'assistant'; content: string; reasoning?: string | null; taskId?: string | null; createdAt: string }>> {
    const { results } = await this.db
      .prepare('SELECT id, role, content, reasoning, task_id, created_at FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC')
      .bind(userId, conversationId)
      .all<any>();
    return results.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      reasoning: r.reasoning,
      taskId: r.task_id,
      createdAt: r.created_at,
    }));
  }

  async addMessage(msg: {
    id: string;
    userId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string | null;
    taskId?: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('INSERT INTO messages (id, conversation_id, user_id, role, content, reasoning, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(msg.id, msg.conversationId, msg.userId, msg.role, msg.content, msg.reasoning ?? null, msg.taskId ?? null, now)
      .run();
  }

  // -------------------------------------------------------------
  // TASKS
  // -------------------------------------------------------------
  async createTask(task: TaskRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO tasks (id, user_id, conversation_id, status, task_class, cost_policy, prompt, response, reasoning, route_id, model_id, provider_id, decision_trace, attempts, cost_usd, cost_kind, error, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        task.id,
        task.userId,
        task.conversationId,
        task.status,
        task.taskClass,
        task.costPolicy,
        task.prompt,
        task.response,
        task.reasoning,
        task.routeId,
        task.modelId,
        task.providerId,
        task.decisionTrace ? JSON.stringify(task.decisionTrace) : null,
        JSON.stringify(task.attempts || []),
        task.costUSD,
        task.costKind,
        task.error ? JSON.stringify(task.error) : null,
        task.createdAt,
        task.completedAt
      )
      .run();
  }

  async updateTask(task: TaskRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE tasks SET
           status = ?,
           response = ?,
           reasoning = ?,
           route_id = ?,
           model_id = ?,
           provider_id = ?,
           decision_trace = ?,
           attempts = ?,
           cost_usd = ?,
           cost_kind = ?,
           error = ?,
           completed_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(
        task.status,
        task.response,
        task.reasoning,
        task.routeId,
        task.modelId,
        task.providerId,
        task.decisionTrace ? JSON.stringify(task.decisionTrace) : null,
        JSON.stringify(task.attempts || []),
        task.costUSD,
        task.costKind,
        task.error ? JSON.stringify(task.error) : null,
        task.completedAt,
        task.id,
        task.userId
      )
      .run();
  }

  async getTask(userId: string, id: string): Promise<TaskRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM tasks WHERE user_id = ? AND id = ?')
      .bind(userId, id)
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      status: row.status as TaskStatus,
      taskClass: row.task_class as TaskClass,
      costPolicy: row.cost_policy as CostPolicy,
      prompt: row.prompt,
      response: row.response,
      reasoning: row.reasoning,
      routeId: row.route_id,
      modelId: row.model_id,
      providerId: row.provider_id,
      decisionTrace: row.decision_trace ? JSON.parse(row.decision_trace) : null,
      attempts: row.attempts ? JSON.parse(row.attempts) : [],
      costUSD: row.cost_usd,
      costKind: row.cost_kind,
      error: row.error ? JSON.parse(row.error) : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  async listTasks(userId: string, limit = 50): Promise<TaskRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, limit)
      .all<any>();
    return results.map((row) => ({
      id: row.id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      status: row.status as TaskStatus,
      taskClass: row.task_class as TaskClass,
      costPolicy: row.cost_policy as CostPolicy,
      prompt: row.prompt,
      response: row.response,
      reasoning: row.reasoning,
      routeId: row.route_id,
      modelId: row.model_id,
      providerId: row.provider_id,
      decisionTrace: row.decision_trace ? JSON.parse(row.decision_trace) : null,
      attempts: row.attempts ? JSON.parse(row.attempts) : [],
      costUSD: row.cost_usd,
      costKind: row.cost_kind,
      error: row.error ? JSON.parse(row.error) : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }

  // -------------------------------------------------------------
  // USAGE EVENTS & BUDGETS
  // -------------------------------------------------------------
  async recordUsageEvent(event: {
    id: string;
    userId: string;
    taskId: string;
    attempt: number;
    providerId: string;
    modelId: string;
    routeId: string;
    taskClass: string;
    costPolicy: string;
    costClass: string;
    promptTokens: number;
    completionTokens: number;
    costUSD: number;
    costKind: 'estimated' | 'unknown' | 'zero';
    tokensKind: 'provider_reported' | 'estimated';
    status: 'succeeded' | 'failed' | 'cancelled';
    errorType?: string;
    latencyMs?: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO usage_events (id, user_id, task_id, attempt, provider_id, model_id, route_id, task_class, cost_policy, cost_class, prompt_tokens, completion_tokens, cost_usd, cost_kind, tokens_kind, status, error_type, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.id,
        event.userId,
        event.taskId,
        event.attempt,
        event.providerId,
        event.modelId,
        event.routeId,
        event.taskClass,
        event.costPolicy,
        event.costClass,
        event.promptTokens,
        event.completionTokens,
        event.costUSD,
        event.costKind,
        event.tokensKind,
        event.status,
        event.errorType ?? null,
        event.latencyMs ?? null,
        now
      )
      .run();
  }

  async getMonthlySpendUSD(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startIso = startOfMonth.toISOString();

    const row = await this.db
      .prepare('SELECT SUM(cost_usd) as total FROM usage_events WHERE user_id = ? AND created_at >= ?')
      .bind(userId, startIso)
      .first<{ total: number | null }>();

    return row?.total ?? 0;
  }

  async getUsageSummary(userId: string) {
    const { results } = await this.db
      .prepare('SELECT * FROM usage_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all<any>();

    const totals = await this.db
      .prepare(
        `SELECT COUNT(*) as total_requests,
                SUM(prompt_tokens + completion_tokens) as total_tokens,
                SUM(cost_usd) as total_cost,
                SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as success_count
         FROM usage_events WHERE user_id = ?`
      )
      .bind(userId)
      .first<any>();

    return {
      totalRequests: totals?.total_requests ?? 0,
      successfulRequests: totals?.success_count ?? 0,
      totalTokens: totals?.total_tokens ?? 0,
      totalEstimatedCostUSD: totals?.total_cost ?? 0,
      recentEvents: results,
    };
  }

  // -------------------------------------------------------------
  // RATE LIMITING
  // -------------------------------------------------------------
  async checkRateLimit(key: string, windowSeconds: number, maxHits: number): Promise<{ allowed: boolean; remaining: number }> {
    const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
    await this.db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`
      )
      .bind(key, windowStart)
      .run();

    const row = await this.db
      .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
      .bind(key, windowStart)
      .first<{ count: number }>();

    const count = row?.count ?? 1;
    return {
      allowed: count <= maxHits,
      remaining: Math.max(0, maxHits - count),
    };
  }

  // -------------------------------------------------------------
  // CATALOG OVERRIDES & CACHE
  // -------------------------------------------------------------
  async getCatalogOverrides(): Promise<Array<{ targetType: 'provider' | 'route'; targetId: string; status: 'enabled' | 'disabled'; reason?: string }>> {
    const { results } = await this.db.prepare('SELECT * FROM catalog_overrides').all<any>();
    return results.map((r) => ({
      targetType: r.target_type,
      targetId: r.target_id,
      status: r.status,
      reason: r.reason,
    }));
  }

  async setCatalogOverride(type: 'provider' | 'route', id: string, status: 'enabled' | 'disabled', reason: string, updatedBy: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO catalog_overrides (target_type, target_id, status, reason, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(target_type, target_id) DO UPDATE SET
           status = excluded.status,
           reason = excluded.reason,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`
      )
      .bind(type, id, status, reason, updatedBy, now)
      .run();
  }

  async getCatalogCache(key: string): Promise<{ payload: string; syncedAt: string } | null> {
    const row = await this.db.prepare('SELECT payload, synced_at FROM catalog_cache WHERE key = ?').bind(key).first<any>();
    if (!row) return null;
    return { payload: row.payload, syncedAt: row.synced_at };
  }

  async setCatalogCache(key: string, payload: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('INSERT INTO catalog_cache (key, payload, synced_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at')
      .bind(key, payload, now)
      .run();
  }

  // -------------------------------------------------------------
  // AUDIT & FEEDBACK
  // -------------------------------------------------------------
  async recordAudit(actorId: string, action: string, targetType: string, targetId: string, outcome: string, metadata?: any): Promise<void> {
    const now = new Date().toISOString();
    const id = `aud_${crypto.randomUUID()}`;
    await this.db
      .prepare('INSERT INTO audit_events (id, actor_id, action, target_type, target_id, outcome, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, actorId, action, targetType, targetId, outcome, metadata ? JSON.stringify(metadata) : null, now)
      .run();
  }

  async recordAuditEvent(event: { id?: string; actorId: string; action: string; targetType: string; targetId: string; outcome: string; metadata?: any }): Promise<void> {
    return this.recordAudit(event.actorId, event.action, event.targetType, event.targetId, event.outcome, event.metadata);
  }

  async getAuditEvents(limit = 100) {
    const { results } = await this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
    return results;
  }

  async saveFeedback(userId: string, taskId: string, rating: -1 | 1, comment?: string): Promise<void> {
    const now = new Date().toISOString();
    const id = `fb_${crypto.randomUUID()}`;
    await this.db
      .prepare(
        `INSERT INTO feedback (id, user_id, task_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, task_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment`
      )
      .bind(id, userId, taskId, rating, comment ?? null, now)
      .run();
  }

  // -------------------------------------------------------------
  // WORKSPACE (CODING AGENT)
  // -------------------------------------------------------------
  async getWorkspaceFiles(userId: string): Promise<Array<{ path: string; content: string; updatedAt: string }>> {
    const { results } = await this.db
      .prepare('SELECT path, content, updated_at FROM workspace_files WHERE user_id = ? ORDER BY path ASC')
      .bind(userId)
      .all<any>();
    return results.map((r) => ({ path: r.path, content: r.content, updatedAt: r.updated_at }));
  }

  async getWorkspaceFile(userId: string, filePath: string): Promise<{ path: string; content: string; updatedAt: string } | null> {
    const row = await this.db
      .prepare('SELECT path, content, updated_at FROM workspace_files WHERE user_id = ? AND path = ?')
      .bind(userId, filePath)
      .first<any>();
    if (!row) return null;
    return { path: row.path, content: row.content, updatedAt: row.updated_at };
  }

  async putWorkspaceFile(userId: string, filePath: string, content: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO workspace_files (user_id, path, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      )
      .bind(userId, filePath, content, now)
      .run();
  }

  async deleteWorkspaceFile(userId: string, filePath: string): Promise<boolean> {
    const res = await this.db.prepare('DELETE FROM workspace_files WHERE user_id = ? AND path = ?').bind(userId, filePath).run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async createWorkspaceProposal(userId: string, prop: {
    id: string;
    instruction: string;
    summary: string;
    changes: Array<{ path: string; action: 'create' | 'update' | 'delete'; content?: string }>;
    taskId?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO workspace_proposals (id, user_id, instruction, summary, changes, status, task_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(prop.id, userId, prop.instruction, prop.summary, JSON.stringify(prop.changes), prop.taskId ?? null, now)
      .run();
  }

  async getWorkspaceProposal(userId: string, id: string) {
    const row = await this.db
      .prepare('SELECT * FROM workspace_proposals WHERE user_id = ? AND id = ?')
      .bind(userId, id)
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      instruction: row.instruction,
      summary: row.summary,
      changes: JSON.parse(row.changes),
      status: row.status,
      taskId: row.task_id,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    };
  }

  async getWorkspaceProposals(userId: string) {
    const { results } = await this.db
      .prepare('SELECT id, instruction, summary, status, task_id, created_at, decided_at FROM workspace_proposals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all<any>();
    return results;
  }

  async decideWorkspaceProposal(userId: string, id: string, status: 'applied' | 'rejected'): Promise<boolean> {
    const now = new Date().toISOString();
    const res = await this.db
      .prepare('UPDATE workspace_proposals SET status = ?, decided_at = ? WHERE user_id = ? AND id = ? AND status = \'pending\'')
      .bind(status, now, userId, id)
      .run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async createWorkspaceCheckpoint(userId: string, id: string, description: string, files: Record<string, string>): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('INSERT INTO workspace_checkpoints (id, user_id, description, files, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, userId, description, JSON.stringify(files), now)
      .run();
  }

  async getWorkspaceCheckpoints(userId: string) {
    const { results } = await this.db
      .prepare('SELECT id, description, created_at FROM workspace_checkpoints WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<any>();
    return results;
  }

  async getWorkspaceCheckpoint(userId: string, id: string) {
    const row = await this.db
      .prepare('SELECT * FROM workspace_checkpoints WHERE user_id = ? AND id = ?')
      .bind(userId, id)
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      description: row.description,
      files: JSON.parse(row.files),
      createdAt: row.created_at,
    };
  }

  // -------------------------------------------------------------
  // PROJECTS & PROJECT-SCOPED WORKSPACES
  // -------------------------------------------------------------
  async createProject(userId: string, proj: {
    id: string;
    name: string;
    description?: string | null;
    rootDir?: string;
    settings?: Record<string, unknown>;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO projects (id, user_id, name, description, root_dir, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        proj.id,
        userId,
        proj.name,
        proj.description ?? null,
        proj.rootDir ?? '/',
        JSON.stringify(proj.settings ?? {}),
        now,
        now
      )
      .run();
  }

  async getProjects(userId: string): Promise<Array<{
    id: string;
    userId: string;
    name: string;
    description: string | null;
    rootDir: string;
    settings: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>> {
    const { results } = await this.db
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(userId)
      .all<any>();
    return results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      description: r.description,
      rootDir: r.root_dir,
      settings: JSON.parse(r.settings || '{}'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getProject(userId: string, projectId: string) {
    const row = await this.db
      .prepare('SELECT * FROM projects WHERE user_id = ? AND id = ?')
      .bind(userId, projectId)
      .first<any>();
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      rootDir: row.root_dir,
      settings: JSON.parse(row.settings || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    // Delete conversations & files in project
    await this.db.prepare('DELETE FROM conversations WHERE user_id = ? AND project_id = ?').bind(userId, projectId).run();
    await this.db.prepare('DELETE FROM workspace_files WHERE user_id = ? AND project_id = ?').bind(userId, projectId).run();
    const res = await this.db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(userId, projectId).run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async getProjectFiles(userId: string, projectId: string): Promise<Array<{ path: string; content: string; updatedAt: string }>> {
    const { results } = await this.db
      .prepare('SELECT path, content, updated_at FROM workspace_files WHERE user_id = ? AND project_id = ? ORDER BY path ASC')
      .bind(userId, projectId)
      .all<any>();
    return results.map((r) => ({ path: r.path, content: r.content, updatedAt: r.updated_at }));
  }

  async putProjectFile(userId: string, projectId: string, filePath: string, content: string): Promise<void> {
    const now = new Date().toISOString();
    // Update project updated_at
    await this.db.prepare('UPDATE projects SET updated_at = ? WHERE user_id = ? AND id = ?').bind(now, userId, projectId).run();
    await this.db
      .prepare(
        `INSERT INTO workspace_files (user_id, project_id, path, content, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, path) DO UPDATE SET project_id = excluded.project_id, content = excluded.content, updated_at = excluded.updated_at`
      )
      .bind(userId, projectId, filePath, content, now)
      .run();
  }

  async deleteProjectFile(userId: string, projectId: string, filePath: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM workspace_files WHERE user_id = ? AND project_id = ? AND path = ?')
      .bind(userId, projectId, filePath)
      .run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async putProjectFilesBulk(userId: string, projectId: string, files: Array<{ path: string; content: string }>): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const file of files) {
      await this.db
        .prepare(
          `INSERT INTO workspace_files (user_id, project_id, path, content, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, path) DO UPDATE SET project_id = excluded.project_id, content = excluded.content, updated_at = excluded.updated_at`
        )
        .bind(userId, projectId, file.path, file.content, now)
        .run();
      count++;
    }
    await this.db.prepare('UPDATE projects SET updated_at = ? WHERE user_id = ? AND id = ?').bind(now, userId, projectId).run();
    return count;
  }

  // -------------------------------------------------------------
  // MODEL CONTEXT PROTOCOL (MCP) INTEGRATIONS
  // -------------------------------------------------------------
  async createMcpServer(userId: string, data: {
    id: string;
    name: string;
    url: string;
    transport?: string;
    encryptedAuth?: string;
    toolsCache?: any[];
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO mcp_servers (id, user_id, name, url, transport, encrypted_auth, status, tools_cache, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .bind(
        data.id,
        userId,
        data.name,
        data.url,
        data.transport || 'sse',
        data.encryptedAuth || null,
        JSON.stringify(data.toolsCache || []),
        now,
        now
      )
      .run();
  }

  async getMcpServers(userId: string): Promise<Array<{
    id: string;
    userId: string;
    name: string;
    url: string;
    transport: string;
    status: 'active' | 'disabled' | 'error';
    tools: any[];
    createdAt: string;
    updatedAt: string;
  }>> {
    const { results } = await this.db
      .prepare('SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(userId)
      .all<any>();
    return results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      url: r.url,
      transport: r.transport,
      status: r.status,
      tools: JSON.parse(r.tools_cache || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async deleteMcpServer(userId: string, id: string): Promise<boolean> {
    const res = await this.db.prepare('DELETE FROM mcp_servers WHERE user_id = ? AND id = ?').bind(userId, id).run();
    return (res?.meta?.changes ?? 0) > 0;
  }

  async updateMcpServerStatus(userId: string, id: string, status: 'active' | 'disabled' | 'error', toolsCache?: any[]): Promise<boolean> {
    const now = new Date().toISOString();
    let res;
    if (toolsCache) {
      res = await this.db
        .prepare('UPDATE mcp_servers SET status = ?, tools_cache = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .bind(status, JSON.stringify(toolsCache), now, userId, id)
        .run();
    } else {
      res = await this.db
        .prepare('UPDATE mcp_servers SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .bind(status, now, userId, id)
        .run();
    }
    return (res?.meta?.changes ?? 0) > 0;
  }
}

