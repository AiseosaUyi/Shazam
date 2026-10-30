import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BridgeRepo } from '@/lib/bridge/repo';

const Schema = z.object({
  code: z.string().min(6).max(16),
  kind: z.enum(['desktop', 'browser']),
  name: z.string().min(1).max(80),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

/** Device exchanges a pairing code for a long-lived device token (shown once). */
export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid registration request' }, { status: 400 });
  const out = await new BridgeRepo().registerDevice(parsed.data.code, parsed.data.kind, parsed.data.name, parsed.data.capabilities || {});
  if (!out) return NextResponse.json({ error: 'Pairing code is invalid, expired or already used. Generate a new one in Shazam → Connections.' }, { status: 401 });
  return NextResponse.json({ token: out.token, device: { id: out.device.id, kind: out.device.kind, name: out.device.name } });
}
