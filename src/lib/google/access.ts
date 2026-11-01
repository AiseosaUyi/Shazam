import { envVar } from '@/lib/env';
import { getAdminEmails } from '@/lib/auth/session';
import { WaitlistRepo } from '@/lib/db/waitlist-repo';
import type { User } from '@/lib/types';

/**
 * While the Google OAuth app is in "Testing" mode, Google only lets listed test users sign in
 * (max 100). Gate Connect Google so other users join the early-access list instead of hitting
 * Google's "access blocked" screen. Set GOOGLE_OAUTH_PUBLIC=true once Google verifies the app.
 */
export type GoogleAccess = 'open' | 'approved' | 'pending' | 'none';

export function googleIsPublic(): boolean {
  return envVar('GOOGLE_OAUTH_PUBLIC') === 'true';
}

export async function googleAccessFor(user: Pick<User, 'email' | 'role'>): Promise<GoogleAccess> {
  if (googleIsPublic()) return 'open';
  const email = user.email.trim().toLowerCase();
  if (user.role === 'admin' || getAdminEmails().includes(email)) return 'approved';
  const entry = await new WaitlistRepo().getByEmail(email).catch(() => null);
  if (entry?.status === 'invited') return 'approved';
  return entry ? 'pending' : 'none';
}

export function canConnectGoogle(access: GoogleAccess): boolean {
  return access === 'open' || access === 'approved';
}
