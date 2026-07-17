# ADR-0014 — Outbox drain: atomic claim with a lease, never at-most-once

**Status:** accepted 2026-07-17

## Context

`modules/events` shipped `drainOutbox` as select-then-publish-then-mark, with the precondition
documented in prose:

> **Concurrency:** Assumes a single drainer per (orgId, branchId). Concurrent drainers may
> double-deliver (idempotent consumers will deduplicate).

The first consumer violated it immediately, and not by carelessness. The natural way to use an
outbox is to drain right after the command that appended to it — which means one drainer per
request, which means concurrent drainers the moment two users transact at once. This module's own
README taught that shape in its usage example.

The cost is not linear. N concurrent drainers each select the same N pending events and each publish
all of them: **N² deliveries**. Measured through a real HTTP door, 8 concurrent sales produced 8
event rows and **64 tax-invoice submissions**, every one of which would have been filed with the
Malaysian tax authority as a real invoice. Nothing surfaced — all 8 requests returned 200.

"Idempotent consumers will deduplicate" is the half that bites. It is a large assumption to leave to
the caller, and it is silently false the moment a consumer allocates anything — a document number, a
running total, a tax filing. Both of that consumer's did.

This also violated ADR-0001: conventions must be executable (compile error, CI failure, generated
default). A precondition in a doc comment is none of those.

## Decision

**The drain claims its batch in one atomic UPDATE that writes a lease. Concurrent drainers are safe.
At-least-once and per-event poison isolation are both preserved.**

```sql
update event_outbox
   set claimed_by = $3, lease_expires_at = $4
 where published = false
   and org_id = $1 and (branch_id = $2 or (branch_id is null and $2 is null))
   and (lease_expires_at is null or lease_expires_at < $5)
 returning ...
```

Concurrent drainers serialize on the row locks: the loser re-evaluates the `WHERE` after the winner
commits, sees a live claim, matches nothing, and returns 0. Publish-then-mark per event is unchanged
behind the claim, so poison isolation survives. `returning` does not promise row order, so the batch
is sorted by `seq` before publishing.

### Rejected: claim by setting `published = true`

The obvious atomic claim — `update … set published = true … returning …` — was rejected. It trades
two properties this module has tests proving:

- **It flips at-least-once to at-most-once.** A crash between claim and publish loses the delivery
  permanently. Defensible if you decide that losing a delivery beats double-counting money, but it
  is a different product, and our SIGKILL crash-recovery proof exists precisely to assert the
  opposite.
- **It drops per-event poison isolation.** The batch is marked published in one statement, so events
  after a poison event are marked delivered but never delivered — silently lost.

The lease buys the same exclusion without either trade.

### Rejected: an in-process mutex

Cheaper (no migration, no knobs) and it fixes the single-instance case. Rejected because it works in
dev and staging (one process) and silently stops working in production the moment you run a second
instance — an environment-dependent, silent, money-losing failure. A guard that fails exactly where
it matters is worse than a documented precondition.

## Consequences

**The lease is a tuning knob, and it is a real cost.** `leaseMs` (default 30s) must exceed the
slowest `publish()` in a batch. Too short and a second drainer reclaims events the first is still
publishing — the double-delivery this exists to prevent. Too long and recovery after a crash stalls
for the remainder of the lease.

**Each claim carries its own expiry.** `lease_expires_at` is written by the claimer, not derived by
the reader from its own `leaseMs`. Otherwise a cron on the 30s default would steal a live batch from
a worker configured at 60s and double-deliver — the same bug, quieter. Drainers with different
`leaseMs` values cannot steal each other's live batches.

**A live drainer releases what it did not publish**, so a poison event is retried on the next drain
rather than waiting out the lease. The lease is only reached when a drainer *dies* mid-drain, which
is the at-least-once path and the one thing no claim strategy removes. Idempotent consumers still
matter for that path — they are just no longer what stands between you and N².

**The release matches on the drainer's own claim** (`claimed_by` + `lease_expires_at` + scope), not
on the batch's ids. This looks like a needless indirection and is not: if our lease expired while we
were publishing, another drainer has legitimately taken the batch over and written its own lease.
Releasing by id would null out that live claim and hand the batch to a third drainer while the
second is still publishing it. Matching on our own claim makes the release a no-op in exactly that
case. It also keeps the statement at four params for any batch size, rather than one per event.

**Crash recovery now waits out the lease.** The SIGKILL test asserts this rather than instant
redelivery; instant redelivery was only ever true because nothing was claimed.

**Timestamps are ISO-8601 UTC `text`, not `timestamptz`** — they compare lexicographically, so the
lease works identically on PG, PGlite and D1 without `now()`/`interval`.

**Migration.** `EventOutboxDDL` is `create table if not exists`, so tables created before this ADR
do not gain the columns. Vendored consumers add them once:

```sql
alter table event_outbox add column claimed_by text;
alter table event_outbox add column lease_expires_at text;
```

Cheap by construction: modules are vendored source, so existing consumers keep their copy until they
choose to pull, and new consumers get the DDL from scratch.

**Draining from a worker entrypoint (ADR-0003) is still the shape to prefer.** The lease makes
per-request draining *correct*, not *good*: it still puts publish latency inside the request that
triggered it. The module no longer punishes the mistake with N² deliveries, and the README no longer
teaches it.
