import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireUser } from '@/lib/auth/session';
import { DbRepo } from '@/lib/db/repo';
import { getDb } from '@/lib/env';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      onboarded: user.onboarded,
      createdAt: user.createdAt,
    },
  });
}

/**
 * Delete the signed-in account and everything stored for it. The caller must confirm by
 * sending their own email address. Child tables are cleared explicitly (not only via
 * ON DELETE CASCADE) because SQLite foreign-key enforcement depends on a per-connection pragma.
 */
const USER_TABLES = [
  'bridge_commands', 'bridge_pairing_codes', 'bridge_devices',
  'job_runs', 'scheduled_jobs', 'pending_actions', 'agent_questions', 'agent_runs',
  'messages', 'conversations', 'feedback', 'usage_events', 'tasks',
  'workspace_proposals', 'workspace_checkpoints', 'workspace_files', 'projects',
  'media_assets', 'skills', 'mcp_servers', 'oauth_connections',
  'oauth_codes', 'oauth_refresh_tokens', 'access_tokens',
  'provider_credentials', 'user_preferences', 'sessions',
];

export async function DELETE(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const body: any = await req.json().catch(() => ({}));
  if (String(body?.confirmEmail || '').trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Type your account email to confirm.' }, { status: 400 });
  }

  const db: any = getDb();

  // Generated images and videos live in Blob storage: remove the files, not just the rows.
  try {
    const { results } = await db.prepare('SELECT url FROM media_assets WHERE user_id = ?').bind(user.id).all();
    const urls = (results || []).map((r: any) => r.url).filter((u: string) => /blob\.vercel-storage\.com/.test(u));
    if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) {
      const { del } = await import('@vercel/blob');
      await del(urls);
    }
  } catch (err) {
    console.error('[delete-account] blob cleanup failed', err instanceof Error ? errMessage(err) : err);
  }

  for (const table of USER_TABLES) {
    try {
      await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id).run();
    } catch {
      // Table absent in this database version: nothing to delete.
    }
  }
  for (const [sql, arg] of [
    ['DELETE FROM route_health WHERE scope = ?', user.id],
    ['DELETE FROM audit_events WHERE actor_id = ?', user.id],
    ['DELETE FROM waitlist WHERE email = ?', user.email.toLowerCase()],
    ['DELETE FROM users WHERE id = ?', user.id],
  ] as const) {
    try {
      await db.prepare(sql).bind(arg).run();
    } catch {
      /* ignore missing tables */
    }
  }

  const res = NextResponse.json({ deleted: true });
  res.cookies.delete('shazam_session');
  res.cookies.delete('shazam_vault');
  return res;
}
