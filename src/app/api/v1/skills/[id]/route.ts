import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { toSkillMarkdown } from '@/lib/skills';
import { errMessage } from '@/lib/errors';

const Patch = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().min(1).max(1024).optional(),
  instructions: z.string().trim().min(1).max(100_000).optional(),
  modes: z.array(z.enum(['chat', 'cowork', 'code'])).optional(),
});

async function load(req: NextRequest, id: string) {
  const user = await requireUser(req, new DbRepo());
  const platform = new PlatformRepo();
  return { user, platform, skill: await platform.getSkill(user.id, id) };
}

/** GET ?format=md downloads the skill as SKILL.md. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await load(req, id);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.skill) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (req.nextUrl.searchParams.get('format') === 'md') {
    return new NextResponse(toSkillMarkdown(ctx.skill), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${ctx.skill.slug}-SKILL.md"` },
    });
  }
  return NextResponse.json({ skill: ctx.skill });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { id } = await params;
  let ctx;
  try {
    ctx = await load(req, id);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.skill) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const d = parsed.data;

  if (d.name || d.description || d.instructions || d.modes) {
    await ctx.platform.upsertSkill(ctx.user.id, {
      name: d.name ?? ctx.skill.name,
      slug: ctx.skill.slug,
      description: d.description ?? ctx.skill.description,
      instructions: d.instructions ?? ctx.skill.instructions,
      modes: d.modes ?? ctx.skill.modes,
      enabled: d.enabled ?? ctx.skill.enabled,
    });
  } else if (d.enabled !== undefined) {
    await ctx.platform.setSkillEnabled(ctx.user.id, ctx.skill.id, d.enabled);
  }
  return NextResponse.json({ skill: await ctx.platform.getSkill(ctx.user.id, ctx.skill.id) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { id } = await params;
  let ctx;
  try {
    ctx = await load(req, id);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.skill) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await ctx.platform.deleteSkill(ctx.user.id, ctx.skill.id);
  return NextResponse.json({ success: true });
}
