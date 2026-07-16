import { z } from 'zod'
import type { ToolDefinition, ToolResult } from './tool.js'
import type { RegistryConfig, ExecuteRequest } from './registry.js'

/**
 * JSON-RPC 2.0 MCP transport handler (fetch-handler factory).
 * Implements `initialize`, `tools/list` (filtered by authz.can()), and `tools/call`
 * (delegates to registry.execute — same audited door, no bypass).
 *
 * Factory pattern: createMcpHandler(registry, getCtx) returns `(req: Request) => Promise<Response>`.
 * Consumer wires to GET /mcp or POST /api/mcp as needed.
 */

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

const SERVER_INFO = { name: 'agentic-mcp', version: '0.1.0' }
const PROTOCOL_VERSION = '2024-11-05'

/**
 * Create an MCP HTTP handler.
 *
 * @param tools - Tool definitions to expose
 * @param execute - The registry.execute function (from createRegistry)
 * @param getCtx - Async function that extracts RegistryConfig + tools + autonomy level from HTTP Request.
 *                 Called for each request to thread auth/audit/logger/autonomy from the request context.
 *                 autonomy defaults to 'suggest' (safest) if not provided.
 */
export function createMcpHandler(
  tools: ToolDefinition[],
  execute: (
    config: RegistryConfig,
    req: ExecuteRequest,
  ) => Promise<ToolResult & { data?: unknown }>,
  getCtx: (req: Request) => Promise<{ config: RegistryConfig; tools: ToolDefinition[]; autonomy?: 'suggest' | 'assist' | 'auto' }>,
): (req: Request) => Promise<Response> {
  return async (httpReq: Request): Promise<Response> => {
    try {
      const contentType = httpReq.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        return jsonRpcError(null, -32700, 'Parse error: expected JSON')
      }

      let jsonRpcReq: any
      try {
        jsonRpcReq = await httpReq.json()
      } catch (e) {
        return jsonRpcError(null, -32700, 'Parse error: invalid JSON')
      }

      // Validate JSON-RPC 2.0 structure
      if (!jsonRpcReq.jsonrpc || jsonRpcReq.jsonrpc !== '2.0') {
        return jsonRpcError((jsonRpcReq as JsonRpcRequest).id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"')
      }
      if (!jsonRpcReq.method || typeof jsonRpcReq.method !== 'string') {
        return jsonRpcError(
          jsonRpcReq.id ?? null,
          -32600,
          'Invalid Request: method required and must be string',
        )
      }

      const { config, tools: contextTools, autonomy } = await getCtx(httpReq)
      const effectiveAutonomy = autonomy ?? 'suggest' // Default to safest level

      // Dispatch JSON-RPC methods
      switch (jsonRpcReq.method) {
        case 'initialize': {
          return jsonRpcOk(jsonRpcReq.id ?? null, {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: SERVER_INFO,
            capabilities: { tools: { listChanged: false } },
          })
        }

        case 'notifications/initialized': {
          // Notification: no response
          return jsonRpcNotification()
        }

        case 'tools/list': {
          // Filter tools: only include those the caller can execute (authz.can).
          const accessibleTools = contextTools.filter((tool) => config.authz.can(tool.permission))

          // Derive JSON Schema from zod (v4 supports z.toJSONSchema()).
          const toolsResponse = accessibleTools.map((tool) => {
            // Use zod v4's toJSONSchema() to derive schema from zod definition.
            const jsonSchema = (tool.inputSchema as any).toJSONSchema?.()

            return {
              name: tool.name,
              description: tool.description,
              inputSchema: jsonSchema || { type: 'object', properties: {} },
            }
          })

          return jsonRpcOk(jsonRpcReq.id ?? null, { tools: toolsResponse })
        }

        case 'tools/call': {
          const toolName = String(jsonRpcReq.params?.name ?? '')
          const args = (jsonRpcReq.params?.arguments as Record<string, unknown>) ?? {}

          if (!toolName) {
            return jsonRpcError(
              jsonRpcReq.id ?? null,
              -32602,
              'Invalid params: name (tool name) required',
            )
          }

          const tool = contextTools.find((t) => t.name === toolName)
          if (!tool) {
            return jsonRpcError(jsonRpcReq.id ?? null, -32602, `Unknown tool: ${toolName}`)
          }

          // Delegate to registry.execute (same audited door as REST). Authorization is checked there,
          // and ALL outcomes (success, denial, error) are audited (ADR-0010).
          const result = await execute(config, {
            toolName,
            input: args,
            autonomy: effectiveAutonomy,
          })

          // MCP response format: content (text summary) + structuredContent (data) + isError.
          return jsonRpcOk(jsonRpcReq.id ?? null, {
            content: [{ type: 'text', text: result.summary }],
            structuredContent: result.data ?? null,
            isError: !result.ok,
          })
        }

        default: {
          return jsonRpcError(jsonRpcReq.id ?? null, -32601, `Method not found: ${jsonRpcReq.method}`)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return jsonRpcError(null, -32603, `Internal error: ${msg}`)
    }
  }
}

function jsonRpcOk(id: string | number | null, result: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

function jsonRpcError(id: string | number | null, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

function jsonRpcNotification(): Response {
  // Notification: no response (HTTP 204 or empty response).
  return new Response(null, { status: 204 })
}
