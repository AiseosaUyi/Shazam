import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import type { DbRepo } from '@/lib/db/repo';
import { decryptSecret } from '@/lib/crypto/vault';
import { callMcpTool, type McpTool } from './client';
import type { PlatformRepo } from '@/lib/db/platform-repo';
import { proposeOrRun, type ApprovalPolicy } from '@/lib/cowork/approval';
import { errMessage } from '@/lib/errors';

/**
 * Exposes every tool of the user's active MCP servers to an AI SDK agent as a real,
 * schema-typed tool. Names are namespaced as <server>__<tool> so servers can't collide.
 */

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'mcp';
}

function isMutating(name: string, description = ''): boolean {
  return /\b(create|update|delete|remove|send|post|write|insert|upsert|publish|archive|move|set|cancel|pay|charge|invite)/i.test(`${name} ${description}`);
}

export interface McpToolsetResult {
  tools: ToolSet;
  /** Human-readable inventory for the system prompt, so the model only names real tools. */
  inventory: string;
}

export async function buildMcpToolset(
  repo: DbRepo,
  userId: string,
  opts: { allowMutations?: boolean; platform?: PlatformRepo; approval?: ApprovalPolicy; onPendingAction?: (action: { id: string; summary: string }) => void } = {}
): Promise<McpToolsetResult> {
  const servers = (await repo.getMcpServers(userId)).filter((s) => s.status === 'active');
  const tools: ToolSet = {};
  const lines: string[] = [];

  for (const server of servers) {
    let authToken: string | undefined;
    const encrypted = await repo.getMcpServerAuth(userId, server.id);
    if (encrypted) {
      try {
        authToken = await decryptSecret(encrypted);
      } catch {
        authToken = undefined;
      }
    }
    const prefix = slug(server.name);
    const names: string[] = [];

    for (const t of (server.tools || []) as McpTool[]) {
      const toolName = `${prefix}__${slug(t.name)}`.slice(0, 64);
      const mutating = isMutating(t.name, t.description);
      names.push(t.name);
      tools[toolName] = dynamicTool({
        description: `[${server.name} MCP] ${t.description || t.name}${mutating ? ' (changes data in an external system)' : ''}`,
        inputSchema: jsonSchema((t.inputSchema as any) || { type: 'object', properties: {} }),
        execute: async (input) => {
          if (mutating && !opts.allowMutations) {
            if (opts.platform) {
              const summary = `${server.name}: ${t.name}(${JSON.stringify(input).slice(0, 300)})`;
              const run = await proposeOrRun(opts.platform, userId, 'mcp_call', summary, { serverId: server.id, tool: t.name, args: input }, opts.approval);
              if (run.auto) return `${run.ok ? 'DONE' : 'MCP tool error'}: ${run.result}`;
              const action = run.action;
              opts.onPendingAction?.({ id: action.id, summary });
              return `AWAITING USER APPROVAL (action ${action.id}): "${t.name}" on ${server.name} changes external data, so it was NOT run yet. Tell the user it is waiting for their approval in the chat.`;
            }
            return `NOT RUN: "${t.name}" on ${server.name} changes external data and needs the user's approval.`;
          }
          try {
            const result = await callMcpTool({ url: server.url, authToken }, t.name, (input as Record<string, unknown>) || {});
            return `${result.isError ? 'MCP tool error: ' : ''}${result.text.slice(0, 12000) || '(empty result)'}`;
          } catch (err) {
            return `MCP call failed: ${errMessage(err) || err}`;
          }
        },
      });
    }
    lines.push(`- ${server.name}: ${names.length ? names.join(', ') : '(no tools)'}`);
  }

  return {
    tools,
    inventory: lines.length
      ? `Connected MCP servers and their tools (call them as <server>__<tool>):\n${lines.join('\n')}`
      : 'No MCP servers are connected. If the user needs one, tell them to add it in Settings > MCP.',
  };
}
