import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const userId = 'user_default';
    const pref = await db.getUserPreference(userId);
    return NextResponse.json({ success: true, data: pref });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = 'user_default';
    const body = await req.json();

    const allowedFields = [
      'defaultCostPolicy',
      'maxCostPerTaskUSD',
      'monthlyBudgetUSD',
      'privacyMode',
      'allowedProviders',
      'disallowedProviders',
      'preferredRegion',
      'autoFallbackEnabled',
    ];

    const updates: any = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    const updated = await db.updateUserPreference(userId, updates);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
