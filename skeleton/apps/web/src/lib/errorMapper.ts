/**
 * Error mapping — Seam 6: API error envelope → form.setError or toast
 *
 * Per ADR-0004, API errors are:
 *   {error: {code, message, details}}
 *
 * For VALIDATION_ERROR, `details` is keyed BY FIELD NAME with an array of
 * messages per field (this is what the api's errorHandler actually emits;
 * proven against the real app in __tests__/realApp.test.ts):
 *   {error: {code: "VALIDATION_ERROR", message: "…",
 *            details: {lineItems: ["Cannot be empty"], "customer.email": ["Invalid"]}}}
 *
 * Mapping rules:
 *   - VALIDATION_ERROR: each details key → form.setError(key, first message)
 *   - Other errors → toast (summary shown)
 */

import { UseFormSetError } from "react-hook-form";
import { ApiError } from "./api";

export function isValidationError(
  err: unknown
): err is ApiError & { details: Record<string, unknown> } {
  return (
    err instanceof ApiError &&
    err.code === "VALIDATION_ERROR" &&
    !!err.details
  );
}

function fieldMessages(details: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(details)) {
    if (Array.isArray(messages) && messages.length > 0) {
      out[field] = String(messages[0]);
    } else if (typeof messages === "string") {
      out[field] = messages;
    }
  }
  return out;
}

/**
 * Map API validation error to react-hook-form field errors.
 * Sets every field present in details; returns a toast message only when
 * nothing could be mapped to a field.
 */
export function mapValidationErrorToForm<T extends Record<string, unknown>>(
  err: ApiError,
  setError: UseFormSetError<T>
): string | null {
  if (!err.details) {
    return err.message;
  }

  const mapped = fieldMessages(err.details);
  for (const [field, message] of Object.entries(mapped)) {
    // Type assertion: setError accepts field names dynamically
    setError(field as Parameters<UseFormSetError<T>>[0], {
      type: "server",
      message,
    });
  }

  return Object.keys(mapped).length > 0 ? null : err.message;
}

/**
 * Parse error for UI display.
 * Returns {toastMessage?: string, formErrors?: Record<string, string>}
 */
export function parseApiError(err: unknown): {
  toastMessage?: string;
  formErrors?: Record<string, string>;
} {
  if (!(err instanceof ApiError)) {
    return {
      toastMessage:
        err instanceof Error ? err.message : "An unexpected error occurred",
    };
  }

  if (!isValidationError(err)) {
    return { toastMessage: err.message };
  }

  const formErrors = err.details ? fieldMessages(err.details) : {};

  return {
    toastMessage:
      Object.keys(formErrors).length === 0 ? err.message : undefined,
    formErrors: Object.keys(formErrors).length > 0 ? formErrors : undefined,
  };
}
