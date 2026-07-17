import { z } from 'zod'
import type { ToolDefinition, ToolExecutionContext, ToolResult, AuditEntry } from './tool.js'

/**
 * Registry: single audited command door (ADR-0008, ADR-0010).
 * Flow: (1) validate input against zod → (2) authz.assert(permission) the ONE enforcement point
 * → (3) autonomy gate: suggest/assist may skip handler (return draft), auto runs it
 * → (4) audit write (always, even on deny/error) → (5) return ToolResult.
 *
 * Same door for REST action routes and MCP tools (no bypass). Audit entry records:
 * autonomy level, outcome, error codes. Errors map to structured {code, message} not thrown.
 */
export interface RegistryConfig {
  authz: { assert(permission: string): void; can(permission: string): boolean }
  auditWrite: (entry: AuditEntry) => Promise<void>
  logger?:
    | { info(msg: string, data?: unknown): void; error(msg: string, err?: unknown): void }
    | undefined
}

export interface ExecuteRequest<Input = unknown> {
  toolName: string
  input: Input
  autonomy: 'suggest' | 'assist' | 'auto'
}

/**
 * Create a registry from tool definitions.
 * Stores tools by name for dispatch in execute().
 */
export function createRegistry(tools: ToolDefinition[]) {
  const toolsByName = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    toolsByName.set(tool.name, tool)
  }

  /**
   * Execute a tool: the audited command door.
   * Returns ToolResult; errors never throw (map to ok:false).
   */
  return async function execute<Out = unknown>(
    config: RegistryConfig,
    req: ExecuteRequest,
  ): Promise<ToolResult & { data?: Out }> {
    const tool = toolsByName.get(req.toolName)
    const timestamp = new Date().toISOString()

    // Tool not found
    if (!tool) {
      const auditEntry: AuditEntry = {
        toolName: req.toolName,
        autonomyLevel: req.autonomy,
        input: req.input,
        outcome: 'error',
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: `Unknown tool: ${req.toolName}`,
        timestamp,
      }
      await config.auditWrite(auditEntry)
      return {
        ok: false,
        summary: `Tool not found: ${req.toolName}`,
        error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${req.toolName}` },
      }
    }

    // Step 1: Validate input against zod schema
    let input: unknown
    try {
      input = tool.inputSchema.parse(req.input)
    } catch (e) {
      let validationError: any
      if (e instanceof z.ZodError) {
        validationError = {
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          details: (e as z.ZodError).issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
          })),
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        validationError = { code: 'VALIDATION_ERROR', message: msg }
      }

      const auditEntry: AuditEntry = {
        toolName: req.toolName,
        autonomyLevel: req.autonomy,
        input: req.input,
        outcome: 'validation_error',
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Input validation failed',
        timestamp,
      }
      await config.auditWrite(auditEntry)

      return {
        ok: false,
        summary: 'Input validation failed',
        error: validationError,
      }
    }

    // Step 2: Authorization check (the ONE enforcement point, ADR-0008)
    try {
      config.authz.assert(tool.permission)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const auditEntry: AuditEntry = {
        toolName: req.toolName,
        autonomyLevel: req.autonomy,
        input,
        outcome: 'denied',
        errorCode: 'UNAUTHORIZED',
        errorMessage: msg,
        timestamp,
      }
      await config.auditWrite(auditEntry)

      config.logger?.info(`Tool denied: ${req.toolName} - ${msg}`)
      return {
        ok: false,
        summary: `Access denied: ${msg}`,
        error: { code: 'UNAUTHORIZED', message: msg },
      }
    }

    // Step 3: Autonomy gate (ADR-0008: permission=may, autonomy=how-autonomously are orthogonal)
    // For 'outbound' tools: suggest/assist return draft without running handler; auto runs it.
    // For 'write' tools: suggest returns draft; assist/auto run handler.
    // For 'read' tools: always run (autonomy doesn't gate reads).
    const shouldRunHandler = (() => {
      if (tool.effect === 'read') return true
      if (tool.effect === 'outbound') return req.autonomy === 'auto'
      if (tool.effect === 'write') return req.autonomy !== 'suggest'
      return false
    })()

    const draftMode = !shouldRunHandler

    try {
      // If draft mode, return a placeholder result (handler not called).
      if (draftMode) {
        const summary =
          tool.effect === 'outbound'
            ? `Draft prepared (outbound tool gated at ${req.autonomy} level; requires 'auto' to execute).`
            : `Draft prepared (write tool gated at ${req.autonomy} level; requires 'assist' or 'auto' to execute).`

        const auditEntry: AuditEntry = {
          toolName: req.toolName,
          autonomyLevel: req.autonomy,
          input,
          outcome: 'success',
          summary,
          timestamp,
        }
        await config.auditWrite(auditEntry)

        return {
          ok: true,
          summary,
          data: { draft: true },
        } as ToolResult & { data?: Out }
      }

      // Run the handler
      const ctx: ToolExecutionContext = {
        authz: config.authz,
        auditWrite: config.auditWrite,
        logger: config.logger,
        autonomy: req.autonomy,
      }

      const result = await tool.handler(input, ctx)

      // Audit the success
      const auditEntry: AuditEntry = {
        toolName: req.toolName,
        autonomyLevel: req.autonomy,
        input,
        outcome: result.ok ? 'success' : 'error',
        summary: result.summary,
        errorCode: result.error?.code,
        errorMessage: result.error?.message,
        timestamp,
      }
      await config.auditWrite(auditEntry)

      return result as ToolResult & { data?: Out }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const auditEntry: AuditEntry = {
        toolName: req.toolName,
        autonomyLevel: req.autonomy,
        input,
        outcome: 'error',
        errorCode: 'HANDLER_ERROR',
        errorMessage: msg,
        timestamp,
      }
      await config.auditWrite(auditEntry)

      config.logger?.error(`Tool execution error: ${req.toolName}`, e)
      return {
        ok: false,
        summary: `Tool execution error: ${msg}`,
        error: { code: 'HANDLER_ERROR', message: msg },
      }
    }
  }
}
