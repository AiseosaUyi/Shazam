import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { clientIp } from '@/lib/auth/client-ip';
import { DeviceAuthRepo } from '@/lib/bridge/device-auth';

const Schema = z.object({ device_code: z.string().min(8).max(128) });

/**
 * Device polls until the person approves. Errors use RFC 8628 codes: authorization_pending,
 * slow_down, access_denied, expired_token. Success returns the device token exactly once.
 */
export async function POST(req: NextRequest) {
  const limit = await new DbRepo().checkRateLimit(`bridge-device-token:${clientIp(req)}`, 60, 60);
  if (!limit.allowed) return NextResponse.json({ error: 'slow_down' }, { status: 429 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const out = await new DeviceAuthRepo().poll(parsed.data.device_code);
  switch (out.status) {
    case 'approved':
      return NextResponse.json({ token: out.token, device: { id: out.device.id, kind: out.device.kind, name: out.device.name }, account: { email: out.accountEmail } });
    case 'pending':
      return NextResponse.json({ error: 'authorization_pending' }, { status: 400 });
    case 'slow_down':
      return NextResponse.json({ error: 'slow_down' }, { status: 400 });
    case 'denied':
      return NextResponse.json({ error: 'access_denied', error_description: 'The connection was declined in the browser.' }, { status: 400 });
    default:
      return NextResponse.json({ error: 'expired_token', error_description: 'This connection request expired. Start again.' }, { status: 400 });
  }
}
