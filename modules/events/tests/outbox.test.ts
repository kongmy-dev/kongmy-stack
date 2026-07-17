// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect, beforeEach, afterEach } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { appendEvent, drainOutbox, EventOutboxDDL, EventOutboxIndexDDL, type RawExecutor } from '../src/outbox'
import type { EventEnvelope } from '../src/envelope'

// Adapter: wrap PGlite as RawExecutor
function createExecutor(db: PGlite): RawExecutor {
  return {
    query: async (sql: string, params: unknown[]) => {
      const rawResult = await db.query(sql, params as string[])
      return { rows: rawResult.rows as Record<string, unknown>[] }
    },
  }
}

// Each PGlite instance holds a WASM heap that is only returned on close(). Open one per test and
// close it in afterEach — an unclosed handle survives the test and the file exits non-zero even
// when every test passes.
let db: PGlite
let tx: RawExecutor

beforeEach(async () => {
  db = new PGlite()
  tx = createExecutor(db)
  await db.query(EventOutboxDDL)
  await db.query(EventOutboxIndexDDL)
})

afterEach(async () => {
  await db.close()
})

function mockEnvelope(id: string, type: string, seq: number, payload: unknown = {}): EventEnvelope {
  return {
    id,
    type,
    version: 1,
    orgId: 'org-test',
    branchId: 'br-test',
    seq,
    hlc: `000000${seq}:0000`,
    actor: { id: 'sys', type: 'system', model: null },
    causationId: null,
    correlationId: `trace-${id}`,
    payload,
    createdAt: new Date().toISOString(),
  }
}

test('appendEvent inserts events into the outbox', async () => {
  const events = [
    mockEnvelope('ev-1', 'test.event', 1, { x: 1 }),
    mockEnvelope('ev-2', 'test.event', 2, { x: 2 }),
  ]
  await appendEvent(tx, events)

  const rawResult = await db.query('select * from event_outbox order by seq')
  expect(rawResult.rows).toHaveLength(2)
  expect(rawResult.rows[0].id).toBe('ev-1')
  expect(rawResult.rows[1].id).toBe('ev-2')
})

test('appendEvent sets published to false', async () => {
  const events = [mockEnvelope('ev-1', 'test.event', 1)]
  await appendEvent(tx, events)

  const rawResult = await db.query('select published from event_outbox where id = $1', ['ev-1'])
  expect(rawResult.rows[0].published).toBe(false)
})

test('drainOutbox publishes unpublished events and marks them', async () => {
  const events = [
    mockEnvelope('ev-1', 'test.event', 1, { data: 'a' }),
    mockEnvelope('ev-2', 'test.event', 2, { data: 'b' }),
  ]
  await appendEvent(tx, events)

  const published: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-test', 'br-test')

  expect(count).toBe(2)
  expect(published).toHaveLength(2)
  expect(published[0].id).toBe('ev-1')
  expect(published[1].id).toBe('ev-2')

  // Verify marked as published
  const rawResult = await db.query('select published from event_outbox where id = $1', ['ev-1'])
  expect(rawResult.rows[0].published).toBe(true)
})

test('drainOutbox returns 0 if no unpublished events', async () => {
  const published: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-test', 'br-test')

  expect(count).toBe(0)
  expect(published).toHaveLength(0)
})

test('drainOutbox does not re-publish already published events', async () => {
  const e = mockEnvelope('ev-1', 'test.event', 1)
  await appendEvent(tx, [e])

  const published1: EventEnvelope[] = []
  await drainOutbox(createExecutor(db), async (e) => published1.push(e), 'org-test', 'br-test')

  const published2: EventEnvelope[] = []
  await drainOutbox(createExecutor(db), async (e) => published2.push(e), 'org-test', 'br-test')

  expect(published1).toHaveLength(1)
  expect(published2).toHaveLength(0) // already published
})

test('drainOutbox handles idempotent consumers via re-delivery on crash', async () => {
  const e = mockEnvelope('ev-crash', 'test.event', 1, { willCrash: true })
  await appendEvent(tx, [e])

  let attemptCount = 0
  const publish = async (env: EventEnvelope) => {
    attemptCount++
    if (attemptCount === 1) {
      // Simulate crash: throw before we mark as published
      throw new Error('simulated crash')
    }
    // On retry, we'd get here
  }

  // First call crashes during publish
  try {
    await drainOutbox(createExecutor(db), publish, 'org-test', 'br-test')
  } catch (e) {
    // Expected: crash during publish
  }

  // Event should still be unpublished (crash happened before mark)
  const rawNotPublished = await db.query('select * from event_outbox where published = false')
  expect(rawNotPublished.rows).toHaveLength(1)

  // Retry: now it succeeds
  const published: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-test', 'br-test')

  expect(count).toBe(1)
  expect(published[0].id).toBe('ev-crash')
})

