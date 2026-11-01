import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { clientIp } from '@/lib/auth/client-ip';
import { DeviceAuthRepo } from '@/lib/bridge/device-auth';

/**
 * The signed-in person looks up a pending connection request (GET ?code=) and approves or
 * denies it (POST). Approving binds that computer to their account, so the POST demands a
 * same-origin browser request and lookups are rate limited to stop code guessing.
 */

async function signedIn(req: NextRequest) {
  try {
    return await requireUser(req, new DbRepo());
  } catch {
    return null;
  }
}

async function underLimit(userId: string): Promise<boolean> {
  return (await new DbRepo().checkRateLimit(`bridge-device-approve:${userId}`, 600, 30)).allowed;
}

/** Stricter than verifyCsrfOrigin: the Origin header must be present and match this host. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === req.nextUrl.host || new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host'));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const user = await signedIn(req);
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await underLimit(user.id))) return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
  const request = await new DeviceAuthRepo().lookup(req.nextUrl.searchParams.get('code') || '', clientIp(req));
  if (!request) return NextResponse.json({ error: 'This code is wrong, already used or expired. Start again on your computer.' }, { status: 404 });
  return NextResponse.json({ request });
}

const Schema = z.object({ user_code: z.string().min(8).max(16), approve: z.boolean() });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const user = await signedIn(req);
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await underLimit(user.id))) return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const ok = await new DeviceAuthRepo().decide(user.id, parsed.data.user_code, parsed.data.approve);
  if (!ok) return NextResponse.json({ error: 'This code is wrong, already used or expired. Start again on your computer.' }, { status: 404 });
  return NextResponse.json({ ok: true, approved: parsed.data.approve });
}
