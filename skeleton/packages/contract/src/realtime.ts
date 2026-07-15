/**
 * ADR-0006: Realtime event contracts
 *
 * SSE envelope types for real-time updates.
 * Queries invalidate on events rather than polling.
 * Event type taxonomy: resource_action (e.g., invoice_created)
 *
 * Contracts import only zod; no runtime specifics (Transport-agnostic).
 */

import { z } from "zod";
import { dateTime } from "./scalars.js";

/**
 * Realtime event envelope
 * Emitted server → client via Server-Sent Events (SSE)
 * Client invalidates TanStack Query caches on receipt
 */
export const realtimeEventSchema = z
  .object({
    eventId: z.string().describe("Unique event ID for deduplication"),
    type: z
      .enum([
        "invoice_created",
        "invoice_updated",
        "invoice_deleted",
        "invoice_posted",
        "invoice_cancelled",
        "invoice_sent",
      ])
      .describe("Event type: resource_action (immutable list)"),
    resourceId: z.string().describe("ID of the affected resource (prefixed ULID)"),
    organizationId: z.string().describe("Organization scoping this event"),
    timestamp: dateTime.describe("Event emission time (ISO-8601 UTC)"),
    userId: z.string().describe("User who triggered the event"),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional event payload (e.g., updated invoice)"),
  })
  .describe("Server-sent event for real-time updates");

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
