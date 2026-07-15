/**
 * useRealtime hook (ADR-0006)
 *
 * Subscribe to SSE events and invalidate TanStack Query caches.
 * Per ADR-0006: Query-invalidation over payload-as-state pattern.
 * Event type drives cache invalidation (e.g., invoice_created → invalidate invoices list query).
 *
 * Usage:
 *   useRealtime(); // Mount once per app (in root layout or auth guard)
 *
 * Lifecycle:
 * - Open EventSource on component mount
 * - Subscribe to events: on receipt, invalidate relevant queries
 * - Close on unmount
 * - Auto-reconnect on network error (simple exponential backoff)
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@kongmy-stack/contract";

export function useRealtime() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    const connect = () => {
      try {
        // Open SSE connection to /api/realtime
        // EventSource uses same-origin cookies automatically
        const eventSource = new EventSource("/api/realtime");
        eventSourceRef.current = eventSource;

        // Handle incoming events (unnamed events only per SSE spec)
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as RealtimeEvent;
            handleRealtimeEvent(data, queryClient);
            reconnectAttemptRef.current = 0; // Reset backoff on successful message
          } catch (err) {
            console.error("Failed to parse realtime event:", err);
          }
        };

        // Handle connection errors
        eventSource.onerror = (err) => {
          console.error("EventSource error:", err);
          eventSource.close();
          eventSourceRef.current = null;

          // Exponential backoff reconnect (max 30s)
          const delayMs = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
          reconnectAttemptRef.current++;
          console.log(`Reconnecting realtime in ${delayMs}ms...`);
          setTimeout(connect, delayMs);
        };
      } catch (err) {
        console.error("Failed to connect EventSource:", err);
        // Retry with backoff
        const delayMs = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        reconnectAttemptRef.current++;
        setTimeout(connect, delayMs);
      }
    };

    // Connect on mount
    connect();

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [queryClient]);
}

/**
 * Handle a realtime event: invalidate relevant TanStack Query caches.
 * Event type → Query key mapping (per ADR-0006 pattern).
 */
function handleRealtimeEvent(event: RealtimeEvent, queryClient: ReturnType<typeof useQueryClient>) {
  console.log("Realtime event received:", event.type, event.resourceId);

  // Map event types to query keys to invalidate
  const queryKeysToInvalidate: string[][] = [];

  switch (event.type) {
    case "invoice_created":
    case "invoice_updated":
    case "invoice_deleted":
    case "invoice_posted":
    case "invoice_cancelled":
    case "invoice_sent":
      // Prefix-match ALL invoice queries: list keys are ["invoices", limit, offset]
      // and detail keys are ["invoices", id] (see queryOptions.ts) — a bare
      // ["invoices"] prefix covers both; ["invoices", "list"] matches neither.
      queryKeysToInvalidate.push(["invoices"]);
      break;
    default:
      console.warn("Unknown event type:", event.type);
  }

  // Invalidate all affected queries
  for (const queryKey of queryKeysToInvalidate) {
    queryClient.invalidateQueries({
      queryKey,
      // Refetch immediately to reflect changes
      refetchType: "active",
    });
  }
}
