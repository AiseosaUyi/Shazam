import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { BridgeRepo } from '@/lib/bridge/repo';
import { errMessage } from '@/lib/errors';

/** Signed-in user asks for a one-time pairing code to enter in the desktop app or extension. */
export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const { code, expiresAt } = await new BridgeRepo().createPairingCode(user.id);
  return NextResponse.json({ code, expiresAt, server: req.nextUrl.origin });
}
