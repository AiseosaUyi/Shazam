import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { BridgeRepo, ONLINE_WINDOW_MS } from '@/lib/bridge/repo';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const devices = await new BridgeRepo().listDevices(user.id);
  return NextResponse.json({
    devices: devices.map((d) => ({ ...d, online: Boolean(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS) })),
  });
}
