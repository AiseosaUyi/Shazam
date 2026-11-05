import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
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
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) || 'Failed to fetch usage.' }, { status: 500 });
  }
}
