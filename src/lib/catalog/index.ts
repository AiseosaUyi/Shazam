import { envFlag } from '@/lib/env';
import { DbRepo } from '@/lib/db/repo';
import type { Catalog, CatalogRoute, Model, Provider, Route } from '@/lib/types';

export const STATIC_PROVIDERS: Provider[] = [
  {
    id: 'google',
    name: 'Google Gemini',
    category: 'direct',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    termsUrl: 'https://ai.google.dev/terms',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyEnvVar: 'GOOGLE_AI_API_KEY',
    requiresApiKey: true,
    verification: 'verified',
    defaultStatus: 'enabled',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'direct',
    docsUrl: 'https://platform.openai.com/docs',
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    termsUrl: 'https://openai.com/policies/terms-of-use',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyEnvVar: 'OPENAI_API_KEY',
    requiresApiKey: true,
    verification: 'verified',
    defaultStatus: 'enabled',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'direct',
    docsUrl: 'https://docs.anthropic.com',
    pricingUrl: 'https://www.anthropic.com/pricing',
    termsUrl: 'https://www.anthropic.com/legal/commercial-terms',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyEnvVar: 'ANTHROPIC_API_KEY',
    requiresApiKey: true,
    verification: 'verified',
    defaultStatus: 'enabled',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'direct',
    docsUrl: 'https://api-docs.deepseek.com',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    termsUrl: 'https://www.deepseek.com/terms',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyEnvVar: 'DEEPSEEK_API_KEY',
    requiresApiKey: true,
    verification: 'verified',
    defaultStatus: 'enabled',
    notes: 'Current pricing schedule unverified; routes marked unknown cost.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'aggregator',
    docsUrl: 'https://openrouter.ai/docs',
    pricingUrl: 'https://openrouter.ai/models',
    termsUrl: 'https://openrouter.ai/terms',
    keyUrl: 'https://openrouter.ai/keys',
    keyEnvVar: 'OPENROUTER_API_KEY',
    requiresApiKey: true,
    verification: 'verified',
    defaultStatus: 'enabled',
  },
  {
    id: 'alibaba',
    name: 'Alibaba Cloud Qwen',
    category: 'direct',
    docsUrl: 'https://qwenlm.github.io/qwen-code-docs/',
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/user-guide/billing',
    termsUrl: 'https://www.alibabacloud.com/help/en/model-studio/user-guide/terms',
    requiresApiKey: true,
    verification: 'unverified',
    defaultStatus: 'disabled',
    notes: 'API access unverified in target regions; disabled.',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face Inference',
    category: 'aggregator',
    docsUrl: 'https://huggingface.co/docs/inference-providers/index',
    pricingUrl: 'https://huggingface.co/docs/inference-providers/pricing',
    termsUrl: 'https://huggingface.co/terms-of-service',
    requiresApiKey: true,
    verification: 'unverified',
    defaultStatus: 'disabled',
    notes: 'Dynamic provider routing pricing unverified; disabled.',
  },
  {
    id: 'simulation',
    name: 'Shazam Simulator (Demo)',
    category: 'demo',
    docsUrl: 'https://github.com/shazam-ai',
    pricingUrl: 'https://github.com/shazam-ai',
    termsUrl: 'https://github.com/shazam-ai',
    requiresApiKey: false,
    verification: 'verified',
    defaultStatus: 'enabled',
    notes: 'Development and demonstration offline adapter only.',
  },
];

