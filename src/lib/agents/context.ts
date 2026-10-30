import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { BridgeRepo } from '@/lib/bridge/repo';
import { sandboxAvailable } from '@/lib/agent/sandbox';
import type { SuggestContext } from './suggest';

const MODEL_PROVIDERS = ['google', 'openai', 'anthropic', 'deepseek', 'openrouter', 'groq', 'cerebras'];

export async function loadSuggestContext(userId: string): Promise<SuggestContext> {
  const repo = new DbRepo();
  const bridge = new BridgeRepo();
  const [google, creds, desktop, browser, servers] = await Promise.all([
    new PlatformRepo().getOAuth(userId, 'google'),
    repo.getCredentials(userId).catch(() => [] as any[]),
    bridge.onlineDevice(userId, 'desktop'),
    bridge.onlineDevice(userId, 'browser'),
    repo.getMcpServers(userId).catch(() => [] as any[]),
  ]);
  const valid = (creds as any[]).filter((c) => c.status === 'valid').map((c) => c.providerId);
  return {
    googleConnected: Boolean(google),
    githubConnected: valid.includes('github'),
    desktopOnline: Boolean(desktop),
    browserOnline: Boolean(browser),
    sandbox: sandboxAvailable(),
    mcpServers: (servers as any[]).filter((s) => s.status === 'active').map((s) => s.name),
    hasOwnKey: valid.some((p) => MODEL_PROVIDERS.includes(p)),
  };
}
