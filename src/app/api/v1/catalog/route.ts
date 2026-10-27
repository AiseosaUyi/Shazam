import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const models = await db.getModels();
    const routes = await db.getRoutes();
    const providers = await db.getProviders();

    return NextResponse.json({
      success: true,
      data: {
        models,
        routes,
        providers,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
