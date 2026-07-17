import type { EventEnvelope } from './envelope.js'
import type { ClaimTicket, OutboxStore, RawExecutor } from './outbox.js'

/**
 * SQL-backed OutboxStore implementations (ADR-0002 adapters, ADR-0014 lease).
 *
 * Two shapes ship here, and they differ in exactly three things — table, payload column type, and
 * whether the table is also your read model. Everything else, including the atomic lease claim, is
 * shared: one copy of the claim SQL, because two copies drift and the lease is the part you cannot
 * afford to have drift.
 *
 * - `pgOutboxStore` — a staging table (`event_outbox`). Events wait to be integrated; `published`
 *   is delivery bookkeeping. The classic pattern, and correct when your durable state lives
 *   elsewhere and events are how you tell other systems about it.
 * - `journalStore` — the append-only log IS the outbox. For event-sourced consumers where state is
 *   a fold of the journal and projections are rebuildable from it, there is no staging table to
 *   keep consistent: the log carries `published` as a column. `payload` is `jsonb`, so projections
 *   can index and filter on payload contents server-side.
 *
 * Neither store applies row-level security. If your events are behind RLS — and an event log is a
 * good candidate for it — write your own store: it is the ~40 lines below with your scoped
 * transaction wrapped around each statement, and the drain is unchanged. Read the OutboxStore
 * invariants in `outbox.ts` first; the claim being one atomic statement is the one that matters.
 */

/** Column list shared by both shapes. `payload`'s type differs; its position does not. */
const COLUMNS = [
  'id',
  'type',
  'version',
  'org_id',
  'branch_id',
  'seq',
  'hlc',
  'actor_id',
  'actor_type',
  'actor_model',
  'causation_id',
  'correlation_id',
  'payload',
  'created_at',
] as const

const RETURNING = COLUMNS.join(', ')

/**
 * A table name cannot be a bound parameter — it has to be interpolated, so it has to be validated.
 * Table names come from a composition root, not from user input, but "should" is not an argument
 * that survives contact with a codebase.
 */
function assertIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${JSON.stringify(name)} (expected lowercase_snake)`)
  }
  return name
}

/** How a payload crosses the driver boundary. `text` and `jsonb` disagree only on the way back. */
interface PayloadCodec {
  encode(payload: unknown): unknown
  decode(value: unknown): unknown
}

/** `payload text`: stringify in, parse out. Portable to any backend, opaque to the query planner. */
const textPayload: PayloadCodec = {
  encode: (payload) => JSON.stringify(payload),
  decode: (value) => JSON.parse(String(value)) as unknown,
}

/** `payload jsonb`: PG parses on the way in and hands back a value on the way out. */
const jsonbPayload: PayloadCodec = {
  encode: (payload) => JSON.stringify(payload),
  decode: (value) => (typeof value === 'string' ? (JSON.parse(value) as unknown) : value),
}

function toEnvelope(row: Record<string, unknown>, codec: PayloadCodec): EventEnvelope {
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
    payload: codec.decode(row.payload),
    createdAt: String(row.created_at),
  }
}

interface SqlStoreConfig {
  table: string
  codec: PayloadCodec
  orgId: string
  branchId: string | null
}

/**
 * The shared implementation. Both exported stores are this with a different table and codec.
 * Scoping is an org/branch predicate — isolation by remembering to pass the right values. That is
 * fine for a single-tenant deployment and is exactly what RLS exists to replace; see the module
 * docstring above.
 */
function sqlStore(db: RawExecutor, config: SqlStoreConfig): OutboxStore {
  const table = assertIdentifier(config.table)
  const { codec, orgId, branchId } = config

  /** `branch_id = $2 or (branch_id is null and $2 is null)` — a null branch means HQ, not "any". */
  const scope = `org_id = $1 and (branch_id = $2 or (branch_id is null and $2 is null))`

  return {
    async append(tx: RawExecutor, events: EventEnvelope[]): Promise<void> {
      if (events.length === 0) return

      const width = COLUMNS.length
      const values = events
        .map(
          (_, i) =>
            `(${Array.from({ length: width }, (_, j) => `$${i * width + j + 1}`).join(', ')})`,
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
        codec.encode(e.payload),
        e.createdAt,
      ])

      await tx.query(`insert into ${table} (${RETURNING}) values ${values}`, params)
    },

    async claimBatch(ticket: ClaimTicket): Promise<EventEnvelope[]> {
      // ONE atomic UPDATE. Two concurrent drainers serialize on the row locks: the loser
      // re-evaluates this WHERE after the winner commits, sees a live claim, matches nothing, and
      // gets an empty batch. Splitting this into select-then-claim is what re-opens the
      // double-delivery window — N drainers × N pending events = N² deliveries (ADR-0014).
      const result = await db.query(
        `update ${table}
            set claimed_by = $3, lease_expires_at = $4
          where published = false
            and ${scope}
            and (lease_expires_at is null or lease_expires_at < $5)
          returning ${RETURNING}`,
        [orgId, branchId, ticket.drainerId, ticket.leaseExpiresAt, ticket.now],
      )
      return result.rows.map((row) => toEnvelope(row, codec))
    },

    async markPublished(id: string): Promise<void> {
      await db.query(`update ${table} set published = true where id = $1`, [id])
    },

    async releaseClaim(ticket: ClaimTicket): Promise<void> {
      // Matching on our own claim (rather than the batch's ids) is what makes this safe when our
      // lease has already expired: a drainer that took the batch over wrote its own
      // lease_expires_at, so this becomes a no-op instead of yanking a live claim out from under
      // it. It also keeps the statement at four params for any batch size.
      await db.query(
        `update ${table} set claimed_by = null, lease_expires_at = null
          where claimed_by = $3 and lease_expires_at = $4 and published = false and ${scope}`,
        [orgId, branchId, ticket.drainerId, ticket.leaseExpiresAt],
      )
    },
  }
}

/**
 * Store over a staging outbox table (`event_outbox`, or your own name).
 * Events wait here to be integrated; `published` is delivery bookkeeping.
 *
 * @example
 * const store = pgOutboxStore(db, 'org-123', 'branch-456')
 * await db.transaction(async (tx) => {
 *   await tx.query('insert into invoices ...', [...])
 *   await store.append(wrap(tx), [sealed])
 * })
 * await drainOutbox(store, bus.publish.bind(bus))
 */
export function pgOutboxStore(
  db: RawExecutor,
  orgId: string,
  branchId: string | null,
  opts: { table?: string | undefined } = {},
): OutboxStore {
  return sqlStore(db, {
    table: opts.table ?? 'event_outbox',
    codec: textPayload,
    orgId,
    branchId,
  })
}

/**
 * Store over an append-only journal that IS the outbox (`event_log`, or your own name).
 *
 * For event-sourced consumers: state is a fold of the journal, projections are disposable and
 * rebuildable from it, and `published` rides on the log rows themselves. One table, so there is no
 * journal/outbox consistency problem — which is the problem the outbox pattern exists to avoid.
 *
 * @example
 * const store = journalStore(db, 'org-123', 'branch-456')
 * await db.transaction(async (tx) => await store.append(wrap(tx), [sealed]))
 * await drainOutbox(store, bus.publish.bind(bus))   // dispatcher publishes from the log
 */
export function journalStore(
  db: RawExecutor,
  orgId: string,
  branchId: string | null,
  opts: { table?: string | undefined } = {},
): OutboxStore {
  return sqlStore(db, {
    table: opts.table ?? 'event_log',
    codec: jsonbPayload,
    orgId,
    branchId,
  })
}

/**
 * DDL for a staging outbox table.
 * Must be run once per database before using pgOutboxStore.
 *
 * Columns:
 * - id: Prefixed ULID event identifier (primary key)
 * - type, version: Event type and schema version
 * - org_id, branch_id: Tenancy scoping
 * - seq, hlc: Ordering and causality
 * - actor_id, actor_type, actor_model: Who caused the event
 * - causation_id, correlation_id: Traceability
 * - payload: JSON event payload
 * - published: Whether the drain has marked this event as delivered
 * - claimed_by, lease_expires_at: Drain lease (see drainOutbox). null = unclaimed.
 * - created_at: ISO-8601 UTC timestamp
 *
 * **Why `text` and not `uuid`/`jsonb`/`timestamptz`: this is a portability trade, not an accident.**
 * ISO-8601 UTC text compares lexicographically, so the lease works identically on PG, PGlite and
 * D1 without `now()`/`interval`; `text` ids carry ADR-0009 prefixed ULIDs, which are not uuids; and
 * `payload text` needs no JSON type from the backend. The cost is real — an opaque payload cannot
 * be indexed or filtered server-side. If you are on Postgres and your projections need to read
 * inside payloads, use `JournalDDL` (or your own table) and `journalStore`.
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
 * DDL for an append-only journal that doubles as the outbox (Postgres/PGlite).
 * Must be run once per database before using journalStore.
 *
 * Differs from `EventOutboxDDL` where an event-sourced consumer needs it to:
 * - `payload jsonb` — projections can index and filter on payload contents server-side, which is
 *   the point of keeping the log as the source of truth.
 * - a `seq` index — replay and fold read this table in order, constantly; a staging outbox is
 *   drained and forgotten.
 *
 * `lease_expires_at` stays ISO-8601 `text` deliberately: the lease compares lexicographically and
 * that is the one thing that must behave identically to the outbox shape.
 *
 * Not included, and yours to add: row-level security. See the note in `journalStore`.
 */
export const JournalDDL = `create table if not exists event_log (
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
  payload jsonb not null,
  published boolean not null default false,
  claimed_by text,
  lease_expires_at text,
  created_at text not null,

  unique (org_id, branch_id, seq)
)`

export const JournalIndexDDL = [
  `create index if not exists idx_event_log_unpublished_org_branch
     on event_log(published, org_id, branch_id)`,
  `create index if not exists idx_event_log_replay on event_log(org_id, branch_id, seq)`,
]
