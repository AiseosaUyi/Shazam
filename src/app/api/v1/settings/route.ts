import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const UpdateSettingsSchema = z.object({
  defaultCostPolicy: z
    .enum(['free_only', 'lowest_cost', 'balanced', 'best_quality', 'manual_pin'])
    .optional(),
  maxCostPerTaskUSD: z.number().min(0.001).max(100).optional(),
  monthlyBudgetUSD: z.number().min(0).max(10000).optional(),
  privacyMode: z.enum(['standard', 'strict']).optional(),
  retentionDays: z.number().min(1).max(365).optional(),
  allowedProviders: z.array(z.string()).nullable().optional(),
  preferredRegion: z.string().nullable().optional(),
  autoFallbackEnabled: z.boolean().optional(),
  allowPaidFallback: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const preferences = await repo.getUserPreferences(user.id);
  return NextResponse.json({ preferences });
}

export async function PATCH(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = UpdateSettingsSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid parameters.' },
      { status: 400 }
    );
  }

  const updated = await repo.updateUserPreferences(user.id, parseResult.data);
  return NextResponse.json({ success: true, preferences: updated });
}
