import { AuditEvent, User, UserPreference } from '@/types/user';
import { Model, Provider, ProviderCredential, Route } from '@/types/provider';
import { Task, UsageEvent } from '@/types/task';
import { RouteTelemetry } from '@/types/core';
import {
  SEED_MODELS,
  SEED_PROVIDERS,
  SEED_ROUTES,
  SEED_USER_PREFERENCES,
  SEED_USERS,
} from './seed';

class DatabaseStore {
  private users: Map<string, User> = new Map();
  private userPreferences: Map<string, UserPreference> = new Map();
  private providers: Map<string, Provider> = new Map();
  private credentials: Map<string, ProviderCredential> = new Map();
  private models: Map<string, Model> = new Map();
  private routes: Map<string, Route> = new Map();
  private routeTelemetry: Map<string, RouteTelemetry> = new Map();
  private tasks: Map<string, Task> = new Map();
  private usageEvents: UsageEvent[] = [];
  private auditEvents: AuditEvent[] = [];

  constructor() {
    this.seed();
  }

  public seed() {
    this.users.clear();
    for (const u of SEED_USERS) this.users.set(u.id, { ...u });

    this.userPreferences.clear();
    for (const p of SEED_USER_PREFERENCES) this.userPreferences.set(p.userId, { ...p });

    this.providers.clear();
    for (const prov of SEED_PROVIDERS) this.providers.set(prov.id, { ...prov });

    this.models.clear();
    for (const m of SEED_MODELS) this.models.set(m.id, { ...m });

    this.routes.clear();
    for (const r of SEED_ROUTES) {
      this.routes.set(r.id, { ...r });
      this.routeTelemetry.set(r.id, {
        routeId: r.id,
        p50LatencyMs: 800,
        p95LatencyMs: 2500,
        errorRateWindow: 0.0,
        consecutiveErrors: 0,
        lastHealthCheck: new Date().toISOString(),
        isHealthy: true,
      });
    }
  }

