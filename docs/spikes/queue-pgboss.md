# Spike A — Queue: pg-boss at every altitude (incl. PGlite)

**Pick:** pg-boss for **both** server-Postgres and embedded-PGlite lanes (ADR-0012). The planned minimal-SQL fallback is dead. CF Queues remains the Workers lane. Versions proven: `pg-boss@^12.26 · @electric-sql/pglite@0.5.4 · postgres:16`.

**Key fact (independently verified):** PGlite is a *first-party* pg-boss target — `pg-boss/dist/adapters/pglite.js` ships `fromPglite` alongside `fromKnex`/`fromKysely`/`fromDrizzle`/`fromPrisma`. Upstream owns the compatibility surface.

## The bridge (zero custom code)

```typescript
import { PGlite } from '@electric-sql/pglite';
import { PgBoss, fromPglite } from 'pg-boss';

const pglite = new PGlite('/path/to/store');   // or new PGlite() in-memory
const boss = new PgBoss({ db: await fromPglite(pglite) });
await boss.start();                             // schema auto-created

await boss.createQueue('invoices');
await boss.send('invoices', { id: 'inv_01…' }, { retryLimit: 2, retryDelay: 100 });
boss.work('invoices', async ([job]) => { /* handler */ });
```

## Conformance matrix — all 18 cells asserted green (`spikes/a-pgboss-pglite/conformance/`)

| Assertion (each queried from pg-boss job state, not logs) | PGlite mem | PGlite file | Postgres 16 |
|---|---|---|---|
| enqueue → worker → `completed` | ✅ | ✅ | ✅ |
| retry w/ backoff: retryLimit=2 → exactly 3 attempts | ✅ | ✅ | ✅ |
| retry exhaustion → `failed` (dead-letter) | ✅ | ✅ | ✅ |
| scheduled job fires (`sendAfter`) | ✅ | ✅ | ✅ |
| graceful shutdown mid-job → job not lost | ✅ | ✅ | ✅ |
| hard process-kill → fresh process resumes jobs | skip (n/a) | ✅ | ✅ |

Run: `cd spikes/a-pgboss-pglite/conformance && bun install && bun run test:all` (Postgres lane expects a `postgres://` DSN — see its README).

## Constraints the queue module must document

- **No LISTEN/NOTIFY on PGlite** → pg-boss polls. In-process polling is cheap (no network hop) but is work on PGlite's single-threaded engine — tune `newJobCheckInterval` generously on battery/embedded devices.
- **Single writer, shared event loop**: job-handler SQL competes with app SQL on the same engine; keep embedded-lane handlers light.
- **Version pinning**: PGlite is pre-1.0; pin both packages in `modules/queue`.

## Carry-forward

`conformance/suite.ts` (six assertions over a small `QueueLane` interface) is the seed of `modules/queue`'s contract tests — new backends (CF Queues) get added as lanes, same assertions.
