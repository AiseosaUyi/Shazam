import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { getCurrentUser } from '@/lib/auth/session';
import { syncVaultFromCookie, setVaultCookieOnResponse } from '@/lib/crypto/vault-cookie';
import { getLiveCatalog } from '@/lib/catalog';
import { envFlag, envVar } from '@/lib/env';

export async function GET(req: NextRequest) {
  try {
    const repo = new DbRepo();
    const user = await getCurrentUser(req, repo);
    const catalog = await getLiveCatalog(repo);

    let userCredentials: any[] = [];
    if (user) {
      await syncVaultFromCookie(req, user.id, repo, user.email);
      userCredentials = await repo.getCredentials(user.id);
    }
    const credMap = new Map(userCredentials.map((c) => [c.providerId, c]));

    const canUseSystem = user?.role === 'admin' || envFlag('SHAZAM_SHARE_SYSTEM_KEYS', false);
    const systemKeys: Record<string, boolean> = {
      google: Boolean(envVar('GOOGLE_AI_API_KEY') || envVar('GOOGLE_API_KEY')),
      openai: Boolean(envVar('OPENAI_API_KEY')),
      anthropic: Boolean(envVar('ANTHROPIC_API_KEY')),
      deepseek: Boolean(envVar('DEEPSEEK_API_KEY')),
      openrouter: Boolean(envVar('OPENROUTER_API_KEY')),
      simulation: envFlag('SHAZAM_ENABLE_SIMULATION', false),
    };

    const providers = catalog.providers.map((p) => {
      const cred = credMap.get(p.id);
      const hasSystem = canUseSystem && systemKeys[p.id] === true;
      const isConnected = Boolean(cred) || hasSystem;

      return {
        ...p,
        isConnected,
        isSystemProvided: !cred && hasSystem,
        keyMask: cred?.keyHint || cred?.keyMask || (hasSystem ? 'System Configured' : null),
        credentialStatus: cred ? cred.status : hasSystem ? 'valid' : 'unconnected',
        lastValidatedAt: cred?.lastValidatedAt ?? null,
      };
    });

    const response = NextResponse.json({ providers });
    if (user && userCredentials.length > 0) {
      await setVaultCookieOnResponse(response, user.id, repo, user.email);
    }
    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to list providers.' }, { status: 500 });
  }
}
