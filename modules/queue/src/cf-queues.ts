/**
 * Queue implementation stub for Cloudflare Queues (Workers)
 *
 * This lane is NOT built in Wave 2. Placeholder to clarify contract surface.
 *
 * Cloudflare Queues are available only in Workers runtime; they follow different
 * semantics (push-driven, JSON-only payloads, built-in retries at platform level).
 *
 * When emas-pos or another product targets Workers, this impl will ship.
 * For now: throw NotImplementedError to make the contract explicit.
 *
 * ADR-0012: three lanes; CF Queues deferred to first Workers deployment
 *
 * @see https://developers.cloudflare.com/queues/
 */

import type {
  Queue,
  JobPayload,
  JobHandler,
  EnqueueOptions,
  WorkOptions,
  ScheduleOptions,
} from "./queue.js";

/**
 * Placeholder: CF Queues not yet implemented
 */
export async function cfQueuesQueue(
  queueName: string,
  env: unknown // Cloudflare env object (typed when the Workers lane ships)
): Promise<Queue> {
  throw new Error(
    "NotImplemented: CF Queues lane ships on first Workers deployment. " +
      "For now, use pgbossQueue (PG or PGlite) for server and embedded. " +
      "See docs/adr/0012-queue-pglite-lane.md for roadmap."
  );
}

/**
 * Stub: remind users that CF Queues is a future lane
 */
export const cfQueuesNotImplementedError = new Error(
  "CF Queues (Workers) lane not yet implemented. " +
    "This is a deferred lane per ADR-0012 (Wave 2+ after first deployment). " +
    "Use pgbossQueue for development and production on server/embedded."
);
