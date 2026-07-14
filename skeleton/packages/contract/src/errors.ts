import { z } from "zod";

/**
 * ADR-0004 & ADR-0009: Error envelope & codes
 *
 * One envelope + AppError subclasses → HTTP map.
 * Error codes: SCREAMING_SNAKE (enum), never hand-written.
 * Frontend maps code+details to UI; message is debug English (agent-facing).
 */

// ============================================================================
// Error Codes (SCREAMING_SNAKE per ADR-0009)
// ============================================================================

export const errorCode = z
  .enum([
    // Validation errors (4xx)
    "VALIDATION_ERROR",
    "INVALID_REQUEST",
    "MALFORMED_INPUT",
    "MISSING_FIELD",

    // Authentication/Authorization (401/403)
    "UNAUTHORIZED",
    "FORBIDDEN",
    "INSUFFICIENT_PERMISSIONS",
    "SESSION_EXPIRED",

    // Resource errors (404/409/410)
    "NOT_FOUND",
    "RESOURCE_EXISTS",
    "CONFLICT",
    "GONE",

    // Business logic (400/422)
    "INVALID_STATE",
    "INVALID_OPERATION",
    "BUSINESS_RULE_VIOLATION",
    "DOCUMENT_IMMUTABLE",

    // Rate limiting & quotas (429/507)
    "RATE_LIMITED",
    "QUOTA_EXCEEDED",

    // Server errors (5xx)
    "INTERNAL_ERROR",
    "SERVICE_UNAVAILABLE",
    "TIMEOUT",
    "DATABASE_ERROR",
  ])
  .describe("Machine-readable error code in SCREAMING_SNAKE format");

export type ErrorCode = z.infer<typeof errorCode>;

// ============================================================================
// Validation Error Details
// ============================================================================

/**
 * Field-level validation error
 * Frontend: `form.setError(field, message)`
 */
export const validationErrorDetail = z
  .object({
    field: z.string().describe("Form field name or JSON path"),
    message: z.string().describe("User-friendly validation message"),
    code: z.string().optional().describe("Machine-readable error subcode"),
  })
  .describe("Field-level validation error detail");

export type ValidationErrorDetail = z.infer<typeof validationErrorDetail>;

// ============================================================================
// Error Envelope (HTTP & MCP)
// ============================================================================

/**
 * Standard error response envelope
 * Matches: bare error object for single errors, {error: {...}} for envelope
 * Used by: REST routes, MCP ToolResult (ok: false case), response serialization
 */
export const errorEnvelope = z
  .object({
    code: errorCode.describe("Machine-readable error code (SCREAMING_SNAKE)"),
    message: z.string().describe("English debug message (not for UI display)"),
    details: z
      .array(validationErrorDetail)
      .optional()
      .describe("Array of field-level validation errors"),
    traceId: z
      .string()
      .optional()
      .describe("Request trace ID for server-side debugging"),
  })
  .describe("Standard error response envelope");

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

/**
 * HTTP error response wrapper
 * Envelope at top level: `{ error: {...} }`
 */
export const httpErrorResponse = z
  .object({
    error: errorEnvelope.describe("Error details"),
  })
  .describe("HTTP error response wrapper");

export type HttpErrorResponse = z.infer<typeof httpErrorResponse>;

// ============================================================================
// HTTP Status → Error Code Mapping
// ============================================================================

/**
 * Recommendation for T5 (API layer) error handler mapping:
 *
 * 400 Bad Request:
 *   - VALIDATION_ERROR (with details array for forms)
 *   - MALFORMED_INPUT
 *   - INVALID_REQUEST
 *   - INVALID_STATE (business rule violation that's not a state)
 *
 * 401 Unauthorized:
 *   - UNAUTHORIZED (no valid session)
 *   - SESSION_EXPIRED
 *
 * 403 Forbidden:
 *   - FORBIDDEN (insufficient permissions for resource)
 *   - INSUFFICIENT_PERMISSIONS
 *
 * 404 Not Found:
 *   - NOT_FOUND
 *   - GONE (resource was deleted)
 *
 * 409 Conflict:
 *   - CONFLICT (concurrent modification)
 *   - RESOURCE_EXISTS (create duplicate)
 *   - DOCUMENT_IMMUTABLE (attempt to modify posted doc)
 *
 * 422 Unprocessable Entity:
 *   - BUSINESS_RULE_VIOLATION (qty exceeds stock, duplicate doc #, etc.)
 *   - INVALID_OPERATION (action not allowed in current state)
 *
 * 429 Too Many Requests:
 *   - RATE_LIMITED
 *
 * 507 Insufficient Storage:
 *   - QUOTA_EXCEEDED
 *
 * 500 Internal Server Error:
 *   - INTERNAL_ERROR
 *   - DATABASE_ERROR
 *
 * 503 Service Unavailable:
 *   - SERVICE_UNAVAILABLE
 *   - TIMEOUT
 *
 * The mapping is NOT enforced here (contract stays adapter-agnostic);
 * it's documented guidance for implementers.
 */