  // --- Users ---
  public async getUser(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  // --- User Preferences ---
  public async getUserPreference(userId: string): Promise<UserPreference> {
    const pref = this.userPreferences.get(userId);
    if (pref) return { ...pref };
    const defaultPref: UserPreference = {
      userId,
      defaultCostPolicy: 'balanced',
      maxCostPerTaskUSD: 0.50,
      monthlyBudgetUSD: 25.00,
      privacyMode: 'standard',
      autoFallbackEnabled: true,
      updatedAt: new Date().toISOString(),
    };
    this.userPreferences.set(userId, defaultPref);
    return defaultPref;
  }

  public async updateUserPreference(userId: string, updates: Partial<UserPreference>): Promise<UserPreference> {
    const current = await this.getUserPreference(userId);
    const updated: UserPreference = {
      ...current,
      ...updates,
      userId,
      updatedAt: new Date().toISOString(),
    };
    this.userPreferences.set(userId, updated);
    return updated;
  }

  // --- Providers ---
  public async getProviders(): Promise<Provider[]> {
    return Array.from(this.providers.values());
  }

  public async getProviderById(id: string): Promise<Provider | null> {
    return this.providers.get(id) || null;
  }

  public async updateProviderStatus(id: string, status: 'enabled' | 'degraded' | 'disabled'): Promise<Provider | null> {
    const p = this.providers.get(id);
    if (!p) return null;
    p.status = status;
    return { ...p };
  }

  // --- Credentials ---
  public async getCredentialsForUser(userId: string): Promise<ProviderCredential[]> {
    return Array.from(this.credentials.values()).filter((c) => c.userId === userId);
  }

  public async getCredential(userId: string, providerId: string): Promise<ProviderCredential | null> {
    const id = `${userId}:${providerId}`;
    return this.credentials.get(id) || null;
  }

  public async saveCredential(cred: ProviderCredential): Promise<ProviderCredential> {
    const id = `${cred.userId}:${cred.providerId}`;
    this.credentials.set(id, { ...cred, id });
    return { ...cred, id };
  }

  public async deleteCredential(userId: string, providerId: string): Promise<boolean> {
    const id = `${userId}:${providerId}`;
    return this.credentials.delete(id);
  }

  // --- Models ---
  public async getModels(): Promise<Model[]> {
    return Array.from(this.models.values());
  }

  public async getModelById(id: string): Promise<Model | null> {
    return this.models.get(id) || null;
  }

  // --- Routes ---
  public async getRoutes(): Promise<Route[]> {
    return Array.from(this.routes.values());
  }

  public async getRouteById(id: string): Promise<Route | null> {
    return this.routes.get(id) || null;
  }

  public async updateRouteStatus(routeId: string, status: Route['status']): Promise<Route | null> {
    const r = this.routes.get(routeId);
    if (!r) return null;
    r.status = status;
    return { ...r };
  }

  // --- Telemetry & Cooldown ---
  public async getRouteTelemetry(routeId: string): Promise<RouteTelemetry | null> {
    return this.routeTelemetry.get(routeId) || null;
  }

  public async updateRouteTelemetry(routeId: string, updates: Partial<RouteTelemetry>): Promise<void> {
    const current = this.routeTelemetry.get(routeId) || {
      routeId,
      p50LatencyMs: 1000,
      p95LatencyMs: 3000,
      errorRateWindow: 0,
      consecutiveErrors: 0,
      lastHealthCheck: new Date().toISOString(),
      isHealthy: true,
    };
    this.routeTelemetry.set(routeId, { ...current, ...updates });
  }

  public async setRouteCooldown(routeId: string, durationSeconds: number): Promise<void> {
    const cooldownUntil = new Date(Date.now() + durationSeconds * 1000).toISOString();
    await this.updateRouteTelemetry(routeId, {
      cooldownUntil,
      consecutiveErrors: (this.routeTelemetry.get(routeId)?.consecutiveErrors || 0) + 1,
    });
  }

  // --- Tasks ---
  public async createTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, { ...task });
    return { ...task };
  }

  public async getTaskById(id: string): Promise<Task | null> {
    return this.tasks.get(id) || null;
  }

  public async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const current = this.tasks.get(id);
    if (!current) return null;
    const updated: Task = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  public async listTasksForUser(userId: string, limit = 50): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // --- Usage Events ---
  public async recordUsageEvent(event: UsageEvent): Promise<UsageEvent> {
    this.usageEvents.push({ ...event });
    return event;
  }

  public async getUsageSummaryForUser(userId: string) {
    const events = this.usageEvents.filter((e) => e.userId === userId);
    let totalTokens = 0;
    let totalEstimatedCostUSD = 0;
    let totalRequests = events.length;
    let successfulRequests = 0;
    let fallbacks = 0;

    const byProvider: Record<string, { requests: number; costUSD: number; tokens: number }> = {};
    const byModel: Record<string, { requests: number; costUSD: number; tokens: number }> = {};
    const byPolicy: Record<string, number> = {};

    for (const e of events) {
      totalTokens += e.totalTokens;
      totalEstimatedCostUSD += e.estimatedCostUSD;
      if (e.status === 'succeeded') successfulRequests++;
      if (e.status === 'fallback_relegated') fallbacks++;

      // Provider aggregation
      if (!byProvider[e.providerId]) byProvider[e.providerId] = { requests: 0, costUSD: 0, tokens: 0 };
      byProvider[e.providerId].requests++;
      byProvider[e.providerId].costUSD += e.estimatedCostUSD;
      byProvider[e.providerId].tokens += e.totalTokens;

      // Model aggregation
      if (!byModel[e.modelId]) byModel[e.modelId] = { requests: 0, costUSD: 0, tokens: 0 };
      byModel[e.modelId].requests++;
      byModel[e.modelId].costUSD += e.estimatedCostUSD;
      byModel[e.modelId].tokens += e.totalTokens;

      // Policy aggregation
      byPolicy[e.costPolicy] = (byPolicy[e.costPolicy] || 0) + 1;
    }

    return {
      totalRequests,
      successfulRequests,
      fallbacks,
      totalTokens,
      totalEstimatedCostUSD,
      byProvider,
      byModel,
      byPolicy,
      events: events.slice(-50).reverse(),
    };
  }

  // --- Audit Events ---
  public async recordAuditEvent(event: AuditEvent): Promise<void> {
    this.auditEvents.push({ ...event });
  }

  public async getAuditEvents(limit = 100): Promise<AuditEvent[]> {
    return this.auditEvents.slice(-limit).reverse();
  }
}

// Global singleton instance
export const db = new DatabaseStore();
