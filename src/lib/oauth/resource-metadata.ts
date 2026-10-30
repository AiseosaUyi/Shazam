import { NextRequest, NextResponse } from 'next/server';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' };

/** RFC 9728 protected resource metadata for /api/mcp (resource must equal the MCP URL exactly). */
export function protectedResourceMetadata(req: NextRequest) {
  const origin = process.env.APP_URL || req.nextUrl.origin;
  return NextResponse.json(
    { resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: ['tasks'], bearer_methods_supported: ['header'], resource_name: 'Shazam' },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' } }
  );
}

export function metadataOptions() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
