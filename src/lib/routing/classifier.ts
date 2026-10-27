import type { CostPolicy, Modality, OutputModality, PrivacyMode, TaskClass, TaskSpec } from '@/lib/types';

export function classifyTask(
  prompt: string,
  options?: {
    taskClassOverride?: TaskClass;
    costPolicyOverride?: CostPolicy;
    privacyMode?: PrivacyMode;
    maxCostUSD?: number;
    monthlyBudgetRemainingUSD?: number;
    allowedProviders?: string[] | null;
    pinnedRouteId?: string | null;
    attachments?: Array<{ mimeType: string; sizeBytes: number }>;
  }
): TaskSpec {
  const p = prompt.toLowerCase();

  // 1. Detect input modalities from attachments
  const inputModalities: Modality[] = ['text'];
  if (options?.attachments && options.attachments.length > 0) {
    for (const att of options.attachments) {
      if (att.mimeType.startsWith('image/') && !inputModalities.includes('image')) {
        inputModalities.push('image');
      } else if (att.mimeType.startsWith('audio/') && !inputModalities.includes('audio')) {
        inputModalities.push('audio');
      } else if (att.mimeType.startsWith('video/') && !inputModalities.includes('video')) {
        inputModalities.push('video');
      } else if ((att.mimeType.includes('pdf') || att.mimeType.includes('document')) && !inputModalities.includes('document')) {
        inputModalities.push('document');
      }
    }
  }

  // 2. Classify task class & capabilities
  let taskClass: TaskClass = options?.taskClassOverride || 'general_chat';
  let confidence: 'keyword' | 'user_override' | 'default' = options?.taskClassOverride ? 'user_override' : 'default';
  let outputModality: OutputModality = 'text';
  const requiredCapabilities: ('tools' | 'reasoning')[] = [];

  if (!options?.taskClassOverride) {
    if (
      p.includes('generate image') ||
      p.includes('generate an image') ||
      p.includes('create an image') ||
      p.includes('draw a') ||
      p.includes('create an illustration') ||
      p.includes('render an image')
    ) {
      taskClass = 'image_generation';
      outputModality = 'image';
      confidence = 'keyword';
    } else if (p.includes('generate video') || p.includes('animate this') || p.includes('create a clip')) {
      taskClass = 'video_generation';
      outputModality = 'video';
      confidence = 'keyword';
    } else if (p.includes('text to speech') || p.includes('transcribe') || p.includes('voiceover')) {
      taskClass = 'audio';
      outputModality = 'audio';
      confidence = 'keyword';
    } else if (inputModalities.includes('image') || p.includes('inspect this image') || p.includes('ocr')) {
      taskClass = 'vision';
      confidence = 'keyword';
    } else if (inputModalities.includes('document') || p.includes('summarize the attached pdf') || p.includes('extract tables from document')) {
      taskClass = 'document_analysis';
      confidence = 'keyword';
    } else if (
      p.includes('```') ||
      p.includes('write code') ||
      p.includes('function ') ||
      p.includes('bug in') ||
      p.includes('refactor') ||
      p.includes('typescript') ||
      p.includes('python') ||
      p.includes('javascript') ||
      p.includes('sql query') ||
      p.includes('unit test')
    ) {
      taskClass = 'coding';
      requiredCapabilities.push('tools');
      confidence = 'keyword';
    } else if (
      p.includes('roadmap') ||
      p.includes('project plan') ||
      p.includes('sprint plan') ||
      p.includes('architecture plan') ||
      p.includes('rollout strategy') ||
      p.includes('migration plan')
    ) {
      taskClass = 'planning';
      confidence = 'keyword';
    } else if (
      p.includes('prove that') ||
      p.includes('math problem') ||
      p.includes('deduce') ||
      p.includes('logic puzzle') ||
      p.includes('deep reasoning') ||
      p.includes('chain of thought')
    ) {
      taskClass = 'reasoning';
      requiredCapabilities.push('reasoning');
      confidence = 'keyword';
    } else if (
      p.includes('draft ') ||
      p.includes('essay') ||
      p.includes('blog post') ||
      p.includes('rewrite') ||
      p.includes('creative story') ||
      p.includes('email')
    ) {
      taskClass = 'writing';
      confidence = 'keyword';
    }
  }

  // Token estimates
  const estimatedPromptTokens = Math.max(10, Math.ceil(prompt.length / 4));
  const expectedOutputTokens =
    taskClass === 'coding' || taskClass === 'reasoning' || taskClass === 'planning'
      ? 1500
      : 500;
  const contextEstimateTokens = estimatedPromptTokens + expectedOutputTokens;

  return {
    taskClass,
    inputModalities,
    outputModality,
    requiredCapabilities,
    contextEstimateTokens,
    expectedOutputTokens,
    privacyMode: options?.privacyMode || 'standard',
    costPolicy: options?.costPolicyOverride || 'balanced',
    maxCostUSD: options?.maxCostUSD ?? 0.25,
    monthlyBudgetRemainingUSD: options?.monthlyBudgetRemainingUSD ?? 10.0,
    allowedProviders: options?.allowedProviders || null,
    pinnedRouteId: options?.pinnedRouteId || null,
    classifierConfidence: confidence,
  };
}

export function classifyPrompt(prompt: string, taskClassOverride?: TaskClass): TaskSpec {
  return classifyTask(prompt, { taskClassOverride });
}
