import { CostPolicy, Modality, TaskAttachment, TaskClass, TaskSpec } from '@/types/core';
import { UserPreference } from '@/types/user';

export function classifyTask(
  prompt: string,
  attachments: TaskAttachment[] = [],
  userPref?: UserPreference,
  policyOverride?: CostPolicy,
  pinnedRouteId?: string
): TaskSpec {
  const p = prompt.toLowerCase();

  // 1. Detect input modalities
  const inputModalities: Modality[] = ['text'];
  for (const att of attachments) {
    if (att.mimeType.startsWith('image/')) {
      if (!inputModalities.includes('image')) inputModalities.push('image');
    } else if (att.mimeType.startsWith('audio/')) {
      if (!inputModalities.includes('audio')) inputModalities.push('audio');
    } else if (att.mimeType.startsWith('video/')) {
      if (!inputModalities.includes('video')) inputModalities.push('video');
    } else if (att.mimeType.includes('pdf') || att.mimeType.includes('document')) {
      if (!inputModalities.includes('document')) inputModalities.push('document');
    }
  }

  // 2. Classify task intent
  let taskClass: TaskClass = 'general_chat';
  let outputModality: Modality = 'text';
  const requiredCapabilities: string[] = [];
  let requiresTools = false;

  // Media generation signals
  if (
    p.includes('generate image') ||
    p.includes('draw a') ||
    p.includes('create an illustration') ||
    p.includes('paint a') ||
    p.includes('render 3d')
  ) {
    taskClass = 'image_generation';
    outputModality = 'image';
    requiredCapabilities.push('image_generation');
  } else if (p.includes('generate video') || p.includes('animate this') || p.includes('create a clip')) {
    taskClass = 'video_generation';
    outputModality = 'video';
    requiredCapabilities.push('video_generation');
  } else if (p.includes('text to speech') || p.includes('generate audio') || p.includes('voiceover')) {
    taskClass = 'audio';
    outputModality = 'audio';
    requiredCapabilities.push('audio_out');
  } else if (inputModalities.includes('audio') || p.includes('transcribe')) {
    taskClass = 'audio';
    requiredCapabilities.push('audio_in');
  } else if (inputModalities.includes('image') || p.includes('inspect this image') || p.includes('ocr')) {
    taskClass = 'vision';
    requiredCapabilities.push('vision');
  } else if (inputModalities.includes('document') || p.includes('summarize the attached pdf') || p.includes('contract analysis')) {
    taskClass = 'document_analysis';
  } else if (
    p.includes('```') ||
    p.includes('write code') ||
    p.includes('function ') ||
    p.includes('bug ') ||
    p.includes('refactor') ||
    p.includes('typescript') ||
    p.includes('python') ||
    p.includes('javascript') ||
    p.includes('sql query') ||
    p.includes('unit test') ||
    p.includes('regex')
  ) {
    taskClass = 'coding';
    outputModality = 'code';
    requiredCapabilities.push('code');
  } else if (
    p.includes('step-by-step') ||
    p.includes('prove that') ||
    p.includes('math problem') ||
    p.includes('deduce') ||
    p.includes('logical puzzle') ||
    p.includes('deep reasoning')
  ) {
    taskClass = 'reasoning';
    requiredCapabilities.push('reasoning');
  } else if (
    p.includes('roadmap') ||
    p.includes('project plan') ||
    p.includes('sprint plan') ||
    p.includes('architecture plan') ||
    p.includes('migration strategy')
  ) {
    taskClass = 'planning';
  } else if (
    p.includes('essay') ||
    p.includes('email') ||
    p.includes('blog post') ||
    p.includes('draft ') ||
    p.includes('rewrite') ||
    p.includes('creative story') ||
    p.includes('article') ||
    p.includes('copywriting')
  ) {
    taskClass = 'writing';
  }

  // Estimate context tokens
  const estimatedPromptTokens = Math.ceil(prompt.length / 4);
  const estimatedAttachmentTokens = attachments.reduce((acc, att) => acc + Math.ceil(att.sizeBytes / 4), 0);
  const contextEstimateTokens = Math.max(500, estimatedPromptTokens + estimatedAttachmentTokens + 1000);

  const costPolicy: CostPolicy = policyOverride || userPref?.defaultCostPolicy || 'balanced';

  return {
    taskClass,
    inputModalities,
    outputModality,
    requiredCapabilities,
    contextEstimateTokens,
    privacySensitivity: userPref?.privacyMode || 'standard',
    costPolicy,
    maxCostUSD: userPref?.maxCostPerTaskUSD ?? 0.50,
    allowedProviders: userPref?.allowedProviders,
    disallowedProviders: userPref?.disallowedProviders,
    preferredRegion: userPref?.preferredRegion,
    pinnedRouteId,
    requiresTools,
    intentSummary: `Classified as ${taskClass.replace('_', ' ')} with ${costPolicy.replace('_', ' ')} policy`,
  };
}
