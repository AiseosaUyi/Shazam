import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { RunsRepo } from '@/lib/runs/repo';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ tokens: await new RunsRepo().listTokens(user.id) });
}

/** Creates a personal access token for an MCP client. The raw token is returned once. */
export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const { id, token } = await new RunsRepo().createToken(user.id, parsed.data.name);
  return NextResponse.json({ id, token, mcpUrl: `${req.nextUrl.origin}/api/mcp` }, { status: 201 });
}
