import { createFileRoute } from '@tanstack/react-router';
import { isJsonObject, isNonEmptyString, readJsonUpTo, type JsonObject } from '@flarewatch/shared';
import { getConfig, isPrivateOnly } from '@/lib/config';
import { getCorsHeaders } from '@/lib/cors';
import { readVisitorSnapshot } from '@/lib/hub-cache';
import { callStatusTool, MAX_INCIDENTS, mcpTools, type ToolArgs } from '@/lib/mcp-tools';

const PROTOCOL_VERSION = '2025-11-25';
// The tools surface is the same in each of these, so a client on any of them can talk to us.
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, '2025-06-18', '2025-03-26'];
const MAX_BODY_BYTES = 16 * 1024;

async function handle({ request }: { request: Request }): Promise<Response> {
  const config = getConfig();
  const headers = {
    ...getCorsHeaders(request, config.statusPage?.apiCorsOrigins),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
    'Cache-Control': 'no-store',
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  const error = (id: string | number | null, code: number, message: string, status = 400) =>
    reply({ jsonrpc: '2.0', id, error: { code, message } }, status);

  if (isPrivateOnly(config)) return reply({ error: 'Not found' }, 404);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin && !headers['Access-Control-Allow-Origin']) {
    return error(null, -32600, 'Invalid origin', 403);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } });
  }
  const version = request.headers.get('MCP-Protocol-Version');
  if (version !== null && !SUPPORTED_VERSIONS.includes(version)) {
    return error(null, -32602, 'Unsupported protocol version', 400);
  }
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') {
    return error(null, -32600, 'Content-Type must be application/json');
  }
  let message: unknown;
  try {
    message = await readJsonUpTo(request, MAX_BODY_BYTES);
  } catch (cause) {
    return error(
      null,
      cause instanceof SyntaxError ? -32700 : -32600,
      cause instanceof SyntaxError ? 'Parse error' : 'Invalid or oversized request body',
    );
  }
  if (
    !isJsonObject(message) ||
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string' ||
    ('id' in message &&
      typeof message.id !== 'string' &&
      (typeof message.id !== 'number' || !Number.isInteger(message.id))) ||
    (message.params !== undefined && !isJsonObject(message.params))
  ) {
    return error(null, -32600, 'Invalid Request');
  }
  if (!('id' in message)) return new Response(null, { status: 202, headers });
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const params = message.params ?? {};
  const result = (body: unknown) => reply({ jsonrpc: '2.0', id, result: body });
  switch (message.method) {
    case 'initialize':
      if (
        !isJsonObject(params.capabilities) ||
        !isJsonObject(params.clientInfo) ||
        typeof params.clientInfo.name !== 'string' ||
        typeof params.clientInfo.version !== 'string'
      ) {
        return error(id, -32602, 'Invalid initialize parameters');
      }
      // The spec: echo a supported version, else answer with the latest one and let the client decide.
      return result({
        protocolVersion:
          typeof params.protocolVersion === 'string' &&
          SUPPORTED_VERSIONS.includes(params.protocolVersion)
            ? params.protocolVersion
            : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'flarewatch', version: '1.0.0' },
      });
    case 'ping':
      return result({});
    case 'tools/list':
      return result({ tools: mcpTools });
    case 'tools/call': {
      const tool = mcpTools.find((candidate) => candidate.name === params.name);
      const raw = params.arguments === undefined ? {} : params.arguments;
      if (!tool || !isJsonObject(raw))
        return error(id, -32602, 'Unknown tool or invalid arguments');
      const args = toolArgs(tool, raw);
      if (!args) return error(id, -32602, 'Invalid tool arguments');
      try {
        return result(callStatusTool(tool.name, args, await readVisitorSnapshot()));
      } catch (cause) {
        console.error('Error in /mcp:', cause);
        return error(id, -32603, 'Internal error', 500);
      }
    }
    default:
      return error(id, -32601, 'Method not found', 200);
  }
}

function toolArgs(tool: (typeof mcpTools)[number], raw: JsonObject): ToolArgs | null {
  if (Object.keys(raw).some((key) => !(key in tool.inputSchema.properties))) return null;
  const { id, monitorId, limit } = raw;
  if (tool.name === 'get_monitor' && !isNonEmptyString(id)) return null;
  if (monitorId !== undefined && !isNonEmptyString(monitorId)) return null;
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_INCIDENTS)
  )
    return null;
  return {
    ...(isNonEmptyString(id) && { id }),
    ...(isNonEmptyString(monitorId) && { monitorId }),
    ...(typeof limit === 'number' && { limit }),
  };
}

export const Route = createFileRoute('/mcp')({
  server: { handlers: { ANY: handle } },
});
