import { encryptSecret, decryptSecret } from '@/lib/crypto/vault';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { envVar } from '@/lib/env';

/**
 * Google OAuth 2.0 (authorization code + offline refresh token) for Gmail and Calendar.
 * Tokens are AES-256-GCM encrypted at rest and refreshed transparently.
 */

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export class GoogleNotConnectedError extends Error {
  constructor(message = 'Google is not connected. Connect Gmail & Calendar in Connections first.') {
    super(message);
  }
}

export function googleOAuthConfigured(): boolean {
  return Boolean(envVar('GOOGLE_CLIENT_ID') && envVar('GOOGLE_CLIENT_SECRET'));
}

export function googleRedirectUri(origin: string): string {
  const base = envVar('APP_URL') || origin;
  return `${base.replace(/\/$/, '')}/api/v1/oauth/google/callback`;
}

export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: envVar('GOOGLE_CLIENT_ID') || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: envVar('GOOGLE_CLIENT_ID') || '',
      client_secret: envVar('GOOGLE_CLIENT_SECRET') || '',
      ...body,
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${data.error_description || data.error || res.status}`);
  return data;
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email || null;
  } catch {
    return null;
  }
}

export async function completeGoogleOAuth(userId: string, code: string, redirectUri: string, platform = new PlatformRepo()): Promise<string | null> {
  const tokens = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const email = emailFromIdToken(tokens.id_token);
  await platform.upsertOAuth(userId, 'google', {
    accountEmail: email,
    scopes: tokens.scope,
    encryptedRefreshToken: tokens.refresh_token ? await encryptSecret(tokens.refresh_token) : null,
    encryptedAccessToken: await encryptSecret(tokens.access_token),
    accessExpiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
  });
  return email;
}

/** Returns a valid access token, refreshing it when expired. */
export async function getGoogleAccessToken(userId: string, platform = new PlatformRepo()): Promise<{ token: string; email: string | null }> {
  const conn = await platform.getOAuth(userId, 'google');
  if (!conn || !conn.encryptedAccessToken) throw new GoogleNotConnectedError();

  if (conn.accessExpiresAt && new Date(conn.accessExpiresAt).getTime() > Date.now()) {
    return { token: await decryptSecret(conn.encryptedAccessToken), email: conn.accountEmail };
  }
  if (!conn.encryptedRefreshToken) {
    throw new GoogleNotConnectedError('Google access expired and no refresh token is stored. Reconnect Google in Connections.');
  }
  const refreshed = await tokenRequest({ refresh_token: await decryptSecret(conn.encryptedRefreshToken), grant_type: 'refresh_token' });
  await platform.upsertOAuth(userId, 'google', {
    scopes: refreshed.scope || conn.scopes,
    encryptedAccessToken: await encryptSecret(refreshed.access_token),
    accessExpiresAt: new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString(),
  });
  return { token: refreshed.access_token, email: conn.accountEmail };
}

export async function googleFetch(userId: string, url: string, init: RequestInit = {}): Promise<any> {
  const { token } = await getGoogleAccessToken(userId);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: init.signal || AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Google API ${res.status}: ${data?.error?.message || text.slice(0, 300)}`);
  return data;
}
