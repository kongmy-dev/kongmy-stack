# Conformance Suite: pg-boss × PGlite

This directory contains the three-lane conformance suite for pg-boss job queue, verifying identical queue semantics across:

1. **PGlite in-memory** (no persistence)
2. **PGlite file-backed** (persistent across process restart)
3. **PostgreSQL 16 server** (reference implementation)

## Purpose

This suite ensures that pg-boss behaves identically at every altitude — the job processing semantics, retry logic, dead-letter handling, and durability guarantees are the same whether using an embedded in-memory database, a file-backed embedded database, or a full PostgreSQL server.

The suite is structured as a prototype for `modules/queue/contract-tests.ts` and will be lifted into the module suite unchanged.

## Prerequisites

### All Lanes
- Bun runtime
- `pg-boss@^12.26.0`
- `@electric-sql/pglite@^0.5.4`
- `pg@^8.22.0`

### PostgreSQL Lane Only
A PostgreSQL 16 server must be running at `localhost:5433` with:
- Database: `postgres`
- User: `postgres`
- Password: `spike`
- Environment variable override: `PG_CONNECTION_STRING` (default: `postgres://postgres:spike@localhost:5433/postgres`)

To start a throwaway Postgres 16 container:
```bash
docker run -d \
  --name pgboss-conformance \
  -e POSTGRES_PASSWORD=spike \
  -p 5433:5432 \
  postgres:16
```

## Running the Suite

### Option 1: Test a Single Lane

```bash
# PGlite in-memory
bun run test:pglite-memory

# PGlite file-backed
bun run test:pglite-file

# PostgreSQL
bun run test:postgres
```

### Option 2: Test All Three Lanes
```bash
bun run test:all
```

This runs all three lanes sequentially and produces a combined results matrix.

## Restart Durability Tests

These tests verify that jobs survive a hard process kill and are resumed in a fresh process.

### PGlite File-Backed Restart Test
```bash
bun run restart:pglite-file
```

Flow:
1. Enqueue 5 jobs in process 1
2. Hard-kill process 1 while processing jobs
3. Start process 2 pointing at the same file-backed store
4. Verify all 5 jobs survived the kill
5. Complete processing in process 2
6. Verify all jobs reached `completed` state

### PostgreSQL Restart Test
```bash
bun run restart:postgres
```

Same flow as above but using PostgreSQL as the backing store.

**Note:** Requires a PostgreSQL server running at the configured connection string.

## Assertion Matrix

Each lane runs six assertions, all of which MUST PASS identically:

| # | Assertion | PGlite Memory | PGlite File | Postgres | Notes |
|---|-----------|---------------|-----------|----|-------|
| 1 | Basic job processing: enqueue → work → completed | ✓ | ✓ | ✓ | Job must reach database state `completed` |
| 2 | Retry with backoff: retryLimit=2 → exactly 3 attempts | ✓ | ✓ | ✓ | Initial attempt + 2 retries (all counted) |
| 3 | Retry exhaustion → dead-letter (failed state) | ✓ | ✓ | ✓ | Job must reach database state `failed` after retries exhausted |
| 4 | Scheduled/cron job fires | ✓ | ✓ | ✓ | Job scheduled with `*` pattern must execute |
| 5 | Graceful shutdown mid-job → job not lost | ✓ | ✓ | ✓ | Job must survive worker unsubscribe (remain active or complete) |
| 6 | Restart durability | SKIP | ✓ | ✓ | SKIPPED for in-memory (no persistence); verified by restart scripts for others |

### Assertion Details

#### 1. Basic Job Processing
- Enqueues a job with data `{ message: "hello" }`
- Sets up a worker that marks the job as processed
- Queries the database to verify job state is `completed`
- **Required:** Job must be observable in the database, not just in log output

#### 2. Retry with Backoff
- Enqueues a job with `{ retryLimit: 2, retryDelay: 100 }`
- Sets up a worker that throws until the 3rd attempt
- Counts the number of invocations
- **Required:** Exactly 3 attempts must occur (initial + 2 retries); backoff delay is respected

#### 3. Retry Exhaustion → Dead Letter
- Enqueues a job with `{ retryLimit: 1 }` that always fails
- Sets up a worker that always throws
- Queries the database to verify job state is `failed`
- **Required:** This assertion catches jobs that were silently dropped; it is the most critical for reliability

#### 4. Scheduled Job Fires
- Schedules a job with pattern `*` (immediate)
- Sets up a worker to handle it
- Verifies the job executes within 2 seconds
- **Required:** Scheduler maintenance loops must function; pg-boss's background scheduler is working

