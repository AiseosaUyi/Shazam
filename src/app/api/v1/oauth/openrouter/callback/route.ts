import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { encryptSecret, maskKey } from '@/lib/crypto/vault';
import { setVaultCookieOnResponse, syncVaultFromCookie } from '@/lib/crypto/vault-cookie';

const COOKIE = 'shazam_openrouter_pkce';

/** Exchanges OpenRouter's code for a key, stores it encrypted, then lands on /connected (which closes the popup). */
export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch {
    return NextResponse.redirect(new URL('/login?next=/onboarding', req.url));
  }

  const done = (status: 'connected' | 'denied' | 'error') => {
    const res = NextResponse.redirect(new URL(`/connected?provider=openrouter&status=${status}`, req.url));
    res.cookies.delete({ name: COOKIE, path: '/api/v1/oauth/openrouter' });
    return res;
  };

  const code = req.nextUrl.searchParams.get('code');
  const verifier = req.cookies.get(COOKIE)?.value;
  if (!code) return done('denied');
  if (!verifier) return done('error');

  try {
    const r = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout(10_000),
    });
    const data: any = await r.json().catch(() => ({}));
    const key: string | undefined = data?.key;
    if (!r.ok || !key) {
      console.error('[openrouter-oauth] exchange failed', r.status);
      return done('error');
    }

    await syncVaultFromCookie(req, user.id, repo, user.email);
    await repo.setCredential({
      id: `${user.id}:openrouter`,
      userId: user.id,
      providerId: 'openrouter',
      encryptedKey: await encryptSecret(key),
      keyHint: maskKey(key),
      status: 'valid',
    });
    const res = done('connected');
    await setVaultCookieOnResponse(res, user.id, repo, user.email);
    return res;
  } catch (err) {
    console.error('[openrouter-oauth] error', err instanceof Error ? err.message : err);
    return done('error');
  }
}
