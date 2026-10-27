import crypto from 'crypto';
import { Task, TaskAttempt, TaskEvent } from '@/types/task';
import { db } from '@/lib/db';
import { providerRegistry } from '@/lib/providers/registry';
import { resolveRouteForTask } from '@/lib/routing';
import { determineFallbackRoute } from '@/lib/routing/fallback-engine';
import { decryptSecret } from '@/lib/crypto/vault';

type EventListener = (event: TaskEvent) => void;

class TaskEventHub {
  private listeners: Map<string, Set<EventListener>> = new Map();

  public subscribe(taskId: string, listener: EventListener): () => void {
    if (!this.listeners.has(taskId)) {
      this.listeners.set(taskId, new Set());
    }
    this.listeners.get(taskId)!.add(listener);

    return () => {
      const set = this.listeners.get(taskId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(taskId);
      }
    };
  }

  public emit(event: TaskEvent): void {
    const set = this.listeners.get(event.taskId);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch {
          // ignore listener errors
        }
      }
    }
  }
}

export const taskEventHub = new TaskEventHub();

export interface CreateTaskOptions {
  userId: string;
  prompt: string;
  conversationId?: string;
  attachments?: any[];
  costPolicy?: any;
  pinnedRouteId?: string;
}

export class TaskOrchestrator {
  static async executeTask(options: CreateTaskOptions): Promise<Task> {
    const taskId = `task_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();

    // 1. Initial resolution
    const routeRes = await resolveRouteForTask(
      options.userId,
      options.prompt,
      options.attachments,
      options.costPolicy,
      options.pinnedRouteId
    );

    const initialTask: Task = {
      id: taskId,
      userId: options.userId,
      conversationId: options.conversationId,
      prompt: options.prompt,
      attachments: options.attachments || [],
      taskClass: routeRes.taskSpec.taskClass,
      taskSpec: routeRes.taskSpec,
      costPolicy: routeRes.taskSpec.costPolicy,
      status: 'running',
      decisionTrace: routeRes.decisionTrace,
      selectedRouteId: routeRes.selectedRoute.id,
      selectedModelId: routeRes.selectedModel.id,
      selectedProviderId: routeRes.selectedProvider.id,
      currentAttempt: 1,
      attempts: [],
      totalEstimatedCostUSD: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.createTask(initialTask);

    taskEventHub.emit({
      id: `evt_${crypto.randomUUID()}`,
      taskId,
      type: 'task_created',
      timestamp,
      data: { message: 'Task initialized', taskSpec: routeRes.taskSpec },
    });

    taskEventHub.emit({
      id: `evt_${crypto.randomUUID()}`,
      taskId,
      type: 'route_selected',
      timestamp: new Date().toISOString(),
      data: {
        routeId: routeRes.selectedRoute.id,
        modelId: routeRes.selectedModel.id,
        providerId: routeRes.selectedProvider.id,
        rationale: routeRes.selectionRationale,
      },
    });

    // 2. Execution loop with fallback capability
    let currentRoute = routeRes.selectedRoute;
    let currentModel = routeRes.selectedModel;
    let currentProvider = routeRes.selectedProvider;
    let attemptNum = 1;
    let fullResponse = '';
    let fullReasoning = '';
    let finalUsage: any = null;
    const excludedRoutes: string[] = [];

    const MAX_ATTEMPTS = 3;

    while (attemptNum <= MAX_ATTEMPTS) {
      const attemptStart = new Date().toISOString();
      const attemptRecord: TaskAttempt = {
        attemptNumber: attemptNum,
        routeId: currentRoute.id,
        modelId: currentModel.id,
        providerId: currentProvider.id,
        startedAt: attemptStart,
        state: 'running',
      };

      try {
        const adapter = providerRegistry.getAdapter(currentRoute.providerId);

        // Fetch decrypted BYOK key if applicable
        let apiKey: string | undefined;
        const cred = await db.getCredential(options.userId, currentRoute.providerId);
        if (cred) {
          try {
            apiKey = decryptSecret(cred.encryptedKey);
          } catch {
            // Ignore decryption failure; adapter will handle missing key
          }
        }

        taskEventHub.emit({
          id: `evt_${crypto.randomUUID()}`,
          taskId,
          type: 'execution_started',
          timestamp: new Date().toISOString(),
          data: { routeId: currentRoute.id, modelId: currentModel.id },
        });

        const execRes = await adapter.streamText(
          {
            taskId,
            route: currentRoute,
            model: currentModel,
            prompt: options.prompt,
            attachments: options.attachments,
            apiKey,
          },
          (chunk) => {
            if (chunk.type === 'delta' && chunk.deltaText) {
              fullResponse += chunk.deltaText;
              taskEventHub.emit({
                id: `evt_${crypto.randomUUID()}`,
                taskId,
                type: 'delta',
                timestamp: new Date().toISOString(),
                data: { deltaText: chunk.deltaText },
              });
            } else if (chunk.type === 'reasoning' && chunk.reasoningText) {
              fullReasoning += chunk.reasoningText;
              taskEventHub.emit({
                id: `evt_${crypto.randomUUID()}`,
                taskId,
                type: 'reasoning',
                timestamp: new Date().toISOString(),
                data: { reasoningText: chunk.reasoningText },
              });
            }
          }
        );

        // Execution succeeded!
        finalUsage = execRes.usage;
        attemptRecord.state = 'succeeded';
        attemptRecord.completedAt = new Date().toISOString();
        attemptRecord.usage = execRes.usage;
        initialTask.attempts.push(attemptRecord);

        // Record usage event
        await db.recordUsageEvent({
          id: `usage_${crypto.randomUUID()}`,
          taskId,
          userId: options.userId,
          providerId: currentProvider.id,
          modelId: currentModel.id,
          routeId: currentRoute.id,
          taskClass: initialTask.taskClass,
          costPolicy: initialTask.costPolicy,
          promptTokens: execRes.usage.promptTokens,
          completionTokens: execRes.usage.completionTokens,
          totalTokens: execRes.usage.totalTokens,
          estimatedCostUSD: execRes.usage.estimatedCostUSD,
          status: 'succeeded',
          createdAt: new Date().toISOString(),
        });

        // Update task record
        const updatedTask = await db.updateTask(taskId, {
          status: 'succeeded',
          responseOutput: fullResponse,
          reasoningOutput: fullReasoning || undefined,
          totalEstimatedCostUSD: execRes.usage.estimatedCostUSD,
          completedAt: new Date().toISOString(),
          attempts: initialTask.attempts,
        });

        taskEventHub.emit({
          id: `evt_${crypto.randomUUID()}`,
          taskId,
          type: 'task_succeeded',
          timestamp: new Date().toISOString(),
          data: { usage: execRes.usage },
        });

        return updatedTask!;
      } catch (err: any) {
        const adapter = providerRegistry.getAdapter(currentRoute.providerId);
        const normError = adapter.normalizeError(err);

        attemptRecord.state = 'failed';
        attemptRecord.completedAt = new Date().toISOString();
        attemptRecord.error = normError;
        initialTask.attempts.push(attemptRecord);
        excludedRoutes.push(currentRoute.id);

        // Check if retryable & fallback is allowed
        const fallback = await determineFallbackRoute(
          options.userId,
          routeRes.taskSpec,
          currentRoute.id,
          normError,
          initialTask.decisionTrace,
          excludedRoutes
        );

        if (fallback && attemptNum < MAX_ATTEMPTS) {
          taskEventHub.emit({
            id: `evt_${crypto.randomUUID()}`,
            taskId,
            type: 'fallback_started',
            timestamp: new Date().toISOString(),
            data: {
              routeId: fallback.nextRoute.id,
              modelId: fallback.nextModelId,
              providerId: fallback.nextProviderId,
              rationale: fallback.switchRationale,
              error: normError,
            },
          });

          // Update for next attempt
          currentRoute = fallback.nextRoute;
          const nextModel = await db.getModelById(fallback.nextModelId);
          const nextProvider = await db.getProviderById(fallback.nextProviderId);
          if (nextModel && nextProvider) {
            currentModel = nextModel;
            currentProvider = nextProvider;
          }

          initialTask.decisionTrace = fallback.updatedDecisionTrace;
          initialTask.selectedRouteId = fallback.nextRoute.id;
          initialTask.selectedModelId = fallback.nextModelId;
          initialTask.selectedProviderId = fallback.nextProviderId;
          attemptNum++;
          continue;
        }

        // No fallback possible
        await db.updateTask(taskId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          attempts: initialTask.attempts,
        });

        taskEventHub.emit({
          id: `evt_${crypto.randomUUID()}`,
          taskId,
          type: 'task_failed',
          timestamp: new Date().toISOString(),
          data: { error: normError },
        });

        throw err;
      }
    }

    throw new Error('Task execution exceeded maximum retry attempts.');
  }
}
