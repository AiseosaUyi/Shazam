import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { BridgeRepo } from '@/lib/bridge/repo';
import { errMessage } from '@/lib/errors';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const ok = await new BridgeRepo().revokeDevice(user.id, id);
  return NextResponse.json({ success: ok }, { status: ok ? 200 : 404 });
}