export const STATIC_MODELS: Model[] = [
  // --- Google ---
  {
    id: 'model_gemini_3_8_flash',
    providerId: 'google',
    name: 'Gemini 3.8 Flash',
    providerModelId: 'gemini-3.8-flash',
    inputModalities: ['text', 'image', 'document'],
    outputModality: 'text',
    contextWindowTokens: 1048576,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsReasoning: false,
    qualityTier: 4,
    strengths: ['general_chat', 'writing', 'vision', 'document_analysis'],
  },
  {
    id: 'model_gemini_3_5_flash_lite',
    providerId: 'google',
    name: 'Gemini 3.5 Flash Lite',
    providerModelId: 'gemini-3.5-flash-lite',
    inputModalities: ['text', 'image'],
    outputModality: 'text',
    contextWindowTokens: 1048576,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsReasoning: false,
    qualityTier: 3,
    strengths: ['general_chat', 'writing'],
  },
  {
    id: 'model_gemini_4_argon',
    providerId: 'google',
    name: 'Gemini 4 Argon',
    providerModelId: 'gemini-4-argon',
    inputModalities: ['text', 'image', 'document'],
    outputModality: 'text',
    contextWindowTokens: 1048576,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 5,
    strengths: ['reasoning', 'planning', 'coding', 'document_analysis'],
  },

  // --- OpenAI ---
  {
    id: 'model_openai_gpt_6_1_terra',
    providerId: 'openai',
    name: 'GPT-6.1 Terra',
    providerModelId: 'gpt-6.1-terra',
    inputModalities: ['text', 'image'],
    outputModality: 'text',
    contextWindowTokens: 1050000,
    maxOutputTokens: 128000,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 5,
    strengths: ['coding', 'reasoning', 'planning', 'writing'],
  },
  {
    id: 'model_openai_gpt_6_luna',
    providerId: 'openai',
    name: 'GPT-6 Luna',
    providerModelId: 'gpt-6-luna',
    inputModalities: ['text'],
    outputModality: 'text',
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsReasoning: false,
    qualityTier: 3,
    strengths: ['general_chat', 'writing'],
  },
  {
    id: 'model_openai_gpt_6_1_sol',
    providerId: 'openai',
    name: 'GPT-6.1 Sol',
    providerModelId: 'gpt-6.1-sol',
    inputModalities: ['text', 'image'],
    outputModality: 'text',
    contextWindowTokens: 500000,
    maxOutputTokens: 32768,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 4,
    strengths: ['reasoning', 'coding'],
  },
  {
    id: 'model_openai_gpt_6_astra',
    providerId: 'openai',
    name: 'GPT-6 Astra (Unverified)',
    providerModelId: 'gpt-6-astra',
    inputModalities: ['text'],
    outputModality: 'text',
    contextWindowTokens: null,
    maxOutputTokens: null,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 5,
    strengths: ['planning', 'reasoning'],
  },

  // --- Anthropic ---
  {
    id: 'model_claude_sonnet_5_5',
    providerId: 'anthropic',
    name: 'Claude Sonnet 5.5',
    providerModelId: 'claude-sonnet-5-5',
    inputModalities: ['text', 'image', 'document'],
    outputModality: 'text',
    contextWindowTokens: 1000000,
    maxOutputTokens: 128000,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 5,
    strengths: ['coding', 'reasoning', 'document_analysis', 'planning'],
  },
  {
    id: 'model_claude_opus_5_5',
    providerId: 'anthropic',
    name: 'Claude Opus 5.5',
    providerModelId: 'claude-opus-5-5',
    inputModalities: ['text', 'image', 'document'],
    outputModality: 'text',
    contextWindowTokens: 1000000,
    maxOutputTokens: 128000,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 5,
    strengths: ['reasoning', 'writing', 'planning', 'document_analysis'],
  },
  {
    id: 'model_claude_haiku_5_5',
    providerId: 'anthropic',
    name: 'Claude Haiku 5.5',
    providerModelId: 'claude-haiku-5-5',
    inputModalities: ['text', 'image'],
    outputModality: 'text',
    contextWindowTokens: 1000000,
    maxOutputTokens: 128000,
    supportsTools: true,
    supportsReasoning: false,
    qualityTier: 3,
    strengths: ['general_chat', 'writing'],
  },

  // --- DeepSeek ---
  {
    id: 'model_deepseek_flash',
    providerId: 'deepseek',
    name: 'DeepSeek Flash',
    providerModelId: 'deepseek-flash',
    inputModalities: ['text'],
    outputModality: 'text',
    contextWindowTokens: null,
    maxOutputTokens: null,
    supportsTools: true,
    supportsReasoning: false,
    qualityTier: 4,
    strengths: ['coding', 'writing'],
  },
  {
    id: 'model_deepseek_v4_pro',
    providerId: 'deepseek',
    name: 'DeepSeek V4 Pro',
    providerModelId: 'deepseek-v4-pro',
    inputModalities: ['text'],
    outputModality: 'text',
    contextWindowTokens: null,
    maxOutputTokens: null,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 5,
    strengths: ['reasoning', 'coding', 'planning'],
  },

  // --- Simulation (Demo only) ---
  {
    id: 'model_shazam_sim_demo',
    providerId: 'simulation',
    name: 'Shazam Simulator (Demo)',
    providerModelId: 'shazam-sim-demo',
    inputModalities: ['text', 'image', 'document'],
    outputModality: 'text',
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsReasoning: true,
    qualityTier: 3,
    strengths: ['general_chat', 'coding', 'reasoning'],
  },
];

