import { z } from 'zod'

/**
 * Tool definition shape: zod schema + metadata + business handler.
 * JSON Schema derived via zod v4's z.toJSONSchema() — never hand-written.
 * (ADR-0004: Descriptions mandatory, CI-enforced; no z.any() in contracts.)
 */
export interface ToolDefinition<Input extends z.ZodType = z.ZodType> {
  /** Business name: lowercase_snake, a verb (e.g., invoice_send, list_invoices). */
  name: string
  /** User-facing description (required, CI-enforced). Shown in tools/list and agents. */
  description: string
  /** Zod input schema. Must carry .describe() on all fields. */
  inputSchema: Input
  /** Permission required (e.g., 'invoices:send'). Authorization enforced at command door. */
  permission: string
  /**
   * Tool effect classification:
   *  - 'read': safe to run at any autonomy level; no side-effects, no outbound.
   *  - 'write': modifies state. At suggest level, returns draft; assist/auto, runs handler.
   *  - 'outbound': sends data external (email, API, etc). Only runs at auto level; suggest/assist return draft.
   */
  effect: 'read' | 'write' | 'outbound'
  /** Async handler. Receives validated input + exec context. Returns ToolResult. */
  handler: (input: z.infer<Input>, ctx: ToolExecutionContext) => Promise<ToolResult>
}

/** Tool execution context injected by registry.execute. */
export interface ToolExecutionContext {
  /** Authorization seam: assert(permission) throws if denied; can(permission) returns boolean. */
  authz: { assert(permission: string): void; can(permission: string): boolean }
  /** Audit writer seam: called with entry before returning. */
  auditWrite: (entry: AuditEntry) => Promise<void>
  /** Logger seam (optional). */
  logger?:
    | { info(msg: string, data?: unknown): void; error(msg: string, err?: unknown): void }
    | undefined
  /** Autonomy level: suggest=show draft, assist=ask, auto=execute. */
  autonomy: 'suggest' | 'assist' | 'auto'
}

/** Audit entry written at command door for every execution. */
export interface AuditEntry {
  toolName: string
  autonomyLevel: 'suggest' | 'assist' | 'auto'
  input: unknown
  outcome: 'success' | 'denied' | 'validation_error' | 'error'
  summary?: string | undefined
  errorCode?: string | undefined
  errorMessage?: string | undefined
  timestamp: string
}

/** Tool result: ok + LLM-facing summary + trimmed data. */
export interface ToolResult {
  /** Success flag. */
  ok: boolean
  /** Short English summary written for LLM context. Always populated. */
  summary: string
  /** Trimmed structured data (not a dump). Optional. */
  data?: unknown
  /** When ok=false, optional structured error. */
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

/**
 * Define a tool. Name must be snake_case business verb; description required.
 * Enforces zod input schema validation and permission binding.
 */
export function defineTool<Input extends z.ZodType>(
  def: ToolDefinition<Input>,
): ToolDefinition<Input> {
  // Validate name format (snake_case, non-empty).
  if (!/^[a-z][a-z0-9_]*$/.test(def.name)) {
    throw new Error(`Tool name must be lowercase snake_case: ${def.name}`)
  }
  // Enforce description non-empty.
  if (!def.description || def.description.trim().length === 0) {
    throw new Error(`Tool description required: ${def.name}`)
  }
  return def
}
