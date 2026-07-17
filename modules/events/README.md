# events-module

Event backbone: envelope (zod), HLC timestamps, transactional outbox, and in-proc pub/sub bus. Portable, with no product IP — runs on Node, Bun, and Workers (with adapters).

## What to take

**The envelope, the bus, the HLC and the upcaster registry are the portable core.** They have no
opinion about your database and drop into anything.

**The persistence is a reference implementation.** `pgOutboxStore` and `journalStore` are two useful
default shapes, not a claim that your events belong in our table. If any of these are true —

- your events sit behind **row-level security**, or any tenancy mechanism stronger than a predicate
- you need **`uuid` keys**, **`jsonb` payloads**, or `timestamptz`
- your **append-only log is your source of truth** and a separate staging table would be a second
  copy to keep consistent

— then write your own `OutboxStore` (four methods, ~40 lines) and keep the drain. That is a
supported path, not a fork: the seam exists precisely for it, and `drainOutbox` carries the
ADR-0014 lease so you do not reimplement the hard part. Read the invariants on `OutboxStore` in
`src/outbox.ts` before you do — "the claim must be one atomic statement" is the one that costs money
when missed.

What you should **not** do is take the whole module, discover a week later that the persistence
half was never going to fit your tenancy model, and rebuild it. Decide that on day one.

## What's inside

### 1. **Envelope** (`src/envelope.ts`)
- Zod schemas for domain events, sealed envelopes, and sealing context
- `EventEnvelope<T>` — the canonical immutable event shape
- `sealEvent(domain, ctx)` — seals a domain event into a durable envelope within a transaction

### 2. **HLC** (`src/hlc.ts`)
- Hybrid Logical Clock: monotonic, causally-consistent timestamps across hosts
- `Hlc.send()` — stamp locally-produced events
- `Hlc.receive(remote)` — merge remote timestamps while preserving causality
- `encodeHlc(ts)` — lexicographically sortable string encoding

### 3. **Upcast** (`src/upcast.ts`)
- Schema evolution registry: safely transform event payloads across versions
- `UpcasterRegistry` — register `(type, version) → (payload) → newPayload` transforms
- Chains upcasters: v1 → v2 → v3 automatically via `upcast(envelope)`
- Single unambiguous upgrade path per type (prevents forks)

### 4. **Bus** (`src/bus.ts`)
- In-process pub/sub event bus
- `EventBus.on(type, subscriber)` — subscribe to specific type or `'*'` for all
- `EventBus.publish(e)` — publish to all matching subscribers (serial order)
- Swappable with external brokers at scale (same domain code)

### 5. **Outbox** (`src/outbox.ts`) — the drain algorithm and its seam
- Transactional outbox pattern: **at-least-once delivery guarantee**
- `drainOutbox(store, publish, opts?)` — claim, order, publish, mark, release (second half). No SQL.
- `OutboxStore` — the persistence seam: `append`, `claimBatch`, `markPublished`, `releaseClaim`.
  Implement it to keep your own table, columns and tenancy (ADR-0015)
- Concurrent drainers are safe: the claim is one atomic UPDATE holding a lease, so a second drainer
  gets an empty batch instead of re-delivering the first one's events

### 6. **Stores** (`src/stores.ts`) — two shipped implementations
- `pgOutboxStore(db, orgId, branchId)` — staging table (`event_outbox`), `payload text`. Events wait
  here to be integrated; `published` is delivery bookkeeping
- `journalStore(db, orgId, branchId)` — the append-only log (`event_log`) **is** the outbox, `payload
  jsonb`. For event-sourced consumers: state is a fold of the journal, projections rebuild from it,
  and there is no second table to keep consistent
- Both share one implementation, so there is exactly one copy of the lease
- Minimal `RawExecutor` interface: works with any DB (Drizzle, raw PG, PGlite, Workers D1)
- SQL is always parameterized ($1, $2, …). Table names are the one thing that cannot be a bound
  parameter, so they are validated as identifiers instead
- Neither store applies RLS — see **What to take** above

## How to use

### Sealing domain events into the envelope

