import { test, expect } from 'bun:test'
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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

  const events = [mockEnvelope('ev-1', 'test.event', 1)]
  await appendEvent(tx, events)

  const rawResult = await db.query('select published from event_outbox where id = $1', ['ev-1'])
  expect(rawResult.rows[0].published).toBe(false)
})

test('drainOutbox publishes unpublished events and marks them', async () => {
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

  const published: EventEnvelope[] = []
  const count = await drainOutbox(createExecutor(db), async (e) => published.push(e), 'org-test', 'br-test')

  expect(count).toBe(0)
  expect(published).toHaveLength(0)
})

test('drainOutbox does not re-publish already published events', async () => {
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

  await appendEvent(tx, [])

  const rawResult = await db.query('select count(*) as cnt from event_outbox')
  expect(rawResult.rows[0].cnt).toBe(0)
})

test('drainOutbox publishes events in seq order', async () => {
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL); await db.query(EventOutboxIndexDDL)

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
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL)
  await db.query(EventOutboxIndexDDL)

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

test('poison event isolation: failing event halts drain, earlier events stay marked', async () => {
  const db = new PGlite()
  const tx = createExecutor(db)

  await db.query(EventOutboxDDL)
  await db.query(EventOutboxIndexDDL)

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
