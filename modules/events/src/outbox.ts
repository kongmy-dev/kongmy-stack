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
 * DDL to create the event outbox table.
 * Must be run once per database before using appendEvent/drainOutbox.
 * Stores unpublished events in a transaction-safe way.
 *
 * Columns:
 * - id: Prefixed ULID event identifier (primary key)
 * - type, version: Event type and schema version
 * - orgId, branchId: Tenancy scoping
 * - seq, hlc: Ordering and causality
 * - actor_id, actor_type, actor_model: Who caused the event
 * - causation_id, correlation_id: Traceability
 * - payload: JSON event payload
 * - published: Whether drain() has marked this event as delivered
 * - claimed_by, lease_expires_at: Drain lease (see drainOutbox). null = unclaimed.
 * - created_at: ISO-8601 UTC timestamp
 *
 * Timestamps are ISO-8601 UTC `text`, not `timestamptz`: they compare lexicographically, so the
 * lease works identically on PG, PGlite and D1 without `now()`/`interval`.
 */
export const EventOutboxDDL = `create table if not exists event_outbox (
  id text primary key,
  type text not null,
  version int not null,
  org_id text not null,
  branch_id text,
  seq bigint not null,
  hlc text not null,
  actor_id text not null,
  actor_type text not null,
  actor_model text,
  causation_id text,
  correlation_id text not null,
  payload text not null,
  published boolean not null default false,
  claimed_by text,
  lease_expires_at text,
  created_at text not null,

  unique (org_id, branch_id, seq)
)`

export const EventOutboxIndexDDL = `create index if not exists idx_event_outbox_unpublished_org_branch
  on event_outbox(published, org_id, branch_id)`

/**
 * Append sealed events to the durable outbox within the current transaction.
 * Must be called within the same transaction as the domain write (first half of transactional outbox).
 * The transaction ensures atomicity: if the domain write succeeds, events are durable;
 * if it fails, events are rolled back.
 *
 * @param tx - Database executor within an active transaction
 * @param events - EventEnvelope instances to append (already sealed)
 * @throws If the database write fails (will abort the containing transaction)
 *
 * @example
 * await db.transaction(async (tx) => {
 *   // Domain write (e.g. insert invoice)
 *   await tx.query('insert into invoices (id, ...) values ($1, ...)', [invoiceId, ...])
 *   // Append the sealed event in the same tx
 *   await appendEvent(tx, [envelope])
 * })
 */
export async function appendEvent(tx: RawExecutor, events: EventEnvelope[]): Promise<void> {
  if (events.length === 0) return

  const values = events
    .map(
      (e, i) =>
        `($${i * 14 + 1}, $${i * 14 + 2}, $${i * 14 + 3}, $${i * 14 + 4}, $${i * 14 + 5}, $${i * 14 + 6}, ` +
        `$${i * 14 + 7}, $${i * 14 + 8}, $${i * 14 + 9}, $${i * 14 + 10}, $${i * 14 + 11}, ` +
        `$${i * 14 + 12}, $${i * 14 + 13}, $${i * 14 + 14})`,
    )
    .join(', ')

  const params = events.flatMap((e) => [
    e.id,
    e.type,
    e.version,
    e.orgId,
    e.branchId,
    e.seq,
    e.hlc,
    e.actor.id,
    e.actor.type,
    e.actor.model,
    e.causationId,
    e.correlationId,
    JSON.stringify(e.payload),
    e.createdAt,
  ])

  const sql =
    `insert into event_outbox (id, type, version, org_id, branch_id, seq, hlc, ` +
    `actor_id, actor_type, actor_model, causation_id, correlation_id, payload, created_at) ` +
    `values ${values}`

  await tx.query(sql, params)
}

function toEnvelope(row: Record<string, unknown>): EventEnvelope {
  return {
    id: String(row.id),
    type: String(row.type),
    version: Number(row.version),
    orgId: String(row.org_id),
    branchId: row.branch_id ? String(row.branch_id) : null,
    seq: Number(row.seq),
    hlc: String(row.hlc),
    actor: {
      id: String(row.actor_id),
      type: String(row.actor_type) as 'human' | 'agent' | 'system',
      model: row.actor_model ? String(row.actor_model) : null,
    },
    causationId: row.causation_id ? String(row.causation_id) : null,
    correlationId: String(row.correlation_id),
    payload: JSON.parse(String(row.payload)) as unknown,
    createdAt: String(row.created_at),
  }
}

/** Written to `claimed_by`. Diagnostic only — exclusion comes from the row lock, not this value. */
const DRAINER_ID = `drainer-${crypto.randomUUID()}`

/** Default drain lease. Must comfortably exceed the slowest publish() in the batch. */
const DEFAULT_LEASE_MS = 30_000

export interface DrainOptions {
  /**
   * How long this drainer's claim is held before another drainer may reclaim the batch
   * (default 30s). Written into `lease_expires_at` at claim time, so each claim carries its own
   * expiry and drainers with different leaseMs cannot steal each other's live batches.
   *
   * Only reached when a drainer dies mid-drain — a live drainer releases its own leftovers on the
   * way out. Too short and a second drainer reclaims events the first is still publishing (the
   * double-delivery this lease exists to prevent); too long and recovery after a crash stalls for
   * the remainder of the lease. Set it above your slowest publish().
   */
  leaseMs?: number
  /** Value written to `claimed_by`. Defaults to a per-process id. Diagnostic only. */
  drainerId?: string
}

