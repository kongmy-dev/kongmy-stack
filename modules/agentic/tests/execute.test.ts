import { test, expect } from 'bun:test'
import { z } from 'zod'
import { defineTool, createRegistry, createMcpHandler, type ToolResult, type AuditEntry } from '../src/index'

// ─── Test Fixtures ───────────────────────────────────────────────────────────

let auditLog: AuditEntry[] = []
const mockAuthz = {
  permissions: new Set<string>(),
  assert(permission: string) {
    if (!this.permissions.has(permission)) {
      throw new Error(`Access denied: ${permission}`)
    }
  },
  can(permission: string) {
    return this.permissions.has(permission)
  },
}

const auditWriter = async (entry: AuditEntry) => {
  auditLog.push(entry)
}

const logger = {
  info: (msg: string, data?: unknown) => console.log(`[INFO] ${msg}`, data),
  error: (msg: string, err?: unknown) => console.error(`[ERROR] ${msg}`, err),
}

// Test tools
const readToolSchema = z.object({ id: z.string().describe('Resource ID') })

const readTool = defineTool({
  name: 'get_item',
  description: 'Fetch an item by ID.',
  inputSchema: readToolSchema,
  permission: 'items:read',
  effect: 'read',
  handler: async (input, ctx) => {
    return {
      ok: true,
      summary: `Fetched item ${input.id}.`,
      data: { id: input.id, name: `Item ${input.id}` },
    }
  },
})

const writeTool = defineTool({
  name: 'update_item',
  description: 'Update an item (write).',
  inputSchema: z.object({ id: z.string().describe('Item ID'), value: z.string().describe('New value') }),
  permission: 'items:write',
  effect: 'write',
  handler: async (input, ctx) => {
    if (ctx.autonomy === 'suggest') {
      throw new Error('write tool should not be called at suggest level')
    }
    return {
      ok: true,
      summary: `Updated item ${input.id} to ${input.value}.`,
      data: { id: input.id, value: input.value },
    }
  },
})

const outboundTool = defineTool({
  name: 'send_message',
  description: 'Send a message externally (outbound).',
  inputSchema: z.object({ to: z.string().describe('Recipient'), body: z.string().describe('Message body') }),
  permission: 'messages:send',
  effect: 'outbound',
  handler: async (input, ctx) => {
    if (ctx.autonomy !== 'auto') {
      throw new Error('outbound tool should only be called at auto level')
    }
    return {
      ok: true,
      summary: `Message sent to ${input.to}.`,
      data: { to: input.to, sent: true },
    }
  },
})

// ─── Tests ───────────────────────────────────────────────────────────────────

test('tool definition validates name format', () => {
  expect(() => {
    defineTool({
      name: 'InvalidName',
      description: 'Bad name',
      inputSchema: z.object({}),
      permission: 'test',
      effect: 'read',
      handler: async () => ({ ok: true, summary: 'test' }),
    })
  }).toThrow('lowercase snake_case')
})

test('tool definition requires description', () => {
  expect(() => {
    defineTool({
      name: 'test_tool',
      description: '',
      inputSchema: z.object({}),
      permission: 'test',
      effect: 'read',
      handler: async () => ({ ok: true, summary: 'test' }),
    })
  }).toThrow('description required')
})

test('zod schema carries .describe() in introspection', () => {
  const schema = z.object({
    id: z.string().describe('Resource ID'),
    name: z.string().describe('Resource name'),
  })

  // zod v4 toJSONSchema() includes descriptions
  const jsonSchema = (schema as any).toJSONSchema?.()
  expect(jsonSchema?.properties?.id?.description).toBe('Resource ID')
  expect(jsonSchema?.properties?.name?.description).toBe('Resource name')
})

test('input validation failure returns ok:false with details', async () => {
  auditLog = []
  mockAuthz.permissions.add('items:read')

  const execute = createRegistry([readTool])
  const result = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'get_item', input: { id: 123 }, autonomy: 'auto' },
  )

  expect(result.ok).toBe(false)
  expect(result.error?.code).toBe('VALIDATION_ERROR')
  expect(result.error?.details).toBeDefined()

  // Check audit: validation error recorded
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('validation_error')
})

test('authz.assert throws → denied audit record', async () => {
  auditLog = []
  mockAuthz.permissions.clear()

  const execute = createRegistry([readTool])
  const result = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'get_item', input: { id: 'test' }, autonomy: 'auto' },
  )

  expect(result.ok).toBe(false)
  expect(result.error?.code).toBe('UNAUTHORIZED')

  // Check audit: denied recorded
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('denied')
})