export const STATIC_ROUTES: Route[] = [
  // Google
  {
    id: 'route_google_gemini_3_8_flash_free',
    modelId: 'model_gemini_3_8_flash',
    providerId: 'google',
    costClass: 'verified_free',
    pricing: { inputPer1M: 0, outputPer1M: 0, note: 'Free tier: user data may be used to improve Google products.' },
    quotaConfidence: 'observed',
    quotaNote: '15 RPM / 1M TPM free tier quota',
    privacy: { providerMayTrainOnData: true, note: 'Google AI Studio terms: free tier data may be logged and used for model training.' },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    id: 'route_google_gemini_3_8_flash_paid',
    modelId: 'model_gemini_3_8_flash',
    providerId: 'google',
    costClass: 'paid',
    pricing: { inputPer1M: 0.75, outputPer1M: 3.75, note: 'Paid rate through Dec 31 2026.' },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false, note: 'Paid tier: customer data is not used for model training.' },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    id: 'route_google_gemini_3_5_flash_lite_free',
    modelId: 'model_gemini_3_5_flash_lite',
    providerId: 'google',
    costClass: 'verified_free',
    pricing: { inputPer1M: 0, outputPer1M: 0, note: 'Free tier: user data may be used to improve products.' },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: true },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    id: 'route_google_gemini_3_5_flash_lite_paid',
    modelId: 'model_gemini_3_5_flash_lite',
    providerId: 'google',
    costClass: 'paid',
    pricing: { inputPer1M: 0.30, outputPer1M: 2.50 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    id: 'route_google_gemini_4_argon',
    modelId: 'model_gemini_4_argon',
    providerId: 'google',
    costClass: 'paid',
    pricing: { inputPer1M: 2.0, outputPer1M: 10.0, note: '$2/$10 through Nov 30 2026, then $4/$20.' },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },

  // OpenAI
  {
    id: 'route_openai_gpt_6_1_terra',
    modelId: 'model_openai_gpt_6_1_terra',
    providerId: 'openai',
    costClass: 'paid',
    pricing: { inputPer1M: 1.0, outputPer1M: 5.0 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    id: 'route_openai_gpt_6_luna',
    modelId: 'model_openai_gpt_6_luna',
    providerId: 'openai',
    costClass: 'paid',
    pricing: { inputPer1M: 0.10, outputPer1M: 0.50 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    id: 'route_openai_gpt_6_1_sol',
    modelId: 'model_openai_gpt_6_1_sol',
    providerId: 'openai',
    costClass: 'paid',
    pricing: { inputPer1M: 2.0, outputPer1M: 10.0 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    id: 'route_openai_gpt_6_astra',
    modelId: 'model_openai_gpt_6_astra',
    providerId: 'openai',
    costClass: 'paid',
    pricing: { inputPer1M: 10.0, outputPer1M: 50.0 },
    quotaConfidence: 'unknown',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'disabled',
    disabledReason: 'Account access and live endpoint entitlement unconfirmed.',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  },

  // Anthropic
  {
    id: 'route_anthropic_claude_sonnet_5_5',
    modelId: 'model_claude_sonnet_5_5',
    providerId: 'anthropic',
    costClass: 'paid',
    pricing: { inputPer1M: 2.0, outputPer1M: 10.0 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://www.anthropic.com/pricing',
  },
  {
    id: 'route_anthropic_claude_opus_5_5',
    modelId: 'model_claude_opus_5_5',
    providerId: 'anthropic',
    costClass: 'paid',
    pricing: { inputPer1M: 4.0, outputPer1M: 20.0 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://www.anthropic.com/pricing',
  },
  {
    id: 'route_anthropic_claude_haiku_5_5',
    modelId: 'model_claude_haiku_5_5',
    providerId: 'anthropic',
    costClass: 'unknown',
    pricing: null,
    quotaConfidence: 'unknown',
    quotaNote: 'Pricing published as "from", exact schedule unknown; only pin-eligible.',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://www.anthropic.com/pricing',
  },

  // DeepSeek
  {
    id: 'route_deepseek_flash',
    modelId: 'model_deepseek_flash',
    providerId: 'deepseek',
    costClass: 'unknown',
    pricing: null,
    quotaConfidence: 'unknown',
    quotaNote: 'Official price not verifiable on 2026-10-27; only pin-eligible.',
    privacy: { providerMayTrainOnData: 'unknown' },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://api-docs.deepseek.com',
  },
  {
    id: 'route_deepseek_v4_pro',
    modelId: 'model_deepseek_v4_pro',
    providerId: 'deepseek',
    costClass: 'unknown',
    pricing: null,
    quotaConfidence: 'unknown',
    quotaNote: 'Official price not verifiable on 2026-10-27; only pin-eligible.',
    privacy: { providerMayTrainOnData: 'unknown' },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://api-docs.deepseek.com',
  },

  // Simulation (Demo only)
  {
    id: 'route_shazam_sim_demo',
    modelId: 'model_shazam_sim_demo',
    providerId: 'simulation',
    costClass: 'verified_free',
    pricing: { inputPer1M: 0, outputPer1M: 0, note: 'Offline demonstration adapter.' },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false, note: 'Local offline evaluation; no data leaves the environment.' },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://github.com/shazam-ai',
  },
];

/**
 * Loads dynamic OpenRouter free models, cached in D1 catalog_cache.
 * A model is verified_free ONLY if its id ends in ':free' AND both prompt & completion price are 0.
 */
export async function getOpenRouterDynamicFreeRoutes(repo: DbRepo): Promise<{ models: Model[]; routes: Route[] }> {
  const cacheKey = 'openrouter:models';
  let cachedPayload: any = null;

  try {
    const cached = await repo.getCatalogCache(cacheKey);
    if (cached) {
      const ageHours = (Date.now() - new Date(cached.syncedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours < 24) {
        cachedPayload = JSON.parse(cached.payload);
      }
    }
  } catch {
    // ignore cache read failure
  }

  let rawModels: any[] = [];
  if (cachedPayload && Array.isArray(cachedPayload.data)) {
    rawModels = cachedPayload.data;
  } else {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'User-Agent': 'Shazam-AI/0.2.0' },
      });
      if (res.ok) {
        const json = await res.json();
        rawModels = json.data || [];
        await repo.setCatalogCache(cacheKey, JSON.stringify(json));
      }
    } catch {
      // In tests or offline, fetch might fail
    }
  }

  const freeModels: Model[] = [];
  const freeRoutes: Route[] = [];

  for (const m of rawModels) {
    const id = m.id || '';
    const isFreeSlug = id.endsWith(':free');
    const promptPrice = parseFloat(m.pricing?.prompt || '1');
    const completionPrice = parseFloat(m.pricing?.completion || '1');

    if (isFreeSlug && promptPrice === 0 && completionPrice === 0) {
      const safeModelId = `model_openrouter_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const safeRouteId = `route_openrouter_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      freeModels.push({
        id: safeModelId,
        providerId: 'openrouter',
        name: `${m.name || id} (OpenRouter Free)`,
        providerModelId: id,
        inputModalities: ['text'],
        outputModality: 'text',
        contextWindowTokens: m.context_length || 32768,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsReasoning: id.includes('r1') || id.includes('reasoner'),
        qualityTier: id.includes('70b') || id.includes('r1') ? 4 : 3,
        strengths: id.includes('r1') ? ['reasoning', 'coding'] : ['general_chat', 'writing'],
      });

      freeRoutes.push({
        id: safeRouteId,
        modelId: safeModelId,
        providerId: 'openrouter',
        costClass: 'verified_free',
        pricing: { inputPer1M: 0, outputPer1M: 0, note: 'OpenRouter community free tier.' },
        quotaConfidence: 'observed',
        quotaNote: 'Subject to community rate limits (typically 20 RPM)',
        privacy: { providerMayTrainOnData: 'unknown', note: 'Public aggregator; data training depends on upstream host.' },
        defaultStatus: 'enabled',
        verifiedAt: new Date().toISOString().split('T')[0],
        sourceUrl: 'https://openrouter.ai/collections/free-models',
        dynamic: true,
      });
    }
  }

  return { models: freeModels, routes: freeRoutes };
}

