import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { googleOAuthConfigured, GOOGLE_SCOPES } from '@/lib/google/oauth';
import { googleAccessFor } from '@/lib/google/access';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const conn = await new PlatformRepo().getOAuth(user.id, 'google');
  return NextResponse.json({
    configured: googleOAuthConfigured(),
    access: await googleAccessFor(user),
    connected: Boolean(conn),
    email: conn?.accountEmail || null,
    scopes: conn?.scopes.split(' ') || [],
    missingScopes: conn ? GOOGLE_SCOPES.filter((s) => s.startsWith('https://') && !conn.scopes.includes(s)) : [],
  });
}

export async function DELETE(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  await new PlatformRepo().deleteOAuth(user.id, 'google');
  return NextResponse.json({ success: true });
}
