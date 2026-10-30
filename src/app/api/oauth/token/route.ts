import { NextRequest, NextResponse } from 'next/server';
import { OAuthServer } from '@/lib/oauth/server';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const err = (error: string, description?: string, status = 400) =>
  NextResponse.json({ error, ...(description ? { error_description: description } : {}) }, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  const type = req.headers.get('content-type') || '';
  const params = type.includes('application/json')
    ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await req.text());
  const server = new OAuthServer();
  const grant = params.get('grant_type');

  if (grant === 'authorization_code') {
    const out = await server.exchangeCode({
      code: params.get('code') || '',
      client_id: params.get('client_id') || '',
      redirect_uri: params.get('redirect_uri') || '',
      code_verifier: params.get('code_verifier') || '',
    });
    if ('error' in out) return err(out.error!, (out as any).description);
    return NextResponse.json(out.tokens, { headers: { ...CORS, 'Cache-Control': 'no-store' } });
  }
  if (grant === 'refresh_token') {
    const out = await server.refresh({ refresh_token: params.get('refresh_token') || '', client_id: params.get('client_id') || undefined });
    if ('error' in out) return err(out.error!);
    return NextResponse.json(out.tokens, { headers: { ...CORS, 'Cache-Control': 'no-store' } });
  }
  return err('unsupported_grant_type');
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
