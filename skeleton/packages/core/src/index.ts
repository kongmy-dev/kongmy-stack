/**
 * @kongmy-stack/core — pure domain layer, zero I/O.
 *
 * Exports:
 * - AppError classes (ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, InternalError)
 * - Error utilities (isAppError, httpStatusFromError)
 *
 * No deps beyond TypeScript. Used by apps/api errorHandler and domain services.
 */

export {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError,
  isAppError,
  httpStatusFromError,
  type ValidationDetails,
  type ErrorDetails,
  type ErrorEnvelope,
} from "./app-error";
