/**
 * Message rendering for error codes (i18n pattern from ADR-0007)
 *
 * API sends {code, details}; UI renders from the Paraglide catalog.
 * This module handles the lookup and rendering of localized error messages.
 */

import * as m from "../paraglide/messages";

/**
 * Render an error code using the message catalog.
 *
 * Pattern: error_<code_lowercase>(details)
 * Falls back to code if message key not found.
 *
 * Example:
 *   renderErrorMessage("VALIDATION_ERROR", {field: "email"})
 *   → looks for m.error_validation_error(details)
 */
export function renderErrorMessage(
  code: string,
  details?: Record<string, unknown>
): string {
  const messageKey = `error_${code.toLowerCase()}` as keyof typeof m;
  const messageFn = m[messageKey] as
    | ((args?: Record<string, unknown>) => string)
    | undefined;

  if (messageFn && typeof messageFn === "function") {
    try {
      return messageFn(details);
    } catch {
      // If message function throws (e.g., invalid args), fall back to code
      return code;
    }
  }

  // Message not found in catalog, return the code as fallback
  return code;
}

/**
 * Render a message key from the catalog.
 *
 * Use this for UI text that has localized versions in the message catalog.
 * Direct access: m.common_loading(), m.invoices_title(), etc.
 */
export function renderMessage(
  messageKey: string,
  args?: Record<string, unknown>
): string {
  const fn = m[messageKey as keyof typeof m] as
    | ((args?: Record<string, unknown>) => string)
    | undefined;

  if (fn && typeof fn === "function") {
    try {
      return fn(args);
    } catch {
      return messageKey;
    }
  }

  return messageKey;
}
