import { NextRequest, NextResponse } from 'next/server';
import { BridgeRepo } from '@/lib/bridge/repo';
import { authenticateDevice } from '@/lib/bridge/auth';

export const maxDuration = 60;

/**
 * Long-poll: the device holds this request open for up to ~25s and receives commands as
 * soon as an agent queues them. Also serves as the device's heartbeat.
 */
export async function POST(req: NextRequest) {
  const repo = new BridgeRepo();
  const device = await authenticateDevice(req, repo);
  if (!device) return NextResponse.json({ error: 'Invalid or revoked device token' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  await repo.touch(device.id, body?.capabilities);

  const waitMs = Math.min(25_000, Math.max(0, Number(body?.waitMs ?? 20_000)));
  const deadline = Date.now() + waitMs;
  while (true) {
    const commands = await repo.claimForDevice(device.id);
    if (commands.length || Date.now() >= deadline || req.signal.aborted) {
      return NextResponse.json({ commands });
    }
    await new Promise((r) => setTimeout(r, 600));
  }
}
