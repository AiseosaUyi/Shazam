import { NextRequest, NextResponse } from 'next/server';
import { OAuthServer } from '@/lib/oauth/server';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };

/** RFC 7591 dynamic client registration (public clients, PKCE required). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const redirectUris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u: unknown) => typeof u === 'string') : [];
  try {
    const c = await new OAuthServer().registerClient(String(body?.client_name || 'MCP client'), redirectUris);
    return NextResponse.json(
      { ...c, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000) },
      { status: 201, headers: CORS }
    );
  } catch {
    return NextResponse.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https or loopback http URLs.' }, { status: 400, headers: CORS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
