import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const kind = req.nextUrl.searchParams.get('kind');
  return NextResponse.json({ media: await new PlatformRepo().listMedia(user.id, kind === 'image' || kind === 'video' ? kind : undefined) });
}

