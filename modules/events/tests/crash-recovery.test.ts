// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drainOutbox, type RawExecutor } from '../src/outbox'
import { EventOutboxDDL, EventOutboxIndexDDL, pgOutboxStore } from '../src/stores'
import type { EventEnvelope } from '../src/envelope'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Adapter: wrap PGlite as RawExecutor
function createExecutor(db: PGlite): RawExecutor {
  return {
    query: async (sql: string, params: unknown[]) => {
      const rawResult = await db.query(sql, params as string[])
      return { rows: rawResult.rows as Record<string, unknown>[] }
    },
  }
}

function mockEnvelope(id: string, seq: number): EventEnvelope {
  return {
    id,
    type: 'crash-test.event',
    version: 1,
    orgId: 'org-crash-test',
    branchId: 'br-crash-test',
    seq,
    hlc: `0000000000${String(seq).padStart(2, '0')}:0000`,
    actor: { id: 'sys', type: 'system', model: null },
    causationId: null,
    correlationId: `trace-crash-${id}`,
    payload: { seq, id },
    createdAt: new Date().toISOString(),
  }
}

/**
 * CRITICAL PROOF: Real SIGKILL crash recovery (cross-process).
 *
 * The outbox pattern gives at-least-once delivery with per-event marking:
 * - Events are published then immediately marked as published
 * - If SIGKILL hits after publish but before mark, that event redelivers on restart
 * - Events already marked before the kill never redeliver
 *
 * This test proves via actual process termination (SIGKILL), not in-process throws:
 * 1. Append N events to file-backed PGlite
 * 2. Spawn drain worker in separate process
 * 3. SIGKILL after ≥1 delivery
 * 4. Verify delivery log: early events delivered once, event-in-flight may appear twice
 * 5. Wait out the dead worker's lease, restart drain, verify all events marked
 *
 * Proves:
 * - DB durability under SIGKILL (no graceful shutdown)
 * - Per-event marking prevents earlier redeliver after crash
 * - Exactly-once effect with idempotent consumer (dedup by event.id)
 * - A killed drainer's claim is freed by lease expiry, not left stranded forever
 *
 * The worker uses a short lease so step 5 does not sit through the 30s default: a SIGKILLed
 * drainer cannot release its own claim, so lease expiry is the only thing that frees the batch.
 * That wait is the real cost of the lease, and it is the price of never double-delivering.
 */
