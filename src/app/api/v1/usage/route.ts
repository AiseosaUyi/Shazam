import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await repo.getUsageSummary(user.id);
    const pref = await repo.getUserPreferences(user.id);
    const monthlySpendUSD = await repo.getMonthlySpendUSD(user.id);
    const budgetRemainingUSD = Math.max(0, pref.monthlyBudgetUSD - monthlySpendUSD);

    return NextResponse.json({
      summary,
      monthlyBudgetUSD: pref.monthlyBudgetUSD,
      monthlySpendUSD,
      budgetRemainingUSD,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch usage.' }, { status: 500 });
  }
}
