import { DbRepo } from '@/lib/db/repo';
import { classifyPrompt } from '@/lib/routing/classifier';
import { resolveTaskRoute, determineFallback, type RouteResolution } from '@/lib/routing/router';
import { dispatchExecution } from './dispatcher';
import { decryptSecret } from '@/lib/crypto/vault';
import { envFlag, envVar } from '@/lib/env';
import { buildProjectIndex } from '@/lib/agent/indexer';
import type {
  CostPolicy,
  TaskClass,
  TaskRecord,
  TaskAttempt,
  User,
  ChatMessage,
  StreamChunk,
} from '@/lib/types';

export interface RunTaskOptions {
  user: User;
  prompt: string;
  conversationId?: string;
  projectId?: string;
  costPolicy?: CostPolicy;
  taskClassOverride?: TaskClass;
  pinnedModelName?: string;
  signal?: AbortSignal;
  repo?: DbRepo;
  onEvent: (event: string, data: any) => void;
}

export async function runTaskOrchestrator(options: RunTaskOptions): Promise<void> {
  const {
    user,
    prompt,
    costPolicy: requestedCostPolicy,
    taskClassOverride,
    pinnedModelName,
    projectId,
    signal,
    onEvent,
  } = options;

  const repo = options.repo || new DbRepo();

  // 1. Resolve or create conversation & attach project context
  let conversationId = options.conversationId;
  let history: ChatMessage[] = [];
  let projectContextBlock = '';

  if (conversationId) {
    let conv = await repo.getConversation(user.id, conversationId);
    if (!conv) {
      const title = prompt.trim().slice(0, 45) || 'New Conversation';
      await repo.createConversation(user.id, conversationId, title, projectId);
      conv = await repo.getConversation(user.id, conversationId);
    } else if (projectId && !conv.projectId) {
      await repo.setConversationProject(user.id, conversationId, projectId);
      conv.projectId = projectId;
    }

    if (conv) {
      const msgs = await repo.getMessages(user.id, conversationId);
      history = msgs.slice(-20).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // If conversation is scoped to a project, inject real project files from D1
      const activeProjId = conv.projectId || projectId;
      if (activeProjId) {
        try {
          const project = await repo.getProject(user.id, activeProjId);
          const files = await repo.getProjectFiles(user.id, activeProjId);
          if (files && files.length > 0) {
            const index = buildProjectIndex(files);
            projectContextBlock = `[Project Context: ${project?.name || 'Workspace'}]\n${index.summaryPrompt}`;
          } else if (project) {
            projectContextBlock = `[Project Context: ${project.name}]\nProject Name: ${project.name}${project.description ? `\nDescription: ${project.description}` : ''}`;
          }
        } catch {
          // ignore
        }
      }
    }
  } else {
    conversationId = crypto.randomUUID();
    const title = prompt.trim().slice(0, 45) || 'New Conversation';
    await repo.createConversation(user.id, conversationId, title, projectId);
    if (projectId) {
      try {
        const project = await repo.getProject(user.id, projectId);
        const files = await repo.getProjectFiles(user.id, projectId);
        if (files && files.length > 0) {
          const index = buildProjectIndex(files);
          projectContextBlock = `[Project Context: ${project?.name || 'Workspace'}]\n${index.summaryPrompt}`;
        } else if (project) {
          projectContextBlock = `[Project Context: ${project.name}]\nProject Name: ${project.name}${project.description ? `\nDescription: ${project.description}` : ''}`;
        }
      } catch {
        // ignore
      }
    }
  }

  // Prepend project context if not already in prompt
  const effectivePrompt = projectContextBlock && !prompt.includes('File: ')
    ? `${projectContextBlock}\n\n[User Instruction]:\n${prompt}`
    : prompt;

  // 2. User preferences & monthly budget calculation
  const preferences = await repo.getUserPreferences(user.id);
  const monthlySpend = await repo.getMonthlySpendUSD(user.id);
  const monthlyRemaining = Math.max(0, preferences.monthlyBudgetUSD - monthlySpend);

  // 3. Prompt classification & TaskSpec construction
  const classified = classifyPrompt(prompt, taskClassOverride);
  const costPolicy = requestedCostPolicy || preferences.defaultCostPolicy;

  const taskSpec = {
    ...classified,
    costPolicy,
    privacyMode: preferences.privacyMode,
    maxCostUSD: preferences.maxCostPerTaskUSD,
    monthlyBudgetRemainingUSD: monthlyRemaining,
    pinnedRouteId: pinnedModelName || null,
    allowedProviders: preferences.allowedProviders,
  };

  // 4. Initial Route Resolution
  let currentResolution: RouteResolution;
  try {
    currentResolution = await resolveTaskRoute(taskSpec, user, repo);
  } catch (err: any) {
    onEvent('error', { message: err.message || 'Routing failed.' });
    throw err;
  }

  // 5. Create Task in D1
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  const taskRecord: TaskRecord = {
    id: taskId,
    userId: user.id,
    conversationId: conversationId || null,
    status: 'running',
    taskClass: taskSpec.taskClass,
    costPolicy: taskSpec.costPolicy,
    prompt,
    response: null,
    reasoning: null,
    routeId: currentResolution.selectedRoute.id,
    modelId: currentResolution.selectedModel.id,
    providerId: currentResolution.selectedProvider.id,
    decisionTrace: currentResolution.decisionTrace,
    attempts: [],
    costUSD: 0,
    costKind: 'zero',
    error: null,
    createdAt: now,
    completedAt: null,
  };

  await repo.createTask(taskRecord);

  // Emit SSE creation & route disclosure
  onEvent('task_created', {
    taskId,
    conversationId,
    prompt,
    taskClass: taskSpec.taskClass,
    costPolicy: taskSpec.costPolicy,
  });

  onEvent('route_selected', {
    route: currentResolution.selectedRoute,
    model: currentResolution.selectedModel,
    provider: currentResolution.selectedProvider,
    decisionTrace: currentResolution.decisionTrace,
    why: currentResolution.rationale,
  });

  // 6. Execution Loop with Fallback (max 3 attempts)
  const attempts: TaskAttempt[] = [];
  const excludedRouteIds: string[] = [];
  let attemptNumber = 1;
  const maxAttempts = 3;

  while (attemptNumber <= maxAttempts) {
    if (signal?.aborted) {
      taskRecord.status = 'cancelled';
      taskRecord.completedAt = new Date().toISOString();
      await repo.updateTask(taskRecord);
      onEvent('error', { message: 'Task cancelled by user.' });
      return;
    }

    const { selectedRoute, selectedModel, selectedProvider } = currentResolution;
    const attemptStart = Date.now();

    // Retrieve API key
    let apiKey = '';
    const userCred = await repo.getCredential(user.id, selectedRoute.providerId);
    if (userCred && userCred.status === 'valid') {
      apiKey = await decryptSecret(userCred.encryptedKey);
    } else {
      const canUseSystemKeys = user.role === 'admin' || envFlag('SHAZAM_SHARE_SYSTEM_KEYS', false);
      if (canUseSystemKeys) {
        if (selectedRoute.providerId === 'google') {
          apiKey = envVar('GOOGLE_AI_API_KEY') || envVar('GOOGLE_API_KEY') || '';
        } else if (selectedRoute.providerId === 'openai') {
          apiKey = envVar('OPENAI_API_KEY') || '';
        } else if (selectedRoute.providerId === 'anthropic') {
          apiKey = envVar('ANTHROPIC_API_KEY') || '';
        } else if (selectedRoute.providerId === 'deepseek') {
          apiKey = envVar('DEEPSEEK_API_KEY') || '';
        } else if (selectedRoute.providerId === 'openrouter') {
          apiKey = envVar('OPENROUTER_API_KEY') || '';
        }
      }
      if (selectedRoute.providerId === 'simulation') {
        apiKey = 'simulation';
      } else if (selectedRoute.providerId === 'pollinations' || !selectedProvider.requiresApiKey) {
        apiKey = 'free_tier';
      }
    }

    if (!apiKey && selectedProvider.requiresApiKey) {
      const err = new Error(`No API key available for provider "${selectedProvider.name}".`);
      taskRecord.status = 'failed';
      taskRecord.error = {
        type: 'invalid_credentials',
        message: err.message,
        retryable: false,
      };
      taskRecord.completedAt = new Date().toISOString();
      await repo.updateTask(taskRecord);
      onEvent('error', { message: err.message });
      return;
    }

    try {
      const result = await dispatchExecution({
        model: selectedModel,
        route: selectedRoute,
        prompt: effectivePrompt,
        history,
        apiKey,
        signal,
        onChunk: (chunk: StreamChunk) => {
          if (chunk.type === 'delta') {
            onEvent('delta', { text: chunk.text });
          } else if (chunk.type === 'reasoning') {
            onEvent('reasoning', { text: chunk.text });
          }
        },
      });

      const latencyMs = Date.now() - attemptStart;

      // Successful attempt
      attempts.push({
        attempt: attemptNumber,
        routeId: selectedRoute.id,
        modelId: selectedModel.id,
        providerId: selectedRoute.providerId,
        startedAt: new Date(attemptStart).toISOString(),
        completedAt: new Date().toISOString(),
        state: 'succeeded',
        latencyMs,
        usage: result.usage,
        costUSD: result.costUSD,
      });

      // Record in D1 usage ledger
      await repo.recordUsageEvent({
        id: crypto.randomUUID(),
        userId: user.id,
        taskId,
        attempt: attemptNumber,
        providerId: selectedRoute.providerId,
        modelId: selectedModel.id,
        routeId: selectedRoute.id,
        taskClass: taskSpec.taskClass,
        costPolicy: taskSpec.costPolicy,
        costClass: selectedRoute.costClass,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        costUSD: result.costUSD,
        costKind: result.costKind,
        tokensKind: result.usage.tokensKind,
        status: 'succeeded',
        latencyMs,
      });

      // Update Task in D1
      taskRecord.status = 'succeeded';
      taskRecord.response = result.fullText;
      taskRecord.reasoning = result.reasoning || null;
      taskRecord.attempts = attempts;
      taskRecord.costUSD = result.costUSD;
      taskRecord.costKind = result.costKind;
      taskRecord.completedAt = new Date().toISOString();
      await repo.updateTask(taskRecord);

      // Persist messages in conversation
      await repo.addMessage({
        id: crypto.randomUUID(),
        userId: user.id,
        conversationId: conversationId!,
        role: 'user',
        content: prompt,
        taskId,
      });

      await repo.addMessage({
        id: crypto.randomUUID(),
        userId: user.id,
        conversationId: conversationId!,
        role: 'assistant',
        content: result.fullText,
        reasoning: result.reasoning,
        taskId,
      });

      let cleanTitle = prompt.trim();
      if (cleanTitle.includes('[User Request]:\n')) {
        cleanTitle = cleanTitle.split('[User Request]:\n')[1]?.trim() || cleanTitle;
      }
      if (cleanTitle.includes('User Request:\n')) {
        cleanTitle = cleanTitle.split('User Request:\n')[1]?.trim() || cleanTitle;
      }
      if (cleanTitle.startsWith('[Autonomous Co-Work Mode]\n')) {
        cleanTitle = cleanTitle.replace('[Autonomous Co-Work Mode]\n', '').trim();
      }
      cleanTitle = cleanTitle.slice(0, 45) || 'New Conversation';

      const conv = await repo.getConversation(user.id, conversationId!);
      const shouldUpdateTitle = !conv || !conv.title || conv.title === 'New Conversation' || conv.title === 'New Co-Work Session';
      await repo.touchConversation(user.id, conversationId!, shouldUpdateTitle ? cleanTitle : undefined);

      // Emit SSE done event
      onEvent('done', {
        taskId,
        fullText: result.fullText,
        reasoning: result.reasoning,
        usage: result.usage,
        costUSD: result.costUSD,
        costKind: result.costKind,
      });

      return;
    } catch (err: any) {
      const latencyMs = Date.now() - attemptStart;

      if (signal?.aborted) {
        taskRecord.status = 'cancelled';
        taskRecord.completedAt = new Date().toISOString();
        await repo.updateTask(taskRecord);
        onEvent('error', { message: 'Task cancelled by user.' });
        return;
      }

      attempts.push({
        attempt: attemptNumber,
        routeId: selectedRoute.id,
        modelId: selectedModel.id,
        providerId: selectedRoute.providerId,
        startedAt: new Date(attemptStart).toISOString(),
        completedAt: new Date().toISOString(),
        state: 'failed',
        error: {
          type: err.type || 'provider_error',
          message: err.message || 'Execution error',
          statusCode: err.statusCode,
          retryable: Boolean(err.retryable),
        },
        latencyMs,
      });

      await repo.recordUsageEvent({
        id: crypto.randomUUID(),
        userId: user.id,
        taskId,
        attempt: attemptNumber,
        providerId: selectedRoute.providerId,
        modelId: selectedModel.id,
        routeId: selectedRoute.id,
        taskClass: taskSpec.taskClass,
        costPolicy: taskSpec.costPolicy,
        costClass: selectedRoute.costClass,
        promptTokens: 0,
        completionTokens: 0,
        costUSD: 0,
        costKind: 'zero',
        tokensKind: 'estimated',
        status: 'failed',
        errorType: err.type || 'unknown_error',
        latencyMs,
      });

      excludedRouteIds.push(selectedRoute.id);

      // Check fallback eligibility
      const fallback = await determineFallback(
        taskSpec,
        selectedRoute,
        err,
        user,
        repo,
        excludedRouteIds
      );

      if (fallback && attemptNumber < maxAttempts) {
        onEvent('fallback', {
          previousRouteId: selectedRoute.id,
          newRouteId: fallback.selectedRoute.id,
          newModelName: fallback.selectedModel.name,
          reason: err.message,
          attempt: attemptNumber,
        });

        onEvent('route_selected', {
          route: fallback.selectedRoute,
          model: fallback.selectedModel,
          provider: fallback.selectedProvider,
          decisionTrace: fallback.decisionTrace,
          why: fallback.rationale,
          fallback: { previousRouteId: selectedRoute.id, reason: err.message },
        });
        currentResolution = fallback;
        taskRecord.routeId = fallback.selectedRoute.id;
        taskRecord.modelId = fallback.selectedModel.id;
        taskRecord.providerId = fallback.selectedProvider.id;
        taskRecord.attempts = attempts;
        await repo.updateTask(taskRecord);

        attemptNumber++;
      } else {
        // No fallback possible
        taskRecord.status = 'failed';
        taskRecord.attempts = attempts;
        taskRecord.error = {
          message: err.message || 'Execution failed.',
          type: err.type || 'provider_error',
          retryable: Boolean(err.retryable),
        };
        taskRecord.completedAt = new Date().toISOString();
        await repo.updateTask(taskRecord);

        onEvent('error', {
          message: err.message || 'Provider execution failed and no eligible fallback was available.',
          errorType: err.type,
        });
        return;
      }
    }
  }
}
