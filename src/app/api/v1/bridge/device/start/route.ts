import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { clientIp } from '@/lib/auth/client-ip';
import { DeviceAuthRepo } from '@/lib/bridge/device-auth';

const Schema = z.object({
  kind: z.enum(['desktop', 'browser']).default('desktop'),
  name: z.string().min(1).max(80),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Desktop app / CLI starts a browser sign-in. Returns a secret device_code to poll with and a
 * short user_code the person checks on the approval page (RFC 8628 field names).
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = await new DbRepo().checkRateLimit(`bridge-device-start:${ip}`, 600, 20);
  if (!limit.allowed) return NextResponse.json({ error: 'Too many connection attempts. Wait a few minutes and try again.' }, { status: 429 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { deviceCode, userCode, expiresAt, interval } = await new DeviceAuthRepo().start({
    kind: parsed.data.kind,
    name: parsed.data.name,
    capabilities: parsed.data.capabilities || {},
    requesterIp: ip,
  });
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${origin}/connect`,
    verification_uri_complete: `${origin}/connect?code=${encodeURIComponent(userCode)}`,
    expires_in: Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000),
    interval,
  });
}
