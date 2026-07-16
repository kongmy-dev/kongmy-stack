# agentic-module

Audited command door (`registry.execute`), autonomy gate (suggest/assist/auto), and MCP JSON-RPC transport for agent/MCP tool access.

## Overview

This module provides the single authorized gateway for tools invoked by agents (via MCP) or humans (via REST action routes). The same `execute()` door is used for both transports — no bypass.

**Core principles (ADR-0004, ADR-0008, ADR-0010):**
- **One enforcement point:** all tool execution goes through `registry.execute()`, where authorization is checked and audit is written.
- **Autonomy orthogonal to permission:** `permission` (may) and `autonomy` (how-autonomously) are independent. A user may have the permission to send but only at 'auto' level (never 'suggest').
- **Audit at the door:** every attempt (success, denial, error) is logged before returning. Audit entry records tool name, autonomy level, outcome, error codes.
- **Descriptions mandatory:** all zod fields carry `.describe()` (CI-enforced), flowing into OpenAPI docs and MCP `tools/list`.

## Usage

### 1. Define Tools

Use `defineTool()` to wrap your business logic:

```typescript
import { defineTool } from 'agentic-module'
import { z } from 'zod'

const sendInvoice = defineTool({
  name: 'invoice_send',
  description: 'Send an invoice to the customer by email.',
  inputSchema: z.object({
    invoiceId: z.string().describe('The invoice ID to send'),
    email: z.string().email().describe('Recipient email address'),
  }),
  permission: 'invoices:send', // Permission required by authz.assert()
  effect: 'outbound', // 'read' | 'write' | 'outbound'
  handler: async (input, ctx) => {
    // input is already validated
    // ctx.autonomy is 'suggest' | 'assist' | 'auto'
    // For outbound tools, handler is NOT called if autonomy != 'auto'
    // (registry.execute() gates it and returns draft instead)

    await sendEmailViaSMTP(input.email, invoiceId: input.invoiceId)

    return {
      ok: true,
      summary: `Invoice ${input.invoiceId} sent to ${input.email}.`,
      data: { sentAt: new Date().toISOString() },
    }
  },
})
```

### 2. Create Registry

```typescript
import { createRegistry } from 'agentic-module'

const tools = [sendInvoice, /* ...other tools */ ]
const execute = createRegistry(tools)
```

### 3. Implement Seam Interfaces

The registry needs two seam implementations injected per-request:

```typescript
interface RegistryConfig {
  authz: { assert(permission: string): void; can(permission: string): boolean }
  auditWrite: (entry: AuditEntry) => Promise<void>
  logger?: { info(msg: string, data?: unknown): void; error(msg: string, err?: unknown): void }
}
```

**Example (in your API app):**

```typescript
// In your middleware or middleware factory:
const config: RegistryConfig = {
  authz: {
    assert(permission: string) {
      if (!ctx.user.hasPermission(permission)) {
        throw new Error(`Access denied: ${permission}`)
      }
    },
    can(permission: string) {
      return ctx.user.hasPermission(permission)
    },
  },
  auditWrite: async (entry) => {
    await db.insert(auditLog).values({
      toolName: entry.toolName,
      autonomyLevel: entry.autonomyLevel,
      outcome: entry.outcome,
      errorCode: entry.errorCode,
      timestamp: entry.timestamp,
    })
  },
  logger: ctx.logger,
}
```

### 4. Use via REST Action Route

Wiring a REST action route to the registry:

```typescript
// In your Hono app
app.post('/invoices/:id/send', async (c) => {
  const input = { invoiceId: c.req.param('id'), email: c.req.query('email') }
  const config = setupRegistryConfig(c) // your middleware

  const result = await execute(config, {
    toolName: 'invoice_send',
    input,
    autonomy: 'auto', // or read from user's setting
  })

  if (!result.ok) {
    return c.json({ error: result.error }, 400)
  }
  return c.json(result.data, 200)
})
```

### 5. Expose via MCP JSON-RPC