```typescript
import { sealEvent, type DomainEvent, type SealContext } from 'events-module'

// In your domain handler:
const domainEvent: DomainEvent = {
  type: 'invoice.posted',
  payload: { invoiceId: 'inv-001', amount: 10000 },
  version: 1, // optional; defaults to 1
}

// Backbone supplies seal context (tenancy, actor, seq, HLC, traceability)
const ctx: SealContext = {
  orgId: 'org-123',
  branchId: 'branch-456',
  actor: { id: 'user-1', type: 'human', model: null },
  causationId: 'cmd-789', // command that triggered this event
  correlationId: 'trace-abc', // end-to-end trace ID
  seq: 5,
  hlc: '00000000000f:0002',
}

const sealed = sealEvent(domainEvent, ctx)
```

### Transactional outbox: append + drain

```typescript
import { drainOutbox, pgOutboxStore, EventOutboxDDL, EventOutboxIndexDDL } from 'events-module'
import { PGlite } from '@electric-sql/pglite'

// Setup: create the outbox table once
const db = new PGlite()
await db.query(EventOutboxDDL)
await db.query(EventOutboxIndexDDL)

const executor = { query: (sql, params) => db.query(sql, params) }
const store = pgOutboxStore(executor, 'org-123', 'branch-456')

// ── In your request/command handler: domain write + event append, one transaction ──
await db.transaction(async (tx) => {
  await tx.query('insert into invoices (id, ...) values ($1, ...)', [invoiceId, ...])
  // Same tx: if the domain write rolls back, the event goes with it
  await store.append({ query: (sql, params) => tx.query(sql, params) }, [sealed])
})
// …and that is all the request does. It does NOT drain.
```

```typescript
// ── In a separate worker entrypoint (apps/worker), not the request ──
// Draining per-request puts publish latency — and any broker or HTTP call it makes — inside the
// request that appended the event, so a sale waits on someone else's e-invoice submission.
// It is not a correctness bug (the lease covers that), it is your p99.
const bus = new EventBus()
const store = pgOutboxStore(executor, 'org-123', 'branch-456')

setInterval(async () => {
  const published = await drainOutbox(store, bus.publish.bind(bus))
  if (published > 0) console.log(`published ${published} events`)
}, 1_000)
```

### The journal shape: your log is the outbox

For event-sourced consumers, where state is a fold of the log and projections rebuild from it. One
table, `payload jsonb`, so projections can filter and index payload contents server-side.

```typescript
import { drainOutbox, journalStore, JournalDDL, JournalIndexDDL } from 'events-module'

await db.query(JournalDDL)
for (const idx of JournalIndexDDL) await db.query(idx)

const store = journalStore(executor, 'org-123', 'branch-456')

// Append to the log — this is your source of truth, not a staging copy of it
await db.transaction(async (tx) => {
  await store.append({ query: (sql, params) => tx.query(sql, params) }, [sealed])
})

// A dispatcher publishes from the log. Same drain, same lease.
await drainOutbox(store, bus.publish.bind(bus))

// Projections are disposable: they fold the same rows.
const rows = await db.query(
  `select payload from event_log where org_id = $1 and payload->>'type' = 'sale' order by seq`,
  ['org-123'],
)
```

### Bringing your own store

If your events are behind RLS, or in `uuid`/`jsonb` columns, or in Drizzle, implement `OutboxStore`
and keep the drain. The invariants are documented on the interface — the claim being **one atomic
statement** is the one that costs money when missed (see ADR-0014: N concurrent drainers × N pending
events = N² deliveries).

```typescript
import { drainOutbox, type OutboxStore, type ClaimTicket } from 'events-module'

function rlsJournalStore(db: Db, orgId: string, branchId: string | null): OutboxStore {
  return {
    // Your scoped transaction, your RLS GUCs, your columns. The drain never sees any of it.
    append: (tx, events) => tx.insert(eventLog).values(events.map(toRow)),

    claimBatch: (t: ClaimTicket) =>
      withScope(db, orgId, branchId, (tx) =>
        tx
          .update(eventLog)
          .set({ claimedBy: t.drainerId, leaseExpiresAt: t.leaseExpiresAt })
          .where(and(eq(eventLog.published, false), leaseFree(t.now)))
          .returning()
          .then((rows) => rows.map(toEnvelope)),
      ),

    markPublished: (id) =>
      withScope(db, orgId, branchId, (tx) =>
        tx.update(eventLog).set({ published: true }).where(eq(eventLog.id, id)),
      ),

    // Match on drainerId AND leaseExpiresAt together, so a drainer whose lease already expired
    // cannot release the claim its successor now holds.
    releaseClaim: (t) =>
      withScope(db, orgId, branchId, (tx) =>
        tx
          .update(eventLog)
          .set({ claimedBy: null, leaseExpiresAt: null })
          .where(and(eq(eventLog.claimedBy, t.drainerId), eq(eventLog.leaseExpiresAt, t.leaseExpiresAt))),
      ),
  }
}

await drainOutbox(rlsJournalStore(db, 'org-123', null), bus.publish.bind(bus))
```