/**
 * Drain the outbox: publish unpublished events and mark them as published.
 * **Second half of transactional outbox pattern.**
 *
 * **Semantics: ordered stream with poison isolation, safe under concurrent drainers.**
 *
 * At-least-once delivery guarantee:
 * 1. Atomically claim all unpublished, unclaimed events for this org/branch (a lease)
 * 2. For each claimed event, in seq order:
 *    - Call the publish callback (outside any transaction to avoid deadlock)
 *    - Immediately mark event as published in a separate update transaction
 * 3. If publish() throws, drain halts at that event (preserves seq ordering)
 *
 * **Poison event isolation:** If event E fails to publish, earlier events (E-1, E-2, ...) are
 * already marked and will NOT redeliver on the next drain. Event E stays unpublished and will
 * be re-attempted next drain. Events after E (E+1, E+2, ...) are never attempted until E succeeds.
 *
 * **Exactly-once effect:** Achieved when consumers are idempotent (e.g. event.id deduplication).
 * If a crash occurs after publish() and before the mark UPDATE, the event redelivers once the
 * lease expires.
 *
 * **Concurrency:** Safe to call concurrently for the same (orgId, branchId). The claim is a single
 * atomic UPDATE, so concurrent drainers serialize on the row locks and the loser claims nothing —
 * it returns 0 rather than re-delivering the winner's batch. You do not need to arrange for a
 * single drainer, and consumers do not need to be idempotent to avoid N-way double-delivery.
 *
 * Draining from a dedicated worker is still the shape to prefer: draining per-request puts the
 * publish latency (and any broker/HTTP call it makes) inside the request that triggered it.
 *
 * @param db - Database executor
 * @param publish - Async callback to publish one event (e.g. bus.publish or send to broker)
 * @param orgId - Organization ID (scoping)
 * @param branchId - Branch ID (scoping; null for HQ)
 * @param opts - Lease tuning; see DrainOptions
 * @returns Number of events successfully published and marked (0 if another drainer holds the lease)
 * @throws If a publish callback throws, the drain halts at that event (earlier events stay marked)
 *
 * @example
 * const count = await drainOutbox(db, bus.publish.bind(bus), 'org-123', 'branch-456')
 * console.log(`published ${count} events`)
 */
export async function drainOutbox(
  db: RawExecutor,
  publish: (e: EventEnvelope) => Promise<void>,
  orgId: string,
  branchId: string | null,
  opts: DrainOptions = {},
): Promise<number> {
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const drainerId = opts.drainerId ?? DRAINER_ID

  const nowIso = new Date().toISOString()
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()

  // Claim in one atomic UPDATE. Two concurrent drainers serialize on the row locks: the loser
  // re-evaluates this WHERE after the winner commits, sees a live claim, matches nothing, and gets
  // an empty batch. Splitting this into select-then-claim is what re-opens the double-delivery
  // window — N drainers × N pending events = N² deliveries.
  const result = await db.query(
    `update event_outbox
        set claimed_by = $3, lease_expires_at = $4
      where published = false
        and org_id = $1 and (branch_id = $2 or (branch_id is null and $2 is null))
        and (lease_expires_at is null or lease_expires_at < $5)
      returning id, type, version, org_id, branch_id, seq, hlc, actor_id, actor_type, actor_model,
                causation_id, correlation_id, payload, created_at`,
    [orgId, branchId, drainerId, leaseExpiresAt, nowIso],
  )

  if (result.rows.length === 0) return 0

  // `returning` does not promise row order, and seq ordering is a guarantee of this module.
  const batch = result.rows.map(toEnvelope).sort((a, b) => a.seq - b.seq)

  let publishedCount = 0
  try {
    for (const env of batch) {
      // Publish the event (outside any tx to avoid deadlock on single-connection DBs)
      await publish(env)

      // Mark as published immediately after successful publish
      await db.query(`update event_outbox set published = true where id = $1`, [env.id])
      publishedCount++
    }
  } finally {
    // Release the claim on anything we did not publish, so the next drain retries at once instead
    // of waiting out the lease. A crash skips this — that path is what leaseMs covers.
    //
    // Matching on our own claim (rather than the batch's ids) is what makes this safe when our
    // lease has already expired: a drainer that took the batch over wrote its own lease_expires_at,
    // so this becomes a no-op instead of yanking a live claim out from under it. It also keeps the
    // statement at four params for any batch size.
    if (publishedCount < batch.length) {
      try {
        await db.query(
          `update event_outbox set claimed_by = null, lease_expires_at = null
            where claimed_by = $3 and lease_expires_at = $4 and published = false
              and org_id = $1 and (branch_id = $2 or (branch_id is null and $2 is null))`,
          [orgId, branchId, drainerId, leaseExpiresAt],
        )
      } catch {
        // Best-effort: the lease expiry frees these anyway, and throwing here would mask the
        // publish error that brought us into this block.
      }
    }
  }

  return publishedCount
}
