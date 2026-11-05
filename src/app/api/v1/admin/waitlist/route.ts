import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireAdmin } from '@/lib/auth/session';
import { WaitlistRepo } from '@/lib/db/waitlist-repo';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ entries: await new WaitlistRepo().list() });
}

const PatchSchema = z.object({ id: z.string().min(1), status: z.enum(['pending', 'invited', 'declined']) });

export async function PATCH(req: NextRequest) {
  const repo = new DbRepo();
  let admin;
  try {
    admin = await requireAdmin(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Forbidden' }, { status: 403 });
  }
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const ok = await new WaitlistRepo().setStatus(parsed.data.id, parsed.data.status);
  await repo.recordAuditEvent({
    id: crypto.randomUUID(),
    actorId: admin.id,
    action: `waitlist_${parsed.data.status}`,
    targetType: 'waitlist',
    targetId: parsed.data.id,
    outcome: ok ? 'success' : 'failure',
  });
  if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
