import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { loadSuggestContext } from '@/lib/agents/context';
import { GATEWAY_FREE_CHAINS } from '@/lib/agent/resolve';

/** What is actually online for this user right now (drives the system strip). */
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const ctx = await loadSuggestContext(user.id);
  const gateway = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
  const freeModels = gateway ? new Set(Object.values(GATEWAY_FREE_CHAINS).flat()).size : 0;
  return NextResponse.json({ ...ctx, freeModels });
}
