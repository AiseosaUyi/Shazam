import { NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { getLiveCatalog } from '@/lib/catalog';
import { errMessage } from '@/lib/errors';

export async function GET() {
  try {
    const repo = new DbRepo();
    const catalog = await getLiveCatalog(repo);
    return NextResponse.json({
      providers: catalog.providers,
      models: catalog.models,
      routes: catalog.routes,
    });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Failed to fetch catalog.' }, { status: 500 });
  }
}
