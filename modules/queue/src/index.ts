/**
 * Queue module: public API
 *
 * ONE interface, three implementations:
 * 1. pgbossQueue (PostgreSQL server + PGlite embedded)
 * 2. cfQueuesQueue (Cloudflare Workers, deferred)
 * 3. dispatch helper (for multi-queue routing)
 *
 * @see queue.ts for interface definition
 * @see pgboss.ts for server PG + PGlite implementation
 * @see cf-queues.ts for Workers stub (NotImplemented)
 */

export * from "./queue.js";
export * from "./pgboss.js";
export * from "./cf-queues.js";