test('success execution records audit with autonomy level', async () => {
  auditLog = []
  mockAuthz.permissions.add('items:read')

  const execute = createRegistry([readTool])
  const result = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'get_item', input: { id: 'abc' }, autonomy: 'assist' },
  )

  expect(result.ok).toBe(true)
  expect(result.summary).toContain('Fetched item abc')

  // Check audit: success recorded with autonomy level
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('success')
  expect(auditLog[0]!.autonomyLevel).toBe('assist')
})

test('suggest-level write tool returns draft without handler invocation', async () => {
  auditLog = []
  mockAuthz.permissions.add('items:write')

  let handlerCalled = false
  const spy = defineTool({
    ...writeTool,
    handler: async (input, ctx) => {
      handlerCalled = true
      return { ok: true, summary: 'updated' }
    },
  })

  const execute = createRegistry([spy])
  const result = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'update_item', input: { id: '123', value: 'new' }, autonomy: 'suggest' },
  )

  expect(result.ok).toBe(true)
  expect((result.data as any)?.draft).toBe(true)
  expect(handlerCalled).toBe(false)

  // Audit: success with draft mode
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('success')
})

test('assist-level write tool runs handler', async () => {
  auditLog = []
  mockAuthz.permissions.add('items:write')

  let handlerCalled = false
  const spy = defineTool({
    ...writeTool,
    handler: async (input, ctx) => {
      handlerCalled = true
      return { ok: true, summary: `Updated ${input.id}.` }
    },
  })

  const execute = createRegistry([spy])
  const result = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'update_item', input: { id: '456', value: 'new' }, autonomy: 'assist' },
  )

  expect(result.ok).toBe(true)
  expect(handlerCalled).toBe(true)
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('success')
})

test('suggest/assist-level outbound tool returns draft, auto runs', async () => {
  auditLog = []
  mockAuthz.permissions.add('messages:send')

  let callCount = 0
  const spy = defineTool({
    ...outboundTool,
    handler: async (input, ctx) => {
      callCount++
      return { ok: true, summary: `Sent to ${input.to}.`, data: { sent: true } }
    },
  })

  const execute = createRegistry([spy])

  // Suggest: draft, no call
  auditLog = []
  callCount = 0
  const suggestResult = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'send_message', input: { to: 'user@example.com', body: 'hi' }, autonomy: 'suggest' },
  )
  expect(suggestResult.ok).toBe(true)
  expect((suggestResult.data as any)?.draft).toBe(true)
  expect(callCount).toBe(0)
  expect(auditLog[0]!.outcome).toBe('success')

  // Assist: draft, no call
  auditLog = []
  callCount = 0
  const assistResult = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'send_message', input: { to: 'user@example.com', body: 'hi' }, autonomy: 'assist' },
  )
  expect(assistResult.ok).toBe(true)
  expect((assistResult.data as any)?.draft).toBe(true)
  expect(callCount).toBe(0)

  // Auto: runs handler
  auditLog = []
  callCount = 0
  const autoResult = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'send_message', input: { to: 'user@example.com', body: 'hi' }, autonomy: 'auto' },
  )
  expect(autoResult.ok).toBe(true)
  expect(callCount).toBe(1)
  expect(auditLog[0]!.outcome).toBe('success')
})

test('MCP tools/list filters by authz.can()', async () => {
  mockAuthz.permissions.clear()
  mockAuthz.permissions.add('items:read') // only read

  const execute = createRegistry([readTool, writeTool, outboundTool])

  const ctx = {
    config: { authz: mockAuthz, auditWrite: auditWriter, logger },
    tools: [readTool, writeTool, outboundTool],
  }

  const handler = createMcpHandler([readTool, writeTool, outboundTool], execute, async () => ctx)

  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })

  const res = await handler(req)
  const data = await res.json()

  // Only readable tool should appear
  const toolNames = data.result.tools.map((t: any) => t.name)
  expect(toolNames).toContain('get_item')
  expect(toolNames).not.toContain('update_item')
  expect(toolNames).not.toContain('send_message')
})

test('MCP tools/call delegates to registry.execute (same audit path)', async () => {
  auditLog = []
  mockAuthz.permissions.add('items:read')

  const execute = createRegistry([readTool])
  const ctx = {
    config: { authz: mockAuthz, auditWrite: auditWriter, logger },
    tools: [readTool],
  }

  const handler = createMcpHandler([readTool], execute, async () => ctx)

  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_item', arguments: { id: 'xyz' } },
    }),
  })

  const res = await handler(req)
  const data = await res.json()

  expect(data.result.isError).toBe(false)
  expect(data.result.content[0].text).toContain('Fetched item xyz')

  // Audit should have one entry (from registry.execute)
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.toolName).toBe('get_item')
  expect(auditLog[0]!.outcome).toBe('success')
})

