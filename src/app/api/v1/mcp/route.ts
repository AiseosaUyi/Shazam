import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const AddMcpServerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  url: z.string().url('Must be a valid HTTP/HTTPS URL'),
  transport: z.enum(['sse', 'http', 'websocket']).default('sse'),
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

  // Example discovered tools seed or remote discover
  const initialTools = [
    { name: `${name.toLowerCase().replace(/\s+/g, '_')}_query`, description: `Query ${name} data via Model Context Protocol` },
    { name: `${name.toLowerCase().replace(/\s+/g, '_')}_mutate`, description: `Create or update items in ${name}` },
  ];

  await repo.createMcpServer(user.id, {
    id,
    name,
    url,
    transport,
    encryptedAuth: authToken || undefined,
    toolsCache: initialTools,
  });

  const servers = await repo.getMcpServers(user.id);
  const created = servers.find((s) => s.id === id);

  return NextResponse.json({ server: created }, { status: 201 });
}
