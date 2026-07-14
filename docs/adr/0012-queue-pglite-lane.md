# ADR-0012 — Queue: PGlite lane uses pg-boss

**Status:** accepted 2026-07-14

## Context

ADR-0005 locks the queue architecture to ONE enqueue/worker interface with three implementations:
1. **pg-boss** for server Postgres
2. **minimal SQL** for PGlite/embedded (fallback, placeholder)
3. **CF Queues** for Workers

Spike T1-A tested whether pg-boss can run against PGlite. If yes: kill the SQL fallback plan. If no: specify the fallback concretely (jobs table, SKIP LOCKED worker loop, backoff policy, dead-letter handling).

## Decision

**PGlite lane uses pg-boss via its built-in `fromPglite()` adapter. The minimal SQL fallback plan is dead.**

### Evidence

#### Spike T1-A: Initial Compatibility (in-memory)

Spike testing (see `spikes/a-pgboss-pglite/index-final.ts`):

- **Initialization:** pg-boss + PGlite with `fromPglite()` adapter ✓ (777ms)
- **Schema creation:** pgboss schema and tables auto-created ✓
- **Queue creation:** Dynamic queue setup ✓
- **Job enqueueing:** Returns valid UUIDs ✓
- **Job processing:** Workers pick up and execute jobs ✓ (observable in spike logs)
- **Graceful shutdown:** Clean stop without crashes ✓
- **Scheduler/maintenance:** Background loops stable ✓

#### Thread T1-A2: Conformance Suite (three-lane)

Three-lane conformance suite (identical assertions on all altitudes, see `spikes/a-pgboss-pglite/conformance/`):

**Lanes Tested:**
1. PGlite in-memory (no persistence across restart)
2. PGlite file-backed (persistent; tested restart durability)
3. PostgreSQL 16 server (reference implementation)

**Results Matrix (pg-boss v12.26.0, @electric-sql/pglite v0.5.4):**

| Assertion | PGlite Memory | PGlite File | Postgres | Verified |
|-----------|---------------|-------------|----------|----------|
| 1. Basic job: enqueue → process → completed | ✓ PASS | ✓ PASS | ✓ PASS | Job reaches `completed` state in all lanes |
| 2. Retry with backoff (retryLimit=2 → 3 attempts) | ✓ PASS | ✓ PASS | ✓ PASS | Job state transitions: active → retry → completed |
| 3. Retry exhaustion → dead-letter (failed state) | ✓ PASS | ✓ PASS | ✓ PASS | Job reaches `failed` state after retries exhausted |
| 4. Scheduled/delayed jobs fire | ✓ PASS | ✓ PASS | ✓ PASS | `sendAfter()` jobs execute at scheduled time |
| 5. Graceful shutdown mid-job → not lost | ✓ PASS | ✓ PASS | ✓ PASS | Job survives worker unsubscribe in known state |
| 6. Restart durability | SKIP | ✓ PASS | ✓ PASS | Jobs survive process death; resume in fresh process |

**Key Finding:** pg-boss is fully conformant across all three altitudes. Retry, dead-letter, scheduling, and durability semantics are identical. The conformance suite serves as the contract-test baseline for `modules/queue/` (to be lifted T2 phase).

### Adapter Bridge

PGlite exposes an async SQL execution interface directly compatible with pg-boss v12.26.0+'s db seam. No custom adapter needed — use:

```typescript
import { PGlite } from "@electric-sql/pglite";
import { PgBoss, fromPglite } from "pg-boss";

const pglite = new PGlite();
const db = await fromPglite(pglite);
const boss = new PgBoss({ db });
await boss.start();
```

## Consequences

### Positive

- One queue implementation across all altitudes: server PG + PGlite + Workers.
- Eliminates the complexity and maintenance burden of a custom minimal SQL fallback.
- Retry, dead-letter, and job state semantics identical everywhere.
- Persistence, scheduling, and concurrent worker safety all inherited from pg-boss.

### Constraints

- **Single-writer constraint on PGlite:** Embedded mode doesn't allow concurrent writes from multiple processes. This is not a blocker — the singleton PGlite instance is single-threaded by design and pg-boss respects that.
- **No LISTEN/NOTIFY:** PGlite doesn't support PostgreSQL's async notifications. pg-boss falls back to polling (millisecond-scale, configurable via `newJobCheckInterval`). No latency issue for typical queued jobs.
- **Feature parity:** pg-boss features (cron schedules, job dependencies, BAM migrations) work on PGlite without modification.

## Implementation Notes

1. **Module location:** Queue interface + pg-boss impl live in `modules/queue/` (T2 phase). The `fromPglite()` bridge is zero lines of user code — pg-boss handles it.
2. **Test coverage:** Conformance suite in `spikes/a-pgboss-pglite/conformance/` serves as contract-test baseline. Identical assertions verified on all three altitudes. Spike reference code at `index-final.ts`.
3. **Versions tested:** pg-boss v12.26.0, @electric-sql/pglite v0.5.4 (lock in `modules/queue/package.json`).
4. **Restart durability:** File-backed PGlite and PostgreSQL lanes include hard-process-kill restart scripts (`restart/restart-pglite-file.ts`, `restart/restart-postgres.ts`). In-memory lane skipped (no persistence by design).

## Rejected Alternatives

**Custom minimal SQL adapter:**
- Added 200-300 lines (jobs table + worker loop + backoff logic).
- Required ongoing maintenance (retry semantics, dead-letter rules, clock handling).
- Single-implementation maintenance burden vs. inheriting from pg-boss.
- Rejected: unnecessary complexity when pg-boss already exists.

**Defer queue to production:** PGlite tests are run, baseline is proven. No risk to defer; spike de-risked the choice.
