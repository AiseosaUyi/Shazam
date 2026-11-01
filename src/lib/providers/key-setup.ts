/**
 * Client-safe metadata for the guided "get a key" flow used in onboarding and Connections.
 *
 * Key pages (Google AI Studio, Groq, Cerebras, OpenRouter) all send X-Frame-Options DENY or
 * SAMEORIGIN, so they cannot be embedded in an iframe. Instead we open them in a small popup
 * window over Arcwork, keep the guide on screen and save the key the moment it is pasted.
 * OpenRouter supports OAuth PKCE, so it connects in one click with no copy/paste at all.
 */

export interface KeyProvider {
  id: string;
  name: string;
  /** Short plain-language benefit. */
  unlocks: string;
  keyUrl: string;
  free: boolean;
  recommended?: boolean;
  /** Visible disclosure (e.g. free tier training). */
  note?: string;
  /** The steps the user follows in the popup. */
  steps: string[];
  /** Typical key prefix, shown as a placeholder hint. */
  prefix?: string;
  /** Connect via OAuth instead of copy/paste. */
  oneClick?: boolean;
}

export const KEY_PROVIDERS: KeyProvider[] = [
  {
    id: 'google',
    name: 'Google Gemini',
    unlocks: 'Gemini 3.8 Flash for chat, code and Co-Work, with generous free daily limits',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    free: true,
    recommended: true,
    note: 'Free with any Google account, no card needed. On the free tier Google may use requests to improve its models.',
    steps: ['Sign in with your Google account', 'Click “Create API key”', 'Copy the key and paste it below'],
    prefix: 'AIza…',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    unlocks: 'Nemotron 3 Ultra, Gemma 4 and other free models',
    keyUrl: 'https://openrouter.ai/keys',
    free: true,
    oneClick: true,
    note: '50 free requests a day, 1,000 with $10 of credit.',
    steps: ['Sign in or create an account', 'Approve access for Arcwork', 'The window closes and you are connected'],
    prefix: 'sk-or-…',
  },
  {
    id: 'groq',
    name: 'Groq',
    unlocks: 'Qwen3.8 27B and gpt-oss at very high speed',
    keyUrl: 'https://console.groq.com/keys',
    free: true,
    note: 'Free, with tight per-minute limits.',
    steps: ['Sign in (Google or GitHub works)', 'Click “Create API Key” and name it Arcwork', 'Copy the key and paste it below'],
    prefix: 'gsk_…',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    unlocks: 'gpt-oss-120b, about 1M free tokens a day',
    keyUrl: 'https://cloud.cerebras.ai',
    free: true,
    steps: ['Sign in or create an account', 'Open “API Keys” and generate a key', 'Copy the key and paste it below'],
    prefix: 'csk-…',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    unlocks: 'Claude Opus, Sonnet and Haiku',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    free: false,
    steps: ['Sign in to the Anthropic Console', 'Click “Create Key”', 'Copy the key and paste it below'],
    prefix: 'sk-ant-…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    unlocks: 'GPT models and GPT Image',
    keyUrl: 'https://platform.openai.com/api-keys',
    free: false,
    steps: ['Sign in to the OpenAI platform', 'Click “Create new secret key”', 'Copy the key and paste it below'],
    prefix: 'sk-…',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    unlocks: 'DeepSeek chat and reasoning models',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    free: false,
    steps: ['Sign in to the DeepSeek platform', 'Click “Create new API key”', 'Copy the key and paste it below'],
    prefix: 'sk-…',
  },
];

export function getKeyProvider(id: string): KeyProvider | undefined {
  return KEY_PROVIDERS.find((p) => p.id === id);
}

/** Best-effort provider detection from a pasted key's format. Ambiguous `sk-` keys return null. */
export function detectProviderFromKey(raw: string): string | null {
  const key = raw.trim();
  if (/^AIza[0-9A-Za-z_-]{30,}$/.test(key)) return 'google';
  if (/^gsk_[0-9A-Za-z]{20,}$/.test(key)) return 'groq';
  if (/^sk-or-[0-9A-Za-z-]{20,}$/.test(key)) return 'openrouter';
  if (/^csk-[0-9A-Za-z]{20,}$/.test(key)) return 'cerebras';
  if (/^sk-ant-[0-9A-Za-z_-]{20,}$/.test(key)) return 'anthropic';
  if (/^sk-proj-[0-9A-Za-z_-]{20,}$/.test(key)) return 'openai';
  return null;
}

/** True when the pasted text plausibly is a whole key (so we can save it without a click). */
export function looksLikeCompleteKey(providerId: string, raw: string): boolean {
  const detected = detectProviderFromKey(raw);
  if (detected) return detected === providerId;
  // Providers without a distinctive prefix: accept a long, space-free token.
  return ['openai', 'deepseek'].includes(providerId) && /^sk-[0-9A-Za-z_-]{20,}$/.test(raw.trim());
}

/** Channel the OAuth popup uses to tell the opener a key was connected (works even when COOP severs window.opener). */
export const KEY_CHANNEL = 'shazam-keys';

/** Open a page in a compact popup centered over the current window. Falls back to a new tab. */
export function openSidePopup(url: string, name = 'shazam-key'): void {
  const w = 520;
  const h = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open(url, name, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) window.open(url, '_blank', 'noopener');
}