### Concurrency and the drain lease

`drainOutbox` claims its batch in a single atomic UPDATE that writes a lease, so it is safe to call
concurrently for the same `(orgId, branchId)`. Concurrent drainers serialize on the row locks; the
loser matches nothing and returns `0` rather than re-delivering the winner's batch. You do not need
to arrange for a single drainer, and consumers do not need to be idempotent to avoid N-way
double-delivery. (Idempotent consumers are still worth having — they cover the crash redelivery
below, which no lease can remove.)

A drainer releases the claim on anything it did not publish, so a poison event is retried on the
very next drain. The lease only matters when a drainer *dies* mid-drain: it cannot release its own
claim, so that batch waits out `leaseMs` before another drainer picks it up.

```typescript
// Set leaseMs above your slowest publish(). Too short and a second drainer reclaims events the
// first is still publishing; too long and recovery after a crash stalls for the rest of the lease.
await drainOutbox(store, publish, { leaseMs: 60_000 })
```

Each claim stores its own `lease_expires_at`, so drainers configured with different `leaseMs` values
cannot steal each other's live batches.

**Migrating an existing outbox table.** `EventOutboxDDL` is `create table if not exists`, so a table
created before the lease will not gain the columns. Add them once:

```sql
alter table event_outbox add column claimed_by text;
alter table event_outbox add column lease_expires_at text;
```

### Why the shipped tables use `text` columns

A deliberate portability trade, not an accident:

- **ISO-8601 UTC `text` timestamps compare lexicographically**, so the lease works identically on
  Postgres, PGlite and D1 with no `now()`/`interval` and no driver date handling.
- **`text` ids** carry ADR-0009 prefixed ULIDs (`inv_01K…`), which are not `uuid`s.
- **`payload text`** needs no JSON type from the backend.

The cost is real: a `text` payload is opaque to the query planner, so you cannot index or filter on
its contents server-side. That is exactly why `journalStore` exists with `payload jsonb` — and why,
if you are on Postgres and your projections read inside payloads, you should use it or your own
table. `lease_expires_at` stays `text` in both shapes, because lexicographic comparison is the one
behaviour the lease cannot afford to have vary.

### HLC for cross-branch causality

```typescript
import { Hlc, encodeHlc } from 'events-module'

// Each service instance maintains an HLC
const hlc = new Hlc()

// Stamp local events
const ts1 = hlc.send() // { wallMs: ..., counter: 0 }
const ts2 = hlc.send() // { wallMs: ..., counter: 1 } (stalled clock)

// Learn about remote events
const remoteTs = { wallMs: 5000, counter: 10 }
const merged = hlc.receive(remoteTs) // advances to { wallMs: 5000, counter: 11 }

// Lexicographically sortable for storage/queries
const encoded1 = encodeHlc(ts1)
const encoded2 = encodeHlc(ts2)
const encoded3 = encodeHlc(merged)
console.log(encoded1 < encoded2 && encoded2 < encoded3) // true
```

### Event schema evolution

```typescript
import { UpcasterRegistry } from 'events-module'

const registry = new UpcasterRegistry()

// v1: { amount } → v2: { amountMinor, currency }
registry.register<{ amount: number }, { amountMinor: number; currency: string }>(
  'invoice.posted',
  1,
  (oldPayload) => ({
    amountMinor: oldPayload.amount,
    currency: 'MYR',
  }),
)

// v2: { amountMinor, currency } → v3: { ... add taxCode }
registry.register('invoice.posted', 2, (p) => ({
  ...p,
  taxCode: 'SST',
}))

// Upcast an old envelope to the latest version
const oldEnvelope = { /* ... version: 1, payload: { amount: 1500 } */ }
const latest = registry.upcast(oldEnvelope)
console.log(latest.version) // 3
console.log(latest.payload) // { amountMinor: 1500, currency: 'MYR', taxCode: 'SST' }
```

