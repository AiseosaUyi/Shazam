import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const userId = 'user_default';
    const summary = await db.getUsageSummaryForUser(userId);
    const pref = await db.getUserPreference(userId);

    return NextResponse.json({
      success: true,
      data: {
        ...summary,
        monthlyBudgetUSD: pref.monthlyBudgetUSD,
        budgetRemainingUSD: Math.max(0, pref.monthlyBudgetUSD - summary.totalEstimatedCostUSD),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
