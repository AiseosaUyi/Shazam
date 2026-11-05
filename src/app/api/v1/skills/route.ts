import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { parseSkillMarkdown, slugifySkill } from '@/lib/skills';
import { fetchSkillMarkdown } from '@/lib/skills/import-url';
import { errMessage } from '@/lib/errors';

const Mode = z.enum(['chat', 'cowork', 'code']);
const CreateSchema = z.union([
  z.object({ url: z.string().min(8).max(2000), modes: z.array(Mode).optional() }),
  z.object({ markdown: z.string().min(10).max(100_000), modes: z.array(Mode).optional() }),
  z.object({
    name: z.string().trim().min(1).max(64),
    description: z.string().trim().min(1).max(1024),
    instructions: z.string().trim().min(1).max(100_000),
    modes: z.array(Mode).optional(),
  }),
]);

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ skills: await new PlatformRepo().listSkills(user.id) });
}

/** Create a skill from fields, or import a SKILL.md file (open Agent Skills format). */
export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid skill' }, { status: 400 });

  let fields;
  try {
    fields = 'url' in parsed.data
      ? parseSkillMarkdown(await fetchSkillMarkdown(parsed.data.url))
      : 'markdown' in parsed.data
        ? parseSkillMarkdown(parsed.data.markdown)
        : { ...parsed.data, slug: slugifySkill(parsed.data.name) };
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 400 });
  }
  const skill = await new PlatformRepo().upsertSkill(user.id, { ...fields, modes: parsed.data.modes });
  return NextResponse.json({ skill }, { status: 201 });
}
