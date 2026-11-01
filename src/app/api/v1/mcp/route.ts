import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { encryptSecret } from '@/lib/crypto/vault';
import { listMcpTools } from '@/lib/mcp/client';

const AddMcpServerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  url: z.string().url('Must be a valid HTTP/HTTPS URL'),
  transport: z.enum(['sse', 'http', 'websocket']).default('http'),
  authToken: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const servers = await repo.getMcpServers(user.id);
  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = AddMcpServerSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { name, url, transport, authToken } = parseResult.data;
  const id = `mcp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  if (transport === 'websocket') {
    return NextResponse.json({ error: 'WebSocket MCP transport is not supported yet. Use the server\'s Streamable HTTP endpoint (usually ending in /mcp).' }, { status: 400 });
  }

  // Server-side fetch of a user-supplied URL: refuse private/loopback hosts (SSRF).
  const host = new URL(url).hostname.toLowerCase();
  if (
    new URL(url).protocol !== 'https:' ||
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
    host.startsWith('[')
  ) {
    return NextResponse.json({ error: 'MCP servers must be public https:// URLs. Local servers are reachable only through the Arcwork desktop bridge.' }, { status: 400 });
  }

  // Really connect: initialize a session and list the tools the server exposes.
  // We never save placeholder tools; a server we cannot reach is reported, not faked.
  let discoveredTools;
  try {
    discoveredTools = await listMcpTools({ url, authToken });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not connect to ${name}: ${err.message || 'unknown error'}` },
      { status: 422 }
    );
  }

  await repo.createMcpServer(user.id, {
    id,
    name,
    url,
    transport,
    encryptedAuth: authToken ? await encryptSecret(authToken) : undefined,
    toolsCache: discoveredTools,
  });

  const servers = await repo.getMcpServers(user.id);
  const created = servers.find((s) => s.id === id);

  return NextResponse.json({ server: created }, { status: 201 });
}