### Event pub/sub

```typescript
import { EventBus } from 'events-module'

const bus = new EventBus()

// Subscribe to a specific type
const unsub1 = bus.on('invoice.posted', async (event) => {
  console.log('Invoice posted:', event.payload)
})

// Subscribe to all events
const unsub2 = bus.on('*', async (event) => {
  console.log('Event:', event.type)
})

// Publish
await bus.publish(envelope)

// Unsubscribe
unsub1()
unsub2()
```

## Exactly-once delivery semantics

The outbox provides **at-least-once delivery** with **poison event isolation**:

**Per-event marking (ordered stream):**
1. Events are appended in a transaction with the domain write (`store.append`).
2. Drain claims all unpublished, unclaimed events for the stream in one atomic UPDATE (a lease),
   sorts them by seq, and for each event:
   - Publishes the event (outside any transaction to avoid deadlock)
   - Immediately marks that event as published in a separate UPDATE
3. If a crash occurs after publish but before mark, that event redelivers once the lease expires.
4. If a publish fails, the drain halts at that event: earlier events stay marked (won't redeliver), the failing event stays unpublished, and later events are never attempted. The drain releases its claim on everything it didn't publish, so the next drain retries immediately.

This **poison isolation** ensures that one permanently-failing event doesn't cause earlier events to redeliver forever.

**Concurrency:** Drainers are safe to run concurrently against the same `(orgId, branchId)`. The
atomic claim means a second drainer gets an empty batch, not a second copy of the first drainer's
events — a select-then-publish drain delivers N² times under N concurrent drainers.

**Exactly-once effect** is achieved when **consumers are idempotent**:
- Track delivery by `event.id` (deduplication)
- If you receive the same `event.id` twice, process it only once
- Or use atomic upserts in your projections (e.g., `insert on conflict do nothing`)

Idempotency is no longer what protects you from concurrent drainers, but it still matters: a drainer
that dies between publish and mark redelivers that event after the lease expires, and no claim
strategy removes that. Consumers that allocate something per delivery (a document number, a running
total, a tax filing) are the ones that feel it.

The test suite includes a crash-recovery proof using file-backed PGlite with real SIGKILL process termination, demonstrating durability and per-event mark isolation, plus a concurrency proof that 8 simultaneous drainers deliver 8 events exactly 8 times rather than 64.

## Testing

```bash
# Run tests
bun run test

# Run tests with specific patterns
bun run test --name "crash recovery"

# Type-check
bun run typecheck
```

## Architecture constraints

- **No product IP**: Generic event types (e.g., `invoice.posted`); domain logic belongs in the consuming service.
- **WinterCG-clean**: No Node-only APIs in `src/`; tests may use Bun APIs.
- **Minimal dependencies**: Only `zod` and `uuidv7` in production.
- **Portable executors**: `RawExecutor` interface works with any database (Drizzle, Postgres, PGlite, Workers D1).
- **SQL parameterization**: All queries use `$1, $2, …` placeholders — never string-interpolated. Table
  names are the exception that proves it: they cannot be bound, so they are validated as identifiers.
- **Persistence is a seam, not a mandate**: `drainOutbox` holds the algorithm, `OutboxStore` holds the
  table. Bring your own store rather than forking the drain (ADR-0015).

## Testing

Open one database handle per test and close it in `afterEach`. PGlite's WASM heap is only returned on
`close()`, and an unclosed handle makes the file exit non-zero *with every test passing* — invisible
under `bun test` (one process for the whole package), fatal under a per-file runner. A trailing
`close()` is not enough: it leaks whenever a test throws early.

## References

- **ADR-0014** — Outbox drain concurrency: atomic claim with a lease
- **ADR-0015** — The drain is an algorithm over a store, not a table
- **ADR-0024** — Schema evolution via upcasters
- **ADR-0009** — Scalar vocabulary: ISO-8601 UTC, HLC encoding, prefixed ULIDs, tenancy fields
- **`docs/VENDORING.md`** — how to pull this module and what `.vendor.json` protects
