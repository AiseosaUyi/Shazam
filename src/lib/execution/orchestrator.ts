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


/**
 * Chat, Co-Work and Code wrap the user's words in instruction preambles before sending.
 * Title conversations from the user's own request, never from the preamble.
 */
export function deriveConversationTitle(prompt: string): string {
  let text = prompt.trim();
  const marker = text.match(/\[?User Request\]?:\s*\n/i);
  if (marker && marker.index !== undefined) {
    text = text.slice(marker.index + marker[0].length).trim();
  }
  text = text.replace(/^\[Autonomous Co-Work Mode\]\n/, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 45) || 'New Conversation';
}

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
      const title = deriveConversationTitle(prompt);
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
    const title = deriveConversationTitle(prompt);
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

  const isImagePin = pinnedModelName && (
    pinnedModelName.toLowerCase().includes('flux') ||
    pinnedModelName.toLowerCase().includes('image') ||
    pinnedModelName.toLowerCase().includes('banana') ||
    pinnedModelName.toLowerCase().includes('imagen')
  );

  const taskSpec = {
    ...classified,
    ...(isImagePin ? { outputModality: 'image' as const, taskClass: 'image_generation' as const } : {}),
    costPolicy,
    privacyMode: preferences.privacyMode,
    maxCostUSD: preferences.maxCostPerTaskUSD,
    monthlyBudgetRemainingUSD: monthlyRemaining,
    pinnedRouteId: pinnedModelName || null,
    allowedProviders: preferences.allowedProviders,
  };

  // Image requests use the media pipeline: prompt enhancement, best available provider,
  // stored in Blob and the media library (never a base64 blob inside the chat history).
  if (taskSpec.outputModality === 'image') {
    await runImageTask({ user, repo, prompt, conversationId: conversationId!, pinnedModelName, onEvent });
    return;
  }

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

      const cleanTitle = deriveConversationTitle(prompt);

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

async function runImageTask(opts: { user: User; repo: DbRepo; prompt: string; conversationId: string; pinnedModelName?: string; onEvent: (event: string, data: any) => void }): Promise<void> {
  const { user, repo, prompt, conversationId, onEvent } = opts;
  const { generateAndStoreImage } = await import('@/lib/media/image');
  const { PlatformRepo } = await import('@/lib/db/platform-repo');
  const { decryptSecret } = await import('@/lib/crypto/vault');
  const { resolveAgentRoute } = await import('@/lib/agent/resolve');
  const { createLanguageModel } = await import('@/lib/agent/models');

  const key = async (provider: string) => {
    const cred = await repo.getCredential(user.id, provider);
    return cred && cred.status === 'valid' ? decryptSecret(cred.encryptedKey).catch(() => null) : null;
  };
  const pin = (opts.pinnedModelName || '').toLowerCase();
  const wantsFlux = pin.includes('flux');
  const [googleKey, openaiKey] = wantsFlux ? [null, null] : await Promise.all([key('google'), key('openai')]);

  let enhancer = null;
  try {
    const route = await resolveAgentRoute(user, repo, prompt, 'writing');
    enhancer = (await createLanguageModel(route.selectedRoute.providerId, route.selectedModel.providerModelId, route.apiKey)).model;
  } catch {
    // No text model available: generate from the raw prompt.
  }

  // Previous image in this conversation → treat follow-ups like "make her hair red" as edits.
  const prior = await repo.getMessages(user.id, conversationId).catch(() => []);
  const lastImage = [...prior].reverse().map((m) => m.content.match(/\]\((https:\/\/[^)\s]+\.(?:png|jpe?g|webp)[^)\s]*)\)/i)?.[1]).find(Boolean);
  const isEdit = Boolean(lastImage) && /\b(make|change|edit|turn|add|remove|replace|same|now|instead|but)\b/i.test(prompt) && prompt.length < 240;
  const aspect = /\b(16:9|landscape|wide|banner|youtube)\b/i.test(prompt) ? '16:9' : /\b(9:16|portrait|vertical|story|reel|tiktok|poster)\b/i.test(prompt) ? '9:16' : /\b4:3\b/.test(prompt) ? '4:3' : '1:1';

  await repo.addMessage({ id: crypto.randomUUID(), userId: user.id, conversationId, role: 'user', content: prompt });
  onEvent('task_created', { conversationId, prompt, taskClass: 'image_generation' });
  try {
    const r = await generateAndStoreImage(
      { userId: user.id, prompt, aspectRatio: aspect, referenceImageUrl: isEdit ? lastImage : undefined, enhancer, googleApiKey: googleKey, openaiApiKey: openaiKey },
      new PlatformRepo()
    );
    const text = `![${prompt.replace(/[\[\]]/g, '').slice(0, 100)}](${r.asset.url})\n\n<sub>${r.provider} · ${r.model}${isEdit ? ' · edited previous image' : ''}${r.enhanced ? ` · prompt expanded: “${r.finalPrompt.slice(0, 220)}${r.finalPrompt.length > 220 ? '…' : ''}”` : ''}</sub>`;
    onEvent('delta', { text });
    await repo.addMessage({ id: crypto.randomUUID(), userId: user.id, conversationId, role: 'assistant', content: text });
    await repo.touchConversation(user.id, conversationId);
    onEvent('done', { fullText: text, usage: { promptTokens: 0, completionTokens: 0, tokensKind: 'estimated' }, costUSD: 0, costKind: 'estimated' });
  } catch (err: any) {
    onEvent('error', { message: err.message || 'Image generation failed.' });
  }
}
