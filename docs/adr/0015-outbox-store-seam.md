# ADR-0015 — The drain is an algorithm over a store, not a table

**Status:** accepted 2026-07-17

## Context

`modules/events` shipped one outbox: `event_outbox`, a staging table whose DDL, column types and
tenancy predicate were owned by the module. `drainOutbox` took a `RawExecutor` and wrote that
table's SQL inline.

The first production consumer adopted the envelope, the bus, the HLC and the upcaster registry
as-is, and **rebuilt the outbox from scratch**. Their reasons, in their order:

1. **Row-level security.** Their event log sits behind a Postgres RLS policy driven by GUCs set
   inside a scoped transaction. Our drain scopes with a predicate the caller passes in — isolation
   by remembering. For the most sensitive table in their system, a forgotten predicate is a
   cross-tenant read. This one was not negotiable for them.
2. **Column types.** They pin UUIDv7 primary keys and need `payload jsonb`, because their accounting
   read model folds years of events into ledger lines and must index and filter on payload contents.
   `payload text` forecloses that.
3. **The journal *is* the outbox.** Their architecture makes the append-only log the source of
   truth: state is a fold of it, projections are disposable and rebuildable, branch relocation is a
   replay. With a separate `event_outbox` they would have two tables and the job of keeping them
   consistent — which is the problem the outbox pattern exists to avoid.

Their own diagnosis was that the module "assumes the outbox is *separate from* wherever your events
live", and suggested the drain be "parameterised over the table/columns rather than owning its own
DDL".

That diagnosis is right; that fix is not. A table name cannot be a bound parameter, so
parameterising over table/columns means interpolating identifiers into SQL — trading this module's
"never string-interpolate" rule for a half-built ORM, and *still* not delivering RLS (which is a
transaction shape, not a column name) or `jsonb` (which changes how payloads are read back).

## Decision

**Split the drain into an algorithm and a persistence seam** (ADR-0002: seams = interface +
adapters).

- `drainOutbox(store, publish, opts)` owns the algorithm — claim, sort by `seq`, publish, mark,
  release — and contains no SQL.
- `OutboxStore` owns persistence: `append`, `claimBatch`, `markPublished`, `releaseClaim`.
- Two stores ship, sharing one implementation and therefore **one copy of the ADR-0014 lease**:
  - `pgOutboxStore` — the staging table, `payload text`, unchanged behaviour and DDL.
  - `journalStore` — the log is the outbox, `payload jsonb`, plus a replay index. For
    event-sourced consumers.

A consumer with RLS writes their own store: the ~40 lines of `sqlStore` with their scoped
transaction around each statement. The drain is unchanged and the lease is not reimplemented.

`OutboxStore` carries the invariants a store must hold, because the drain cannot enforce them:
the claim is one atomic statement; it returns only unpublished events whose lease is absent or
expired; `releaseClaim` matches on `drainerId` **and** `leaseExpiresAt` together.

### Why not a separate `journal` module

Because the difference between an outbox and a journal is which table the drain points at, plus a
payload codec. The claim, the ordering, the poison isolation and the release-on-exit are identical.
Two modules means two copies of the lease — the single trickiest code in this repo, and the one
place where a silent divergence costs money. One seam, two stores, one lease.

### Why `pgOutboxStore` still uses `text`

Deliberate, now stated in the module rather than left to look accidental: ISO-8601 UTC text compares
lexicographically, so the lease behaves identically on PG, PGlite and D1 with no `now()`/`interval`;
ids are ADR-0009 prefixed ULIDs, not uuids; `payload text` needs no JSON type from the backend. The
cost is a payload the query planner cannot see into. Consumers who need to read inside payloads use
`journalStore`, or their own.

## Consequences

- **Breaking:** `drainOutbox(db, publish, orgId, branchId, opts)` →
  `drainOutbox(store, publish, opts)`; `appendEvent(tx, events)` → `store.append(tx, events)`.
  Sanctioned by the repo's public stance (no semver, breaking changes without notice); the only
  consumer had already rebuilt this half and calls neither.
- The honest guidance is now executable rather than prose: a consumer who cannot use our
  persistence implements four methods instead of forking the module or, as happened, spending a week
  discovering they should not use it at all.
- Tests run every semantic against both stores, so the two shapes cannot drift. A third lane drives
  the drain through an in-memory store with no database behind it — that lane exists to falsify the
  claim that this is a real seam. (It does not prove the concurrency semantics: JS gives its claim
  atomicity for free. The SQL lanes carry that.)
- Still not solved, and correctly so: RLS, uuid columns and Drizzle stay consumer-side. This ADR
  makes them a store the consumer owns, not a fork of the drain they own.
