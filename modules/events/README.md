# events-module

Event backbone: envelope (zod), HLC timestamps, transactional outbox, and in-proc pub/sub bus. Portable, with no product IP — runs on Node, Bun, and Workers (with adapters).

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

### 5. **Outbox** (`src/outbox.ts`)
- Transactional outbox pattern: **at-least-once delivery guarantee**
- `appendEvent(tx, events)` — append sealed events within domain transaction (first half)
- `drainOutbox(db, publish, orgId, branchId)` — publish unpublished events, then mark (second half)
- Minimal `RawExecutor` interface: works with any DB (Drizzle, raw PG, PGlite, Workers D1)
- SQL is always parameterized ($1, $2, …) — never string-interpolated

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
import { appendEvent, drainOutbox, EventOutboxDDL } from 'events-module'
import { Database } from '@electric-sql/pglite'

// Setup: create outbox table once
const db = new Database()
await db.query(EventOutboxDDL)

// Domain write + event append in one transaction
await db.transaction(async (tx) => {
  // Domain write (e.g., insert invoice)
  await tx.query('insert into invoices (id, ...) values ($1, ...)', [invoiceId, ...])
  // Append sealed event in the same tx
  const executor = { query: (sql, params) => tx.query(sql, params) }
  await appendEvent(executor, [sealed])
})

// Drain: publish events outside the transaction (avoids deadlock on single-connection DBs)
// Subscribers run independently; outbox re-delivers on crash
const bus = new EventBus()
const published = await drainOutbox(db, bus.publish.bind(bus), 'org-123', 'branch-456')
console.log(`published ${published} events`)
```

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
1. Events are appended in a transaction with the domain write.
2. Drain fetches unpublished events in seq order and, for each event:
   - Publishes the event (outside any transaction to avoid deadlock)
   - Immediately marks that event as published in a separate UPDATE
3. If a crash occurs after publish but before mark, that event redelivers on restart.
4. If a publish fails, the drain halts at that event: earlier events stay marked (won't redeliver), the failing event stays unpublished, and later events are never attempted.

This **poison isolation** ensures that one permanently-failing event doesn't cause earlier events to redeliver forever.

**Exactly-once effect** is achieved when **consumers are idempotent**:
- Track delivery by `event.id` (deduplication)
- If you receive the same `event.id` twice, process it only once
- Or use atomic upserts in your projections (e.g., `insert on conflict do nothing`)

**Concurrency:** The module assumes **a single drainer per (orgId, branchId) stream**. Concurrent drainers may double-deliver events (idempotent consumers deduplicate).

The test suite includes a crash-recovery proof using file-backed PGlite with real SIGKILL process termination, demonstrating durability and per-event mark isolation.

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
- **SQL parameterization**: All queries use `$1, $2, …` placeholders — never string-interpolated.

## References

- **ADR-0021** (in consuming templates) — Event envelope and outbox semantics
- **ADR-0024** — Schema evolution via upcasters
- **ADR-0009** — Scalar vocabulary: ISO-8601 UTC, HLC encoding, prefixed ULIDs, tenancy fields