```typescript
import { createMcpHandler } from 'agentic-module'

const mcpHandler = createMcpHandler(tools, execute, async (req) => {
  // Extract request context: authz, audit writer, logger, autonomy
  const autonomy = getCallerAutonomy(req) // read from session/tenant settings

  return {
    config: setupRegistryConfig(req), // your context
    tools, // tools visible to this request
    autonomy, // 'suggest' | 'assist' | 'auto' (defaults to 'suggest' if omitted)
  }
})

// Example: getCallerAutonomy reads from request headers, JWT claims, or session
function getCallerAutonomy(req: Request): 'suggest' | 'assist' | 'auto' | undefined {
  const header = req.headers.get('x-autonomy-level')
  if (header === 'suggest' || header === 'assist' || header === 'auto') {
    return header
  }
  // Or read from tenant settings:
  // const tenant = await getTenantFromRequest(req)
  // return tenant.agentAutonomyLevel // undefined → defaults to 'suggest'
  return undefined // defaults to 'suggest' (safest level) in createMcpHandler
}

// Wire to HTTP: POST /api/mcp or similar
app.post('/api/mcp', mcpHandler)
```

The MCP handler implements JSON-RPC 2.0 with:
- `initialize` → protocol version, server info
- `tools/list` → tools filtered by `authz.can(permission)` (ADR-0008)
- `tools/call` → delegates to `registry.execute()` using threaded autonomy level (same audited door, all outcomes recorded)

## Autonomy Gate Semantics

The autonomy level gates tool execution **orthogonally** to permission:

| Tool Effect | Autonomy | Behavior |
|---|---|---|
| read | suggest / assist / auto | Always runs handler (autonomy not a gate for reads) |
| write | suggest | Returns draft; handler NOT called |
| write | assist / auto | Runs handler |
| outbound | suggest / assist | Returns draft; handler NOT called |
| outbound | auto | Runs handler |

**In all cases, audit is written** (success or draft recorded before returning).

## Audit Entry Structure

Every execution produces one `AuditEntry`:

```typescript
interface AuditEntry {
  toolName: string
  autonomyLevel: 'suggest' | 'assist' | 'auto'
  input: unknown // validated input
  outcome: 'success' | 'denied' | 'validation_error' | 'error'
  summary?: string // LLM-facing summary
  errorCode?: string // e.g., 'UNAUTHORIZED', 'VALIDATION_ERROR', 'HANDLER_ERROR'
  errorMessage?: string
  timestamp: string // ISO 8601
}
```

Your `auditWrite` hook is responsible for persistence (database, event log, etc.).

## ToolResult Format

All tool handlers return a **uniform result structure**:

```typescript
interface ToolResult {
  ok: boolean
  summary: string // Short English, written for LLM (always populated)
  data?: unknown // Trimmed structured data (not a dump)
  error?: { code: string; message: string; details?: unknown }
}
```

**Summary** is consumed by agents; keep it <100 words, actionable.  
**Data** is the structured response (trimmed — avoid raw row dumps).  
**Error** is never thrown; always mapped to `ok:false`.

## Contract Helpers

The zod contract defining a tool's input is the SSOT for:
1. Validation (in `registry.execute`)
2. JSON Schema derivation (in `tools/list`)
3. OpenAPI documentation (in REST routes)
4. Generated TypeScript client (in `apps/web`)
5. Form validation (in React forms via `zodResolver`)

Use `.describe()` on every field — it flows into all consumers and is CI-enforced.

```typescript
const schema = z.object({
  invoiceId: z.string().describe('The invoice ID (e.g., INV-2024-001)'),
  email: z.string().email().describe('Recipient email address'),
})
```

## Testing

The test suite covers:
- Input validation → `ok:false` with details
- Authorization denial → audit denial record
- Success → audit with autonomy level
- Draft mode: suggest/assist-level write/outbound tools return draft (handler NOT called)
- Auto mode: handler execution
- MCP `tools/list` filtering by `authz.can()`
- MCP `tools/call` delegates to same audit path
- JSON-RPC error handling (malformed, missing method, etc.)

Run tests:
```bash
bun test
```

## Integration Checklist

- [ ] Implement `RegistryConfig` seams (authz, audit writer, logger) in your app
- [ ] Define your domain tools with `defineTool()`
- [ ] Create registry: `const execute = createRegistry(tools)`
- [ ] Wire REST action routes to call `execute(config, req)`
- [ ] Wire MCP handler: `createMcpHandler(tools, execute, getCtx)`
- [ ] Ensure audit entries flow to your audit table/log
- [ ] Test authorization denials and draft mode behavior
- [ ] CI: enforce `.describe()` on all contract fields (describe-coverage script)

## See Also

- **ADR-0002:** Pattern vocabulary (seams + data, no class taxonomies)
- **ADR-0004:** API design (tool naming, `ToolResult` format, MCP-ready schemas)
- **ADR-0008:** AuthZ (permission vs. autonomy, one enforcement point)
- **ADR-0010:** Observability (audit at command door, tracing, metrics)
