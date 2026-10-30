import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BridgeRepo } from '@/lib/bridge/repo';
import { authenticateDevice } from '@/lib/bridge/auth';

const Schema = z.object({ id: z.string().max(64), ok: z.boolean(), result: z.unknown() });

export async function POST(req: NextRequest) {
  const repo = new BridgeRepo();
  const device = await authenticateDevice(req, repo);
  if (!device) return NextResponse.json({ error: 'Invalid or revoked device token' }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid result' }, { status: 400 });
  const ok = await repo.complete(device.id, parsed.data.id, parsed.data.ok, parsed.data.result);
  return NextResponse.json({ accepted: ok }, { status: ok ? 200 : 409 });
}