/**
 * Returns the effective live catalogue, applying admin overrides from D1.
 */
export async function getLiveCatalog(repo = new DbRepo()): Promise<Catalog> {
  const simulationEnabled = envFlag('SHAZAM_ENABLE_SIMULATION', false);

  // 1. Base providers (filter simulation if not enabled)
  let providers = STATIC_PROVIDERS.filter((p) => {
    if (p.id === 'simulation' && !simulationEnabled) return false;
    return true;
  });

  // 2. Base models & routes
  let models = [...STATIC_MODELS].filter((m) => {
    if (m.providerId === 'simulation' && !simulationEnabled) return false;
    return true;
  });

  let routes = [...STATIC_ROUTES].filter((r) => {
    if (r.providerId === 'simulation' && !simulationEnabled) return false;
    return true;
  });

  // 3. Dynamic OpenRouter Free models
  try {
    const { models: dynamicModels, routes: dynamicRoutes } = await getOpenRouterDynamicFreeRoutes(repo);
    models = [...models, ...dynamicModels];
    routes = [...routes, ...dynamicRoutes];
  } catch {
    // continue with static catalogue if dynamic sync fails
  }

  // 4. Layer admin overrides from D1
  const overrides = await repo.getCatalogOverrides();
  const overrideMap = new Map(overrides.map((o) => [`${o.targetType}:${o.targetId}`, o]));

  const catalogProviders = providers.map((p) => {
    const override = overrideMap.get(`provider:${p.id}`);
    const status = override ? override.status : p.defaultStatus;
    return { ...p, status };
  });

  const catalogRoutes: CatalogRoute[] = routes.map((r) => {
    const routeOverride = overrideMap.get(`route:${r.id}`);
    const provOverride = overrideMap.get(`provider:${r.providerId}`);

    let status = r.defaultStatus;
    let statusReason = r.disabledReason;

    if (provOverride && provOverride.status === 'disabled') {
      status = 'disabled';
      statusReason = `Provider ${r.providerId} administratively disabled: ${provOverride.reason || 'Admin kill switch'}`;
    } else if (routeOverride) {
      status = routeOverride.status;
      if (routeOverride.reason) statusReason = routeOverride.reason;
    }

    return {
      ...r,
      status,
      statusReason,
    };
  });

  return {
    providers: catalogProviders,
    models,
    routes: catalogRoutes,
  };
}
