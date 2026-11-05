import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ actions: await new PlatformRepo().listPendingActions(user.id) });
}
