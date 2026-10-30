import type { NextRequest } from 'next/server';
import { BridgeRepo, type BridgeDevice } from './repo';

export async function authenticateDevice(req: NextRequest, repo = new BridgeRepo()): Promise<BridgeDevice | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token ? repo.authenticate(token) : null;
}