test('MCP JSON-RPC error handling', async () => {
  const execute = createRegistry([readTool])
  const ctx = {
    config: { authz: mockAuthz, auditWrite: auditWriter, logger },
    tools: [readTool],
  }
  const handler = createMcpHandler([readTool], execute, async () => ctx)

  // Malformed JSON
  let req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{invalid json}',
  })
  let res = await handler(req)
  let data = await res.json()
  expect(data.error.code).toBe(-32700)

  // Missing method
  req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1 }),
  })
  res = await handler(req)
  data = await res.json()
  expect(data.error.code).toBe(-32600)

  // Unknown method
  req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown_method' }),
  })
  res = await handler(req)
  data = await res.json()
  expect(data.error.code).toBe(-32601)
})

test('unknown tool returns TOOL_NOT_FOUND', async () => {
  auditLog = []
  const execute = createRegistry([readTool])
  const result = await execute(
    { authz: mockAuthz, auditWrite: auditWriter, logger },
    { toolName: 'nonexistent', input: {}, autonomy: 'auto' },
  )

  expect(result.ok).toBe(false)
  expect(result.error?.code).toBe('TOOL_NOT_FOUND')
  expect(auditLog[0]!.outcome).toBe('error')
  expect(auditLog[0]!.errorCode).toBe('TOOL_NOT_FOUND')
})

test('DEFECT 1 FIX: MCP tools/call respects autonomy threading (default suggest)', async () => {
  mockAuthz.permissions.add('messages:send')
  let handlerCalled = false

  const spy = defineTool({
    ...outboundTool,
    handler: async (input, ctx) => {
      handlerCalled = true
      return { ok: true, summary: `Sent to ${input.to}.` }
    },
  })

  const execute = createRegistry([spy])

  // Test 1: getCtx returns no autonomy → defaults to 'suggest' → outbound tool returns draft, no handler call
  auditLog = []
  handlerCalled = false
  const ctx1 = {
    config: { authz: mockAuthz, auditWrite: auditWriter, logger },
    tools: [spy],
    // autonomy not provided → should default to 'suggest'
  }
  const handler1 = createMcpHandler([spy], execute, async () => ctx1)

  const req1 = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'send_message', arguments: { to: 'user@example.com', body: 'hi' } },
    }),
  })

  const res1 = await handler1(req1)
  const data1 = await res1.json()

  expect(handlerCalled).toBe(false) // Handler should NOT be called at suggest level
  expect(data1.result.isError).toBe(false) // but result is ok (draft)
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('success')

  // Test 2: getCtx returns autonomy='auto' → outbound tool runs handler
  auditLog = []
  handlerCalled = false
  const ctx2 = {
    config: { authz: mockAuthz, auditWrite: auditWriter, logger },
    tools: [spy],
    autonomy: 'auto' as const,
  }
  const handler2 = createMcpHandler([spy], execute, async () => ctx2)

  const req2 = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'send_message', arguments: { to: 'user@example.com', body: 'hi' } },
    }),
  })

  const res2 = await handler2(req2)
  const data2 = await res2.json()

  expect(handlerCalled).toBe(true) // Handler runs at auto level
  expect(data2.result.isError).toBe(false)
  expect(auditLog.length).toBe(1)
})

test('DEFECT 2 FIX: MCP tools/call denied attempt audits (outcome=denied)', async () => {
  mockAuthz.permissions.clear() // User has NO permissions

  const execute = createRegistry([readTool])

  const ctx = {
    config: { authz: mockAuthz, auditWrite: auditWriter, logger },
    tools: [readTool],
    autonomy: 'auto' as const,
  }

  const handler = createMcpHandler([readTool], execute, async () => ctx)

  auditLog = []
  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_item', arguments: { id: 'test' } },
    }),
  })

  const res = await handler(req)
  const data = await res.json()

  // Response must be isError:true (ok:false from registry.execute)
  expect(data.result.isError).toBe(true)

  // Audit must record the denial (NOT bypassed by pre-check)
  expect(auditLog.length).toBe(1)
  expect(auditLog[0]!.outcome).toBe('denied')
  expect(auditLog[0]!.toolName).toBe('get_item')
  expect(auditLog[0]!.errorCode).toBe('UNAUTHORIZED')
})