test('drainOutbox filters by orgId and branchId', async () => {
  // Events from different orgs/branches
  const e1 = mockEnvelope('ev-1', 'test', 1)
  e1.orgId = 'org-a'
  e1.branchId = 'br-a'

  const e2 = mockEnvelope('ev-2', 'test', 2)
  e2.orgId = 'org-b'
  e2.branchId = 'br-b'

  await appendEvent(tx, [e1, e2])

  // Drain only org-a/br-a
  const published: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-a', 'br-a')

  expect(count).toBe(1)
  expect(published[0].id).toBe('ev-1')

  // Verify org-b still has unpublished
  const rawRemaining = await db.query('select * from event_outbox where published = false and org_id = $1', ['org-b'])
  expect(rawRemaining.rows).toHaveLength(1)
})

test('appendEvent with empty array does nothing', async () => {
  await appendEvent(tx, [])

  const rawResult = await db.query('select count(*) as cnt from event_outbox')
  expect(rawResult.rows[0].cnt).toBe(0)
})

test('drainOutbox publishes events in seq order', async () => {
  // Insert in random order
  const e3 = mockEnvelope('ev-3', 'test', 3)
  const e1 = mockEnvelope('ev-1', 'test', 1)
  const e2 = mockEnvelope('ev-2', 'test', 2)

  await appendEvent(tx, [e3, e1, e2])

  const published: EventEnvelope[] = []
  await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-test', 'br-test')

  // Should be in seq order
  expect(published[0].seq).toBe(1)
  expect(published[1].seq).toBe(2)
  expect(published[2].seq).toBe(3)
})

test('payload round-trip: JSON.parse restores nested objects', async () => {
  const complexPayload = {
    amount: 15000,
    nested: {
      ok: true,
      items: [1, 2, 3],
    },
    metadata: { key: 'value' },
  }

  const e = mockEnvelope('ev-complex', 'test.event', 1, complexPayload)
  await appendEvent(tx, [e])

  const published: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-test', 'br-test')

  expect(count).toBe(1)
  expect(published[0].payload).toEqual(complexPayload)
  expect(typeof published[0].payload).toBe('object')
  expect((published[0].payload as Record<string, unknown>).nested).toEqual({ ok: true, items: [1, 2, 3] })
})

test('concurrent drainers deliver each event exactly once (no N² fan-out)', async () => {
  const events = Array.from({ length: 8 }, (_, i) => mockEnvelope(`ev-${i + 1}`, 'sale.completed', i + 1))
  await appendEvent(tx, events)

  // 8 drainers racing, as 8 tills transacting at once would produce if each request drains.
  // Each publish yields, which is the window a select-then-claim drain hands to the others.
  const delivered: string[] = []
  const counts = await Promise.all(
    Array.from({ length: 8 }, () =>
      drainOutbox(
        createExecutor(db),
        async (e) => {
          await new Promise((r) => setTimeout(r, 1))
          delivered.push(e.id)
        },
        'org-test',
        'br-test',
      ),
    ),
  )

  // The pre-lease drain delivered all 8 events to all 8 drainers: 64 deliveries, 8 per event.
  expect(delivered).toHaveLength(8)
  expect(new Set(delivered).size).toBe(8)
  for (const e of events) {
    expect(delivered.filter((id) => id === e.id)).toHaveLength(1)
  }

  // Exactly one drainer claims the batch; the losers claim nothing rather than redelivering it.
  expect(counts.reduce((a, b) => a + b, 0)).toBe(8)

  const remaining = await db.query('select count(*) as cnt from event_outbox where published = false')
  expect(remaining.rows[0].cnt).toBe(0)
})

test('expired lease is reclaimed: a drainer that dies mid-drain does not strand its batch', async () => {
  await appendEvent(tx, [mockEnvelope('ev-1', 'test.event', 1)])

  // Simulate a drainer killed between claim and mark: a live claim it will never release.
  await db.query(
    `update event_outbox set claimed_by = 'dead-drainer', lease_expires_at = $1 where id = 'ev-1'`,
    [new Date(Date.now() + 60_000).toISOString()],
  )

  // A live lease blocks reclaim, whatever leaseMs the reclaimer itself uses.
  const blocked: EventEnvelope[] = []
  const none = await drainOutbox(createExecutor(db), async (e) => blocked.push(e), 'org-test', 'br-test', {
    leaseMs: 1,
  })
  expect(none).toBe(0)
  expect(blocked).toHaveLength(0)

  // Once it expires the event redelivers — this is what keeps delivery at-least-once through a crash.
  await db.query(`update event_outbox set lease_expires_at = $1 where id = 'ev-1'`, [
    new Date(Date.now() - 1_000).toISOString(),
  ])
  const recovered: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => recovered.push(e), 'org-test', 'br-test')
  expect(count).toBe(1)
  expect(recovered[0].id).toBe('ev-1')
})

