/**
 * API client wrapper — Seam 1: Generated client + error mapping
 *
 * Wraps the openapi-typescript generated types and provides:
 * - Proper error envelope parsing ({error: {code, message, details}})
 * - Session headers (mock for now; BetterAuth swap point documented)
 * - Type-safe route access
 */

const API_BASE = "/api";

/**
 * Error envelope from API (per ADR-0004).
 * Contracts error as: {error: {code: string, message: string, details?: Record}}
 */
interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * ApiError for client-side error handling.
 * Distinct from AppError (backend domain error).
 * Used for error→form/toast mapping.
 */
export class ApiError extends Error {
  name = "ApiError";

  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }

  static isValidationError(err: unknown): err is ApiError & { code: "VALIDATION_ERROR" } {
    return err instanceof ApiError && err.code === "VALIDATION_ERROR";
  }

  static isNotFound(err: unknown): err is ApiError {
    return err instanceof ApiError && err.code === "NOT_FOUND";
  }

  static isForbidden(err: unknown): err is ApiError {
    return err instanceof ApiError && err.code === "FORBIDDEN";
  }

  static isUnauthorized(err: unknown): err is ApiError {
    return err instanceof ApiError && err.code === "UNAUTHORIZED";
  }
}

/**
 * Parse error response and throw ApiError.
 * Per ADR-0004, API responses are either:
 * - 2xx: typed response payload
 * - 4xx/5xx: {error: {code, message, details}}
 */
async function handleErrorResponse(response: Response): Promise<never> {
  let errorData: ApiErrorResponse | null = null;

  try {
    errorData = await response.json();
  } catch {
    // If response is not JSON, create a generic error
    throw new ApiError(
      "UNKNOWN_ERROR",
      response.status,
      `HTTP ${response.status}: ${response.statusText}`
    );
  }

  if (errorData?.error) {
    const { code, message, details } = errorData.error;
    throw new ApiError(code, response.status, message, details);
  }

  throw new ApiError(
    "UNKNOWN_ERROR",
    response.status,
    `HTTP ${response.status}`
  );
}

/**
 * Client factory options. `fetchFn` is injectable so tests can route requests
 * straight into the real Hono app via `app.request` (no HTTP, no mocks), and
 * so seam 7 (BetterAuth) can wrap fetch with real session handling later.
 */
export interface ApiClientOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export function makeApiClient(options: ApiClientOptions = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? API_BASE;

  /**
   * Internal fetch wrapper with error handling.
   * Session headers are mock (x-user-id, x-roles, x-org-id) — the api's
   * context middleware parses x-roles as a comma-separated list.
   * SWAP POINT (seam 7): Replace mock headers with BetterAuth session.
   */
  async function apiFetch<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts?: {
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }
  ): Promise<T> {
    let url = `${baseUrl}${path}`;

    if (opts?.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
    }

    // SWAP POINT (seam 7): Replace with BetterAuth session headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Mock session headers for development (x-roles: comma-separated)
      "x-user-id": "user_000000000000000000000000001",
      "x-org-id": "org_000000000000000000000000001",
      "x-roles": "admin",
    };

    const response = await fetchFn(url, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  return {
    invoices: {
      list: (query: { limit: number; offset: number }) =>
        apiFetch<{
          data: Array<Record<string, unknown>>;
          meta: Record<string, unknown>;
        }>("GET", "/invoices", { query }),

      create: (body: Record<string, unknown>) =>
        apiFetch<Record<string, unknown>>("POST", "/invoices", { body }),

      get: (id: string) =>
        apiFetch<Record<string, unknown>>("GET", `/invoices/${id}`),

      update: (id: string, body: Record<string, unknown>) =>
        apiFetch<Record<string, unknown>>("PUT", `/invoices/${id}`, { body }),

      delete: (id: string) => apiFetch<void>("DELETE", `/invoices/${id}`),
    },

    health: {
      check: () =>
        apiFetch<{ ok: boolean; version?: string }>("GET", "/health"),
    },
  };
}

/**
 * Default client for app code (dev proxy at /api).
 *   const invoices = await apiClient.invoices.list({ limit: 20, offset: 0 });
 */
export const apiClient = makeApiClient();

export type ApiClient = ReturnType<typeof makeApiClient>;
