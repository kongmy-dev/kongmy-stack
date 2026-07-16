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
 * - created_at: ISO-8601 UTC timestamp
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

/**
 * Drain the outbox: publish unpublished events and mark them as published.
 * **Second half of transactional outbox pattern.**
 *
 * **Semantics: ordered stream with poison isolation.**
 *
 * At-least-once delivery guarantee:
 * 1. Fetch all unpublished events in seq order (per org/branch)
 * 2. For each event (in sequence):
 *    - Call the publish callback (outside any transaction to avoid deadlock)
 *    - Immediately mark event as published in a separate update transaction
 * 3. If publish() throws, drain halts at that event (preserves seq ordering)
 *
 * **Poison event isolation:** If event E fails to publish, earlier events (E-1, E-2, ...) are
 * already marked and will NOT redeliver on the next drain. Event E stays unpublished and will
 * be re-attempted next drain. Events after E (E+1, E+2, ...) are never attempted until E succeeds.
 *
 * **Exactly-once effect:** Achieved when consumers are idempotent (e.g. event.id deduplication).
 * If a crash occurs after publish() and before the mark UPDATE, the event redelivers on restart.
 *
 * **Concurrency:** Assumes a single drainer per (orgId, branchId). Concurrent drainers may
 * double-deliver (idempotent consumers will deduplicate).
 *
 * @param db - Database executor
 * @param publish - Async callback to publish one event (e.g. bus.publish or send to broker)
 * @param orgId - Organization ID (scoping)
 * @param branchId - Branch ID (scoping; null for HQ)
 * @returns Number of events successfully published and marked
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
): Promise<number> {
  // Fetch unpublished events
  const result = await db.query(
    `select id, type, version, org_id, branch_id, seq, hlc, actor_id, actor_type, actor_model,
            causation_id, correlation_id, payload, created_at
     from event_outbox
     where published = false and org_id = $1 and (branch_id = $2 or (branch_id is null and $2 is null))
     order by seq asc`,
    [orgId, branchId],
  )

  const rows = result.rows
  if (rows.length === 0) return 0

  // Publish each event and mark immediately (per-event marking ensures poison isolation).
  // If a publish fails, the drain halts at that event: all earlier events are marked (won't redeliver),
  // the failing event stays unpublished, and later events are never attempted.
  // This preserves seq ordering and prevents earlier events from being redelivered forever.
  let publishedCount = 0
  for (const row of rows) {
    const env: EventEnvelope = {
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

    // Publish the event (outside any tx to avoid deadlock on single-connection DBs)
    await publish(env)

    // Mark as published immediately after successful publish
    await db.query(
      `update event_outbox set published = true where id = $1`,
      [env.id],
    )
    publishedCount++
  }

  return publishedCount
}
