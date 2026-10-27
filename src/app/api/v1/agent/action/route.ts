import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Running code needs an isolated container, not available in this deployment',
    },
    { status: 400 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error: 'Direct filesystem access is disabled. Use /api/v1/workspace/files for isolated user workspaces.',
    },
    { status: 400 }
  );
}
