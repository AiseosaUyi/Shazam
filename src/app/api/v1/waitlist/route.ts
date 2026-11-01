import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { WaitlistRepo } from '@/lib/db/waitlist-repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { clientIp } from '@/lib/auth/client-ip';

const JoinSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254).optional(),
  name: z.string().trim().max(120).optional(),
  useCase: z.string().trim().max(500).optional(),
  source: z.enum(['web', 'google', 'app']).optional(),
});

async function optionalUser(req: NextRequest, repo: DbRepo) {
  try {
    return await requireUser(req, repo);
  } catch {
    return null;
  }
}

/** Your own early-access status (signed in). */
export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  const user = await optionalUser(req, repo);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const entry = await new WaitlistRepo().getByEmail(user.email);
  return NextResponse.json({ status: entry?.status || null, joinedAt: entry?.createdAt || null });
}

/** Join the early-access list. Public; rate limited per IP. Signed-in users join with their account email. */
export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'CSRF validation failed.' }, { status: 403 });
  const repo = new DbRepo();

  const { allowed } = await repo.checkRateLimit(`waitlist:${clientIp(req)}`, 3600, 10);
  if (!allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });

  const parsed = JoinSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input.' }, { status: 400 });

  const user = await optionalUser(req, repo);
  const email = user?.email || parsed.data.email;
  if (!email) return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 });

  const { entry } = await new WaitlistRepo().join({
    email,
    name: parsed.data.name || user?.name || null,
    useCase: parsed.data.useCase || null,
    source: parsed.data.source || (user ? 'app' : 'web'),
    userId: user?.id || null,
  });

  // Anonymous callers get the same answer whether or not the email was already listed (no enumeration).
  return NextResponse.json(user ? { ok: true, status: entry.status } : { ok: true });
}
