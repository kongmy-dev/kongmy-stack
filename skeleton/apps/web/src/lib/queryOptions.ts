/**
 * Query options factories — Seam 2: TanStack Query integration
 *
 * Provides typed queryOptions for each resource, consuming the typed apiClient.
 * Makes query state (caching, refetch, etc.) centralized and type-safe.
 */

import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api";

/**
 * Query options for invoice list with pagination.
 * Pagination state lives in URL search params (seam 5); this factory provides the query key + fetcher.
 */
export const invoiceQueries = {
  list: (pagination: { limit: number; offset: number }) =>
    queryOptions({
      queryKey: ["invoices", pagination.limit, pagination.offset],
      queryFn: async () => {
        const response = await apiClient.invoices.list(pagination);
        if (!response.data) {
          throw new Error("Invalid response: missing data");
        }
        return response;
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
    }),

  /**
   * Query options for a single invoice.
   * Automatically refetches when id changes.
   */
  detail: (id: string) =>
    queryOptions({
      queryKey: ["invoices", id],
      queryFn: async () => {
        const invoice = await apiClient.invoices.get(id);
        return invoice;
      },
      enabled: !!id,
      staleTime: 1000 * 60 * 5,
    }),
};

/**
 * Mutation helpers for invoice actions.
 * These return useMutation configs, not queryOptions (mutations don't cache).
 */
export const invoiceMutations = {
  create: () => ({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiClient.invoices.create(data);
    },
  }),

  update: () => ({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      return apiClient.invoices.update(id, data);
    },
  }),

  delete: () => ({
    mutationFn: async (id: string) => {
      return apiClient.invoices.delete(id);
    },
  }),
};

/**
 * Session query options — fetch current user + permissions.
 * Used by beforeLoad guards and session hooks.
 * Returns null if 401 (not authenticated).
 */
export const sessionQueries = {
  current: () =>
    queryOptions({
      queryKey: ["auth", "me"],
      queryFn: async () => {
        const session = await apiClient.auth.me();
        return session;
      },
      staleTime: 1000 * 60 * 10, // 10 minutes
    }),
};