test('poison event releases the claim on its batch: next drain retries without waiting out the lease', async () => {
  await appendEvent(tx, [
    mockEnvelope('ev-1', 'test.event', 1),
    mockEnvelope('ev-poison', 'test.event', 2),
    mockEnvelope('ev-3', 'test.event', 3),
  ])

  const publish = async (e: EventEnvelope) => {
    if (e.id === 'ev-poison') throw new Error('poison event')
  }

  // Long lease: if the poison path leaked its claim, the retry below would find nothing to do.
  try {
    await drainOutbox(createExecutor(db), publish, 'org-test', 'br-test', { leaseMs: 600_000 })
  } catch {
    // Expected: drain halts on the poison event
  }

  const claims = await db.query(
    'select id, lease_expires_at from event_outbox where published = false order by seq',
  )
  expect(claims.rows).toHaveLength(2)
  expect(claims.rows[0].lease_expires_at).toBeNull() // ev-poison released
  expect(claims.rows[1].lease_expires_at).toBeNull() // ev-3 released

  // Retry immediately: ev-poison is attempted again, still within the original 10-minute lease.
  let attempted = 0
  try {
    await drainOutbox(createExecutor(db), async (e) => { attempted++; await publish(e) }, 'org-test', 'br-test', {
      leaseMs: 600_000,
    })
  } catch {
    // Expected
  }
  expect(attempted).toBe(1) // ev-poison only: ev-1 stays marked, ev-3 is never reached
})

test('a drainer whose lease expired does not release its successor\'s claim', async () => {
  await appendEvent(tx, [
    mockEnvelope('ev-1', 'test.event', 1),
    mockEnvelope('ev-2', 'test.event', 2),
  ])

  // Drainer A claims with a lease so short it expires while A is still publishing ev-1, then
  // fails on ev-2 — driving A into its release path after it has already lost the batch.
  const drainA = drainOutbox(
    createExecutor(db),
    async (e) => {
      if (e.id === 'ev-1') await new Promise((r) => setTimeout(r, 150))
      if (e.id === 'ev-2') throw new Error('publish failed')
    },
    'org-test',
    'br-test',
    { leaseMs: 50, drainerId: 'drainer-a' },
  )

  // Drainer B legitimately reclaims the expired batch and takes a long lease on it.
  await new Promise((r) => setTimeout(r, 80))
  await db.query(
    `update event_outbox set claimed_by = 'drainer-b', lease_expires_at = $1 where published = false`,
    [new Date(Date.now() + 600_000).toISOString()],
  )

  await drainA.catch(() => {}) // A fails on ev-2 and runs its release

  // A's release must not have freed B's claim: if it did, a third drainer would now double-deliver
  // the events B still has in flight.
  const rows = await db.query(
    'select claimed_by, lease_expires_at from event_outbox where published = false',
  )
  expect(rows.rows).toHaveLength(1)
  expect(rows.rows[0].claimed_by).toBe('drainer-b')
  expect(rows.rows[0].lease_expires_at).not.toBeNull()

  const stolen: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => stolen.push(e), 'org-test', 'br-test')
  expect(count).toBe(0)
  expect(stolen).toHaveLength(0)
})

test('poison event isolation: failing event halts drain, earlier events stay marked', async () => {
  const e1 = mockEnvelope('ev-1', 'test.event', 1)
  const e2 = mockEnvelope('ev-poison', 'test.event', 2) // Will fail
  const e3 = mockEnvelope('ev-3', 'test.event', 3)

  await appendEvent(tx, [e1, e2, e3])

  let publishAttempt = 0
  const publish = async (env: EventEnvelope) => {
    publishAttempt++
    if (env.id === 'ev-poison') {
      throw new Error('poison event')
    }
  }

  // First drain: e1 publishes and marks, e2 fails (halts)
  try {
    await drainOutbox(createExecutor(db), publish, 'org-test', 'br-test')
  } catch (e) {
    // Expected: drain halts on poison event
    expect(String(e)).toContain('poison event')
  }

  expect(publishAttempt).toBe(2) // e1 and e2 were attempted

  // Verify e1 is marked (won't redeliver), e2 and e3 stay unpublished
  const rawResult = await db.query('select id, published from event_outbox order by seq')
  expect(rawResult.rows).toHaveLength(3)
  expect(rawResult.rows[0].published).toBe(true) // e1 marked
  expect(rawResult.rows[1].published).toBe(false) // e2 still unpublished
  expect(rawResult.rows[2].published).toBe(false) // e3 still unpublished

  // Second drain: e1 won't be re-published (already marked), e2 fails again
  let publishAttempt2 = 0
  try {
    await drainOutbox(createExecutor(db), async (env) => {
      publishAttempt2++
      if (env.id === 'ev-poison') throw new Error('poison event')
    }, 'org-test', 'br-test')
  } catch (e) {
    // Expected
  }

  // Only e2 was attempted (e1 is marked, e3 after poison never reached)
  expect(publishAttempt2).toBe(1)
})
