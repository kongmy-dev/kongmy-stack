/**
 * Realtime SSE endpoint (ADR-0006)
 *
 * GET /api/realtime → Server-Sent Events stream
 *
 * Requires authentication (session cookie).
 * Filters events by organization: only delivers events for the session's org.
 * Clients use EventSource to subscribe; TanStack Query invalidates on receipt.
 *
 * Per ADR-0006: SSE is the default realtime implementation.
 * Query-invalidation-over-payload pattern: event type drives cache invalidation.
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { UnauthorizedError } from "@kongmy-stack/core";
import type { AppBindings } from "../main.js";
import type { RealtimePublisher } from "../lib/realtime.js";

export function registerRealtime(app: any, publisher: RealtimePublisher) {
  const route = createRoute({
    method: "get",
    path: "/realtime",
    summary: "Server-Sent Events stream for real-time updates",
    description:
      "Subscribe to events for your organization. Requires authentication. Delivers invoice events (created, updated, deleted, etc.) to trigger Query cache invalidation.",
    responses: {
      200: {
        description: "SSE stream (text/event-stream)",
        content: {
          "text/event-stream": {
            schema: z.object({
              type: z.string().describe("Event type (e.g., invoice_created)"),
              resourceId: z.string().describe("Affected resource ID"),
            }),
          },
        },
      },
      401: {
        description: "Unauthorized: no active session",
      },
    },
  });

  app.openapi(route, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];

    // Require authentication
    if (!ctx.session) {
      throw new UnauthorizedError("Authentication required for realtime events");
    }

    // SSE stream: subscribe and deliver events for this org
    return streamSSE(c, async (stream) => {
      // Unsubscribe function (called when client closes connection)
      const unsubscribe = publisher.subscribe(
        ctx.tenant.orgId,
        async (event) => {
          try {
            // Send event to client as SSE
            // Unnamed SSE events only: EventSource.onmessage never fires for
            // named events (event: <type>), and the envelope already carries
            // the type in the payload — clients switch on data.type.
            await stream.writeSSE({
              data: JSON.stringify(event),
              id: event.eventId,
            });
          } catch (err) {
            // Stream closed; subscriber will be unsubscribed on next cleanup
            console.error("Failed to write SSE event:", err);
          }
        }
      );

      // Keep stream open until client disconnects
      // Send periodic keep-alive messages to prevent idle timeout
      const keepAliveInterval = setInterval(async () => {
        try {
          // Send a dummy event with a comment-like message
          // SSE comments start with ':' and are ignored by clients
          await stream.write(`:keep-alive ${Date.now()}\n\n`);
        } catch (err) {
          // Stream closed
          clearInterval(keepAliveInterval);
          unsubscribe();
        }
      }, 30000); // Every 30 seconds

      // When client closes, unsubscribe
      try {
        await new Promise<void>((resolve) => {
          // This promise never resolves; stream stays open until client closes
          c.req.raw.signal?.addEventListener("abort", () => {
            clearInterval(keepAliveInterval);
            unsubscribe();
            resolve();
          });
        });
      } catch (err) {
        clearInterval(keepAliveInterval);
        unsubscribe();
        throw err;
      }
    });
  });
}
