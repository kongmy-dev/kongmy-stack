import type { EventEnvelope } from './envelope.js'

/**
 * Minimal database executor interface for raw parameterized queries.
 * Backends (Drizzle, direct PG, PGlite, etc.) implement this.
 * All SQL must use parameterized placeholders ($1, $2, …) — never string-interpolate.
 *
 * @example
 * // PGlite implementation:
 * const executor: RawExecutor = {
 *   query: async (sql, params) => {
 *     const result = await db.execute(sql, params)
 *     return { rows: result.rows ?? [] }
 *   }
 * }
 */
export interface RawExecutor {
  /**
   * Execute a parameterized SQL query.
   * @param sql - SQL string with $1, $2, … placeholders
   * @param params - Values to bind to placeholders
   * @returns Object with rows array (may be empty)
   */
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * A drainer's claim on a batch: who holds it, and until when.
 * Passed to claimBatch (to take the claim) and releaseClaim (to give back only what it still holds).
 */
export interface ClaimTicket {
  /** Diagnostic identity of the claiming drainer. Exclusion comes from row locks, not this value. */
  drainerId: string
  /** ISO-8601 UTC instant this claim expires. Written by the claimer, never derived by a reader. */
  leaseExpiresAt: string
  /** ISO-8601 UTC "now" used to test whether an existing claim has expired. */
  now: string
}

/**
 * Persistence seam for the drain (ADR-0002: interface + adapters).
 *
 * `drainOutbox` owns the *algorithm* — claim, order, publish, mark, release. A store owns the
 * *persistence* — which table, which column types, which tenancy mechanism. Ship-provided stores
 * (`pgOutboxStore`, `journalStore`) cover a staging outbox and an event-sourced journal; a consumer
 * whose events live behind row-level security, or in `uuid`/`jsonb` columns, or in a Drizzle
 * transaction, writes their own store instead of forking the drain.
 *
 * **A custom store must hold these invariants — the drain cannot enforce them for you:**
 *
 * 1. `claimBatch` is ONE atomic statement. Splitting it into select-then-claim re-opens the
 *    double-delivery window: N concurrent drainers × N pending events = N² deliveries (ADR-0014).
 * 2. `claimBatch` returns only events that are unpublished AND (unclaimed OR whose lease expired
 *    at/before `ticket.now`), and writes `ticket.drainerId` + `ticket.leaseExpiresAt` onto them.
 * 3. `claimBatch` need not return rows in order — the drain sorts by `seq` before publishing.
 * 4. `releaseClaim` matches on `drainerId` AND `leaseExpiresAt` together, so a drainer whose lease
 *    already expired cannot yank a live claim out from under its successor.
 * 5. `markPublished` commits on its own, outside any transaction spanning `publish()`.
 *
 * Whatever scoping a store applies (an org/branch predicate, an RLS GUC, a scoped transaction) is
 * the store's business and invisible to the drain.
 */
export interface OutboxStore {
  /**
   * Append sealed events within the caller's transaction (first half of the transactional outbox).
   *
   * Lives on the store rather than beside the drain because append and claim must agree on the
   * payload encoding: a store that writes `jsonb` has to read `jsonb` back.
   */
  append(tx: RawExecutor, events: EventEnvelope[]): Promise<void>
  /** Atomically claim this drainer's batch. See invariants 1–3 above. */
  claimBatch(ticket: ClaimTicket): Promise<EventEnvelope[]>
  /** Mark one event delivered. Must commit independently of `publish()`. */
  markPublished(id: string): Promise<void>
  /** Release claims this ticket still holds on unpublished events. See invariant 4. */
  releaseClaim(ticket: ClaimTicket): Promise<void>
}

/** Written to `claimed_by`. Diagnostic only — exclusion comes from the row lock, not this value. */
const DRAINER_ID = `drainer-${crypto.randomUUID()}`

/** Default drain lease. Must comfortably exceed the slowest publish() in the batch. */
const DEFAULT_LEASE_MS = 30_000

export interface DrainOptions {
  /**
   * How long this drainer's claim is held before another drainer may reclaim the batch
   * (default 30s). Written into the claim at claim time, so each claim carries its own expiry and
   * drainers with different leaseMs cannot steal each other's live batches.
   *
   * Only reached when a drainer dies mid-drain — a live drainer releases its own leftovers on the
   * way out. Too short and a second drainer reclaims events the first is still publishing (the
   * double-delivery this lease exists to prevent); too long and recovery after a crash stalls for
   * the remainder of the lease. Set it above your slowest publish().
   */
  leaseMs?: number | undefined
  /** Value written to `claimed_by`. Defaults to a per-process id. Diagnostic only. */
  drainerId?: string | undefined
}

/**
 * Drain the outbox: publish claimed events and mark them as published.
 * **Second half of transactional outbox pattern.**
 *
 * **Semantics: ordered stream with poison isolation, safe under concurrent drainers.**
 *
 * At-least-once delivery guarantee:
 * 1. Atomically claim the store's unpublished, unclaimed events (a lease)
 * 2. For each claimed event, in seq order:
 *    - Call the publish callback (outside any transaction to avoid deadlock)
 *    - Immediately mark event as published in a separate update
 * 3. If publish() throws, drain halts at that event (preserves seq ordering)
 *
 * **Poison event isolation:** If event E fails to publish, earlier events (E-1, E-2, ...) are
 * already marked and will NOT redeliver on the next drain. Event E stays unpublished and will
 * be re-attempted next drain. Events after E (E+1, E+2, ...) are never attempted until E succeeds.
 *
 * **Exactly-once effect:** Achieved when consumers are idempotent (e.g. event.id deduplication).
 * If a crash occurs after publish() and before the mark, the event redelivers once the lease
 * expires.
 *
 * **Concurrency:** Safe to call concurrently against the same store. The claim is a single atomic
 * UPDATE, so concurrent drainers serialize on the row locks and the loser claims nothing — it
 * returns 0 rather than re-delivering the winner's batch. You do not need to arrange for a single
 * drainer, and consumers do not need to be idempotent to avoid N-way double-delivery.
 *
 * Draining from a dedicated worker is still the shape to prefer: draining per-request puts the
 * publish latency (and any broker/HTTP call it makes) inside the request that triggered it.
 *
 * @param store - Where the events live; see OutboxStore
 * @param publish - Async callback to publish one event (e.g. bus.publish or send to broker)
 * @param opts - Lease tuning; see DrainOptions
 * @returns Number of events successfully published and marked (0 if another drainer holds the lease)
 * @throws If a publish callback throws, the drain halts at that event (earlier events stay marked)
 *
 * @example
 * const store = pgOutboxStore(db, 'org-123', 'branch-456')
 * const count = await drainOutbox(store, bus.publish.bind(bus))
 * console.log(`published ${count} events`)
 */
export async function drainOutbox(
  store: OutboxStore,
  publish: (e: EventEnvelope) => Promise<void>,
  opts: DrainOptions = {},
): Promise<number> {
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const ticket: ClaimTicket = {
    drainerId: opts.drainerId ?? DRAINER_ID,
    leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
    now: new Date().toISOString(),
  }

  const claimed = await store.claimBatch(ticket)
  if (claimed.length === 0) return 0

  // Stores are not required to return rows in order, and seq ordering is a guarantee of this module.
  const batch = [...claimed].sort((a, b) => a.seq - b.seq)

  let publishedCount = 0
  try {
    for (const env of batch) {
      // Publish the event (outside any tx to avoid deadlock on single-connection DBs)
      await publish(env)

      // Mark as published immediately after successful publish
      await store.markPublished(env.id)
      publishedCount++
    }
  } finally {
    // Release the claim on anything we did not publish, so the next drain retries at once instead
    // of waiting out the lease. A crash skips this — that path is what leaseMs covers.
    if (publishedCount < batch.length) {
      try {
        await store.releaseClaim(ticket)
      } catch {
        // Best-effort: the lease expiry frees these anyway, and throwing here would mask the
        // publish error that brought us into this block.
      }
    }
  }

  return publishedCount
}
