/**
 * Minimal MCP (Model Context Protocol) client for remote servers over Streamable HTTP,
 * with a fallback for servers that answer JSON-RPC over a single SSE response.
 * Spec: https://modelcontextprotocol.io/specification (transport: Streamable HTTP).
 *
 * Kept dependency-free so it runs on both Cloudflare Workers and Vercel Functions.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpConnection {
  url: string;
  authToken?: string;
}

const PROTOCOL_VERSION = '2025-06-18';

class McpSession {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private conn: McpConnection) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (this.conn.authToken) h.Authorization = `Bearer ${this.conn.authToken}`;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    const res = await fetch(this.conn.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(20000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`MCP server rejected credentials (HTTP ${res.status}). This server likely needs an OAuth sign-in or a valid bearer token.`);
    }
    if (!res.ok) {
      throw new Error(`MCP server returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    const contentType = res.headers.get('content-type') || '';
    const message = contentType.includes('text/event-stream')
      ? findSseResponse(await res.text(), id)
      : await res.json();

    if (!message) throw new Error(`MCP server sent no response for "${method}".`);
    if (message.error) throw new Error(`MCP error ${message.error.code}: ${message.error.message}`);
    return message.result;
  }

  async notify(method: string): Promise<void> {
    await fetch(this.conn.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'shazam-ai', version: '0.3.0' },
    });
    await this.notify('notifications/initialized');
  }
}

function findSseResponse(body: string, id: number): any {
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg.id === id) return msg;
    } catch {
      // Ignore keep-alives and partial frames
    }
  }
  return null;
}

/** Connects to a remote MCP server and returns the tools it really exposes. */
export async function listMcpTools(conn: McpConnection): Promise<McpTool[]> {
  const session = new McpSession(conn);
  await session.initialize();
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const result = await session.request('tools/list', cursor ? { cursor } : {});
    for (const t of result?.tools || []) {
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
    }
    cursor = result?.nextCursor;
  } while (cursor && tools.length < 500);
  return tools;
}

/** Invokes one tool on a remote MCP server and returns its text content. */
export async function callMcpTool(conn: McpConnection, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const session = new McpSession(conn);
  await session.initialize();
  const result = await session.request('tools/call', { name, arguments: args });
  const text = (result?.content || [])
    .map((c: any) => (c.type === 'text' ? c.text : `[${c.type} content]`))
    .join('\n');
  return { text, isError: Boolean(result?.isError) };
}