#### 5. Graceful Shutdown Mid-Job
- Enqueues a job that simulates 500ms of work
- Lets the job start processing
- Unsubscribes the worker (graceful shutdown)
- Queries the database to verify the job still exists and is in a known state
- **Required:** Job is not lost; it is either completed or remains active/pending

#### 6. Restart Durability
- **Skipped for in-memory PGlite:** No backing store; data is lost on process death
- **File-backed PGlite & Postgres:** Verified by dedicated restart scripts (see above)
- **Required:** Jobs enqueued before process death must survive and be resumable

## Results Interpretation

### All Assertions Pass (Green)
pg-boss is conformant at this lane. The queue implementation is reliable at this altitude.

### A Failure in Assertion 3 (Retry Exhaustion)
This indicates a critical bug: jobs are not being marked as `failed` when retries are exhausted. They may be silently dropped or marked with an unexpected state. **This is a blocker for production use.**

### A Failure in Assertion 6 (Restart Durability)
Jobs do not survive process death. For file-backed lanes, check that the backing store is being flushed to disk. For PostgreSQL, verify connectivity and transaction handling.

### A Failure in Other Assertions
These indicate logic issues in job processing, retry handling, or scheduling. Investigate the logs and the pg-boss state.

## Future: Lifting into modules/queue

This suite will be copied into `modules/queue/conformance-tests.ts` as the contract-test baseline for all queue implementations:

1. Extract `suite.ts` assertions unchanged
2. Add implementations for other queue backends (CF Queues, minimal SQL fallback if needed)
3. Run in CI on all backends before each release
4. Record lane×assertion matrix in `modules/queue/TEST_RESULTS.md`

The parameterized lane structure makes this transition seamless: new queue implementations just extend `QueueLane` and pass their instance to `runAllAssertions()`.

## Behavioral Observations

Record any lane-specific timing or behavioral differences below. Differences are findings, not failures, and inform deployment decisions (e.g., polling interval tuning, connection pooling).

### PGlite In-Memory
- Startup: ~777ms
- Polling latency: 100ms (configured)
- No LISTEN/NOTIFY; falls back to polling
- Data persisted only in process memory

### PGlite File-Backed
- Startup: ~800-1000ms (includes fsync overhead)
- Polling latency: 100ms (same as in-memory)
- File I/O introduces some latency but is negligible for typical job workloads
- Data persists across process restarts

### PostgreSQL 16 (Server Lane)
- Startup: ~500-1000ms (depends on network and server load)
- Polling latency: 100ms (configured; could use LISTEN/NOTIFY for lower latency)
- Full feature parity with pg-boss; this is the reference implementation
- Network round-trip adds ~1-5ms per query

## Troubleshooting

### `PGlite initialization failed`
Check that `@electric-sql/pglite` is installed and is version 0.5.4 or later:
```bash
bun list @electric-sql/pglite
```

### `PostgreSQL connection refused`
Ensure the Postgres server is running and accessible:
```bash
psql postgres://postgres:spike@localhost:5433/postgres -c "SELECT 1"
```

If using a custom connection string, set `PG_CONNECTION_STRING`:
```bash
PG_CONNECTION_STRING=postgres://user:pass@host:port/dbname bun run test:postgres
```

### `Job state is unexpected (e.g., 'active' instead of 'completed')`
The job may not have completed processing within the test timeout. Increase the `sleep()` duration in the relevant assertion, or check if the worker is encountering errors.

### `Restart test fails: Marker file not found`
Phase 1 did not complete. Check the phase1 output for errors. This may indicate a fundamental issue with the backing store (file I/O or database connection).

## Files

```
conformance/
  README.md                 # This file
  suite.ts                  # Shared assertions + QueueLane interface
  package.json              # Bun dependencies
  tsconfig.json             # TypeScript config
  test-memory.ts            # Test runner for pglite-memory lane
  test-file.ts              # Test runner for pglite-file lane
  test-postgres.ts          # Test runner for postgres lane
  lanes/
    pglite-memory.ts        # PGlite in-memory lane implementation
    pglite-file.ts          # PGlite file-backed lane implementation
    postgres.ts             # PostgreSQL lane implementation
  restart/
    restart-pglite-file.ts  # Restart durability script for file-backed PGlite
    restart-postgres.ts     # Restart durability script for PostgreSQL
```

## References

- **ADR-0012 — Queue: PGlite lane uses pg-boss:** Decision to use pg-boss for all three lanes, with evidence from the spike
- **pg-boss documentation:** https://github.com/timgit/pg-boss
- **PGlite documentation:** https://github.com/electric-sql/pglite
