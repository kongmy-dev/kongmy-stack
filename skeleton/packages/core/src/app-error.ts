/**
 * AppError hierarchy — pure domain layer error types with HTTP mapping.
 *
 * Per ADR-0004: single error envelope + subclasses → HTTP status map.
 * Error codes are SCREAMING_SNAKE and stable (clients + agents branch on them).
 * Message field is English debug text only; UIs render from code+details via catalog (ADR-0007).
 *
 * No I/O, no runtime deps beyond TS. Exported for use in `apps/api` errorHandler only;
 * domain code throws these, services catch and rethrow if needed, routes map to HTTP.
 */

/**
 * Error details for 422 validation errors — per-field typed issues.
 * For other error types, details is optional and free-form (e.g. conflict explanation).
 */
export interface ValidationDetails {
  [fieldName: string]: string[];
}

export interface ErrorDetails {
  [key: string]: unknown;
}

/**
 * Base AppError — all error subclasses inherit from this.
 * Distinguishable by instanceof and by httpStatus for mapping.
 */
export class AppError extends Error {
  readonly code: string;
  readonly message: string;
  readonly details: ValidationDetails | ErrorDetails | undefined;
  readonly httpStatus: number;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    details?: ValidationDetails | ErrorDetails
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.message = message;
    this.httpStatus = httpStatus;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * 422 Unprocessable Entity — validation failed on input schema or business rules.
 * details = { [fieldName]: [errors...] } per ADR-0004.
 */
export class ValidationError extends AppError {
  readonly details: ValidationDetails;

  constructor(message: string, details: ValidationDetails) {
    super("VALIDATION_ERROR", message, 422, details);
    this.name = "ValidationError";
    this.details = details;
  }
}

/**
 * 401 Unauthorized — missing or invalid authentication.
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required", details?: ErrorDetails) {
    super("UNAUTHORIZED", message, 401, details);
    this.name = "UnauthorizedError";
  }
}

/**
 * 403 Forbidden — authenticated but lacks permission.
 * Per ADR-0008, one enforcement point at command door via ctx.authz.assert.
 */
export class ForbiddenError extends AppError {
  constructor(message: string = "Permission denied", details?: ErrorDetails) {
    super("FORBIDDEN", message, 403, details);
    this.name = "ForbiddenError";
  }
}

/**
 * 404 Not Found — resource does not exist.
 */
export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found", details?: ErrorDetails) {
    super("NOT_FOUND", message, 404, details);
    this.name = "NotFoundError";
  }
}

/**
 * 409 Conflict — operation conflicts with current resource state.
 * Examples: optimistic lock failure (If-Match), duplicate key, invalid state transition.
 */
export class ConflictError extends AppError {
  constructor(message: string = "Conflict", details?: ErrorDetails) {
    super("CONFLICT", message, 409, details);
    this.name = "ConflictError";
  }
}

/**
 * 500 Internal Server Error — unhandled application error.
 * The errorHandler sanitizes these before sending to clients.
 */
export class InternalError extends AppError {
  constructor(message: string = "Internal server error", details?: ErrorDetails) {
    super("INTERNAL_ERROR", message, 500, details);
    this.name = "InternalError";
  }
}

/**
 * Type guard: check if a thrown error is an AppError.
 * Useful in catch blocks to distinguish app errors from platform errors.
 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * HTTP status → error instance map.
 * Used by the errorHandler to serialize errors to the wire.
 * Per ADR-0004 response schema:
 *   - 422: validation details = { [field]: [errors...] }
 *   - 401/403/404/409: code + message from the error
 *   - 500: code only (message sanitized)
 */
export function httpStatusFromError(err: AppError): number {
  return err.httpStatus;
}

/**
 * Error response envelope per ADR-0004.
 * Serialized to `{ error: { code, message, details } }` in the errorHandler.
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ValidationDetails | ErrorDetails;
  };
}