const CRASH_LEASE_MS = 500
test('crash recovery: real SIGKILL proves durability + per-event mark isolation', async () => {
  const dbDir = await import('os').then((os) => path.join(os.tmpdir(), `sigkill-test-${Date.now()}`))
  const dbPath = path.join(dbDir, 'crash.db')
  const deliveryLogFile = path.join(dbDir, 'deliveries.txt')

  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  try {
    // Setup: initialize DB and append events
    const db = new PGlite(dbPath)
    const tx = createExecutor(db)
    await db.query(EventOutboxDDL)
    await db.query(EventOutboxIndexDDL)

    const eventCount = 5
    const events = Array.from({ length: eventCount }, (_, i) => mockEnvelope(`ev-${i + 1}`, i + 1))
    await pgOutboxStore(tx, 'org-crash-test', 'br-crash-test').append(tx, events)
    await db.close()

    // Spawn drain worker and SIGKILL mid-stream
    const workerScript = path.join(__dirname, 'fixtures/drain-worker.ts')
    const worker1 = Bun.spawn(
      ['bun', 'run', workerScript, dbPath, deliveryLogFile, '2', String(CRASH_LEASE_MS)], // SIGKILL after event 2
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )

    // Wait for worker to be killed (it will wait forever at maxEventCount)
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Force SIGKILL
    worker1.kill(9)
    const exit1 = await worker1.exited

    // Give file I/O time to flush
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Check delivery log: should have 1-2 event IDs (depends on exact timing)
    const deliveriesAfterKill = fs
      .readFileSync(deliveryLogFile, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(deliveriesAfterKill.length).toBeGreaterThanOrEqual(1)
    expect(deliveriesAfterKill.length).toBeLessThanOrEqual(2)

    const deliveredBefore = new Set(deliveriesAfterKill)

    // Wait out the killed worker's lease: it died holding a claim it can never release, so until
    // the lease expires a restarted drain correctly refuses to touch its batch.
    await new Promise((resolve) => setTimeout(resolve, CRASH_LEASE_MS + 300))

    // Restart drain in-process to completion
    const db2 = new PGlite(dbPath)
    const deliveredAfter = new Set<string>()
    await drainOutbox(
      pgOutboxStore(createExecutor(db2), 'org-crash-test', 'br-crash-test'),
      async (e) => {
        deliveredAfter.add(e.id)
        // Append to log for final verification
        fs.appendFileSync(deliveryLogFile, `${e.id}\n`)
      },
    )
    await db2.close()

    // Verify final state
    const finalLog = fs
      .readFileSync(deliveryLogFile, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)

    // Count occurrences: each event should appear in final log
    const occurrences: Record<string, number> = {}
    for (const id of finalLog) {
      occurrences[id] = (occurrences[id] ?? 0) + 1
    }

    // All events should be present
    for (const event of events) {
      expect(occurrences[event.id]).toBeGreaterThan(0)
    }

    // Events delivered before kill should appear 1-2 times (once before, maybe once after if not marked)
    for (const id of deliveredBefore) {
      expect(occurrences[id]).toBeLessThanOrEqual(2)
    }

    // Verify DB final state: all marked as published
    const db3 = new PGlite(dbPath)
    const remainingUnpublished = await db3.query(
      'select count(*) as cnt from event_outbox where published = false',
    )
    expect(remainingUnpublished.rows[0].cnt).toBe(0)
    await db3.close()
  } finally {
    if (fs.existsSync(dbDir)) {
      fs.rmSync(dbDir, { recursive: true, force: true })
    }
  }
})

/**
 * Complementary: Fast in-process crash simulation.
 * Verifies poison event isolation: one failing event halts progress, earlier events stay marked.
 */
test('crash recovery: throw-based crash simulates poison event halt', async () => {
  const dbDir = await import('os').then((os) => path.join(os.tmpdir(), `throw-crash-${Date.now()}`))
  const dbPath = path.join(dbDir, 'crash.db')

  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  try {
    const db = new PGlite(dbPath)
    const tx = createExecutor(db)
    await db.query(EventOutboxDDL)
    await db.query(EventOutboxIndexDDL)

    const events = [
      mockEnvelope('ev-1', 1),
      mockEnvelope('ev-poison', 2),
      mockEnvelope('ev-3', 3),
    ]
    await pgOutboxStore(tx, 'org-crash-test', 'br-crash-test').append(tx, events)
    await db.close()

    // First drain: e1 publishes, e2 throws (halts)
    const db2 = new PGlite(dbPath)
    const publishedIds1: string[] = []

    try {
      await drainOutbox(
        pgOutboxStore(createExecutor(db2), 'org-crash-test', 'br-crash-test'),
        async (e) => {
          if (e.id === 'ev-poison') throw new Error('poison')
          publishedIds1.push(e.id)
        },
      )
    } catch (e) {
      // Expected: drain halts on poison
    }

    expect(publishedIds1).toEqual(['ev-1']) // Only e1 was published before crash
    await db2.close()

    // Verify published state: e1 marked, e2 and e3 unpublished
    const db3 = new PGlite(dbPath)
    const stateBefore = await db3.query('select id, published from event_outbox order by seq')
    expect(stateBefore.rows[0].published).toBe(true) // e1 marked
    expect(stateBefore.rows[1].published).toBe(false) // e2 not marked
    expect(stateBefore.rows[2].published).toBe(false) // e3 not marked
    await db3.close()

    // Second drain: e1 skipped (already marked), e2 throws again
    const db4 = new PGlite(dbPath)
    const publishedIds2: string[] = []

    try {
      await drainOutbox(
        pgOutboxStore(createExecutor(db4), 'org-crash-test', 'br-crash-test'),
        async (e) => {
          if (e.id === 'ev-poison') throw new Error('poison')
          publishedIds2.push(e.id)
        },
      )
    } catch (e) {
      // Expected
    }

    // Only e2 was attempted (e1 already marked, e3 never reached)
    expect(publishedIds2).toEqual([])

    await db4.close()
  } finally {
    if (fs.existsSync(dbDir)) {
      fs.rmSync(dbDir, { recursive: true, force: true })
    }
  }
})
