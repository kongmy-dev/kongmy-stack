// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drainOutbox, type ClaimTicket, type OutboxStore, type RawExecutor } from '../src/outbox'
import {
  EventOutboxDDL,
  EventOutboxIndexDDL,
  JournalDDL,
  JournalIndexDDL,
  journalStore,
  pgOutboxStore,
} from '../src/stores'
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

/**
 * Every semantic below is asserted against both shipped stores. They share the claim SQL, so this
 * is not proof that a foreign store works — that is what the in-memory lane at the bottom is for —
 * but it is what stops the two shapes from drifting apart.
 */
const LANES = [
  {
    name: 'pgOutboxStore (event_outbox, payload text)',
    table: 'event_outbox',
    ddl: [EventOutboxDDL, EventOutboxIndexDDL],
    store: pgOutboxStore,
  },
  {
    name: 'journalStore (event_log, payload jsonb)',
    table: 'event_log',
    ddl: [JournalDDL, ...JournalIndexDDL],
    store: journalStore,
  },
] as const

for (const lane of LANES) {
  describe(lane.name, () => {
    // Each PGlite instance holds a WASM heap that is only returned on close(). Open one per test
    // and close it in afterEach — an unclosed handle survives the test and the file exits non-zero
    // even when every test passes.
    let db: PGlite
    let tx: RawExecutor
    let store: OutboxStore

    beforeEach(async () => {
      db = new PGlite()
      tx = createExecutor(db)
      for (const stmt of lane.ddl) await db.query(stmt)
      store = lane.store(tx, 'org-test', 'br-test')
    })

    afterEach(async () => {
      await db.close()
    })

    test('append inserts events into the table', async () => {
      await store.append(tx, [
        mockEnvelope('ev-1', 'test.event', 1, { x: 1 }),
        mockEnvelope('ev-2', 'test.event', 2, { x: 2 }),
      ])

      const rawResult = await db.query(`select * from ${lane.table} order by seq`)
      expect(rawResult.rows).toHaveLength(2)
      expect((rawResult.rows[0] as Record<string, unknown>).id).toBe('ev-1')
      expect((rawResult.rows[1] as Record<string, unknown>).id).toBe('ev-2')
    })

    test('append sets published to false', async () => {
      await store.append(tx, [mockEnvelope('ev-1', 'test.event', 1)])

      const rawResult = await db.query(`select published from ${lane.table} where id = $1`, ['ev-1'])
      expect((rawResult.rows[0] as Record<string, unknown>).published).toBe(false)
    })

    test('append with empty array does nothing', async () => {
      await store.append(tx, [])

      const rawResult = await db.query(`select count(*) as cnt from ${lane.table}`)
      expect((rawResult.rows[0] as Record<string, unknown>).cnt).toBe(0)
    })

    test('drainOutbox publishes unpublished events and marks them', async () => {
      await store.append(tx, [
        mockEnvelope('ev-1', 'test.event', 1, { data: 'a' }),
        mockEnvelope('ev-2', 'test.event', 2, { data: 'b' }),
      ])

      const published: EventEnvelope[] = []
      const count = await drainOutbox(store, async (e) => {
        published.push(e)
      })

      expect(count).toBe(2)
      expect(published).toHaveLength(2)
      expect(published[0]!.id).toBe('ev-1')
      expect(published[1]!.id).toBe('ev-2')

      const rawResult = await db.query(`select published from ${lane.table} where id = $1`, ['ev-1'])
      expect((rawResult.rows[0] as Record<string, unknown>).published).toBe(true)
    })

    test('drainOutbox returns 0 if no unpublished events', async () => {
      const published: EventEnvelope[] = []
      const count = await drainOutbox(store, async (e) => {
        published.push(e)
      })

      expect(count).toBe(0)
      expect(published).toHaveLength(0)
    })

    test('drainOutbox does not re-publish already published events', async () => {
      await store.append(tx, [mockEnvelope('ev-1', 'test.event', 1)])

      const published1: EventEnvelope[] = []
      await drainOutbox(store, async (e) => {
        published1.push(e)
      })

      const published2: EventEnvelope[] = []
      await drainOutbox(store, async (e) => {
        published2.push(e)
      })

      expect(published1).toHaveLength(1)
      expect(published2).toHaveLength(0) // already published
    })

    test('drainOutbox re-delivers on crash: publish threw before the mark landed', async () => {
      await store.append(tx, [mockEnvelope('ev-crash', 'test.event', 1, { willCrash: true })])

      let attemptCount = 0
      const publish = async () => {
        attemptCount++
        if (attemptCount === 1) throw new Error('simulated crash')
      }

      try {
        await drainOutbox(store, publish)
      } catch {
        // Expected: crash during publish
      }

      const rawNotPublished = await db.query(`select * from ${lane.table} where published = false`)
      expect(rawNotPublished.rows).toHaveLength(1)

      const published: EventEnvelope[] = []
      const count = await drainOutbox(store, async (e) => {
        published.push(e)
      })

      expect(count).toBe(1)
      expect(published[0]!.id).toBe('ev-crash')
    })

    test('the store scopes by orgId and branchId', async () => {
      const e1 = mockEnvelope('ev-1', 'test', 1)
      e1.orgId = 'org-a'
      e1.branchId = 'br-a'

      const e2 = mockEnvelope('ev-2', 'test', 2)
      e2.orgId = 'org-b'
      e2.branchId = 'br-b'

      await store.append(tx, [e1, e2])

      const published: EventEnvelope[] = []
      const count = await drainOutbox(lane.store(tx, 'org-a', 'br-a'), async (e) => {
        published.push(e)
      })

      expect(count).toBe(1)
      expect(published[0]!.id).toBe('ev-1')

      const rawRemaining = await db.query(
        `select * from ${lane.table} where published = false and org_id = $1`,
        ['org-b'],
      )
      expect(rawRemaining.rows).toHaveLength(1)
    })

    test('drainOutbox publishes events in seq order', async () => {
      // Insert in random order
      await store.append(tx, [
        mockEnvelope('ev-3', 'test', 3),
        mockEnvelope('ev-1', 'test', 1),
        mockEnvelope('ev-2', 'test', 2),
      ])

      const published: EventEnvelope[] = []
      await drainOutbox(store, async (e) => {
        published.push(e)
      })

      expect(published[0]!.seq).toBe(1)
      expect(published[1]!.seq).toBe(2)
      expect(published[2]!.seq).toBe(3)
    })

    test('payload round-trip restores nested objects', async () => {
      const complexPayload = {
        amount: 15000,
        nested: { ok: true, items: [1, 2, 3] },
        metadata: { key: 'value' },
      }

      await store.append(tx, [mockEnvelope('ev-complex', 'test.event', 1, complexPayload)])

      const published: EventEnvelope[] = []
      const count = await drainOutbox(store, async (e) => {
        published.push(e)
      })

      expect(count).toBe(1)
      expect(published[0]!.payload).toEqual(complexPayload)
      expect(typeof published[0]!.payload).toBe('object')
      expect((published[0]!.payload as Record<string, unknown>).nested).toEqual({
        ok: true,
        items: [1, 2, 3],
      })
    })

    test('concurrent drainers deliver each event exactly once (no N² fan-out)', async () => {
      const events = Array.from({ length: 8 }, (_, i) =>
        mockEnvelope(`ev-${i + 1}`, 'sale.completed', i + 1),
      )
      await store.append(tx, events)

      // 8 drainers racing, as 8 tills transacting at once would produce if each request drains.
      // Each publish yields, which is the window a select-then-claim drain hands to the others.
      const delivered: string[] = []
      const counts = await Promise.all(
        Array.from({ length: 8 }, () =>
          drainOutbox(store, async (e) => {
            await new Promise((r) => setTimeout(r, 1))
            delivered.push(e.id)
          }),
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

      const remaining = await db.query(
        `select count(*) as cnt from ${lane.table} where published = false`,
      )
      expect((remaining.rows[0] as Record<string, unknown>).cnt).toBe(0)
    })

    test('expired lease is reclaimed: a drainer that dies mid-drain does not strand its batch', async () => {
      await store.append(tx, [mockEnvelope('ev-1', 'test.event', 1)])

      // Simulate a drainer killed between claim and mark: a live claim it will never release.
      await db.query(
        `update ${lane.table} set claimed_by = 'dead-drainer', lease_expires_at = $1 where id = 'ev-1'`,
        [new Date(Date.now() + 60_000).toISOString()],
      )

      // A live lease blocks reclaim, whatever leaseMs the reclaimer itself uses.
      const blocked: EventEnvelope[] = []
      const none = await drainOutbox(
        store,
        async (e) => {
          blocked.push(e)
        },
        { leaseMs: 1 },
      )
      expect(none).toBe(0)
      expect(blocked).toHaveLength(0)

      // Once it expires the event redelivers — this keeps delivery at-least-once through a crash.
      await db.query(`update ${lane.table} set lease_expires_at = $1 where id = 'ev-1'`, [
        new Date(Date.now() - 1_000).toISOString(),
      ])
      const recovered: EventEnvelope[] = []
      const count = await drainOutbox(store, async (e) => {
        recovered.push(e)
      })
      expect(count).toBe(1)
      expect(recovered[0]!.id).toBe('ev-1')
    })

    test('poison event releases the claim on its batch: next drain retries without waiting out the lease', async () => {
      await store.append(tx, [
        mockEnvelope('ev-1', 'test.event', 1),
        mockEnvelope('ev-poison', 'test.event', 2),
        mockEnvelope('ev-3', 'test.event', 3),
      ])

      const publish = async (e: EventEnvelope) => {
        if (e.id === 'ev-poison') throw new Error('poison event')
      }

      // Long lease: if the poison path leaked its claim, the retry below would find nothing to do.
      try {
        await drainOutbox(store, publish, { leaseMs: 600_000 })
      } catch {
        // Expected: drain halts on the poison event
      }

      const claims = await db.query(
        `select id, lease_expires_at from ${lane.table} where published = false order by seq`,
      )
      expect(claims.rows).toHaveLength(2)
      expect((claims.rows[0] as Record<string, unknown>).lease_expires_at).toBeNull() // ev-poison released
      expect((claims.rows[1] as Record<string, unknown>).lease_expires_at).toBeNull() // ev-3 released

      // Retry immediately: ev-poison is attempted again, still within the original 10-minute lease.
      let attempted = 0
      try {
        await drainOutbox(
          store,
          async (e) => {
            attempted++
            await publish(e)
          },
          { leaseMs: 600_000 },
        )
      } catch {
        // Expected
      }
      expect(attempted).toBe(1) // ev-poison only: ev-1 stays marked, ev-3 is never reached
    })

    test("a drainer whose lease expired does not release its successor's claim", async () => {
      await store.append(tx, [
        mockEnvelope('ev-1', 'test.event', 1),
        mockEnvelope('ev-2', 'test.event', 2),
      ])

      // Drainer A claims with a lease so short it expires while A is still publishing ev-1, then
      // fails on ev-2 — driving A into its release path after it has already lost the batch.
      const drainA = drainOutbox(
        store,
        async (e) => {
          if (e.id === 'ev-1') await new Promise((r) => setTimeout(r, 150))
          if (e.id === 'ev-2') throw new Error('publish failed')
        },
        { leaseMs: 50, drainerId: 'drainer-a' },
      )

      // Drainer B legitimately reclaims the expired batch and takes a long lease on it.
      await new Promise((r) => setTimeout(r, 80))
      await db.query(
        `update ${lane.table} set claimed_by = 'drainer-b', lease_expires_at = $1 where published = false`,
        [new Date(Date.now() + 600_000).toISOString()],
      )

      await drainA.catch(() => {}) // A fails on ev-2 and runs its release

      // A's release must not have freed B's claim: if it did, a third drainer would now
      // double-deliver the events B still has in flight.
      const rows = await db.query(
        `select claimed_by, lease_expires_at from ${lane.table} where published = false`,
      )
      expect(rows.rows).toHaveLength(1)
      expect((rows.rows[0] as Record<string, unknown>).claimed_by).toBe('drainer-b')
      expect((rows.rows[0] as Record<string, unknown>).lease_expires_at).not.toBeNull()

      const stolen: EventEnvelope[] = []
      const count = await drainOutbox(store, async (e) => {
        stolen.push(e)
      })
      expect(count).toBe(0)
      expect(stolen).toHaveLength(0)
    })

    test('poison event isolation: failing event halts drain, earlier events stay marked', async () => {
      await store.append(tx, [
        mockEnvelope('ev-1', 'test.event', 1),
        mockEnvelope('ev-poison', 'test.event', 2),
        mockEnvelope('ev-3', 'test.event', 3),
      ])

      let publishAttempt = 0
      const publish = async (env: EventEnvelope) => {
        publishAttempt++
        if (env.id === 'ev-poison') throw new Error('poison event')
      }

      // First drain: e1 publishes and marks, poison fails (halts)
      try {
        await drainOutbox(store, publish)
      } catch (e) {
        expect(String(e)).toContain('poison event')
      }

      expect(publishAttempt).toBe(2) // ev-1 and ev-poison were attempted

      const rawResult = await db.query(`select id, published from ${lane.table} order by seq`)
      expect(rawResult.rows).toHaveLength(3)
      expect((rawResult.rows[0] as Record<string, unknown>).published).toBe(true) // ev-1 marked
      expect((rawResult.rows[1] as Record<string, unknown>).published).toBe(false) // poison unpublished
      expect((rawResult.rows[2] as Record<string, unknown>).published).toBe(false) // ev-3 unpublished

      // Second drain: ev-1 won't be re-published (already marked), poison fails again
      let publishAttempt2 = 0
      try {
        await drainOutbox(store, async (env) => {
          publishAttempt2++
          if (env.id === 'ev-poison') throw new Error('poison event')
        })
      } catch {
        // Expected
      }

      // Only poison was attempted (ev-1 is marked, ev-3 after poison never reached)
      expect(publishAttempt2).toBe(1)
    })
  })
}

describe('the OutboxStore seam', () => {
  /**
   * A store with no SQL in it, written only from the invariants documented on OutboxStore. It is
   * what a consumer whose events live behind RLS, or in Drizzle, or in another process would write.
   *
   * Its claim is atomic for free — JS runs it to completion between awaits — so this lane does NOT
   * prove the concurrency semantics the way the SQL lanes do. What it proves is that the drain
   * carries no hidden dependency on a database, i.e. that the seam is real.
   */
  function memoryStore(): OutboxStore & { rows: Map<string, Row> } {
    interface Row {
      env: EventEnvelope
      published: boolean
      claimedBy: string | null
      leaseExpiresAt: string | null
    }
    const rows = new Map<string, Row>()
    return {
      rows,
      async append(_tx, events) {
        for (const env of events) {
          rows.set(env.id, { env, published: false, claimedBy: null, leaseExpiresAt: null })
        }
      },
      async claimBatch(ticket: ClaimTicket) {
        const claimed: EventEnvelope[] = []
        for (const row of rows.values()) {
          if (row.published) continue
          if (row.leaseExpiresAt !== null && row.leaseExpiresAt >= ticket.now) continue
          row.claimedBy = ticket.drainerId
          row.leaseExpiresAt = ticket.leaseExpiresAt
          claimed.push(row.env)
        }
        return claimed
      },
      async markPublished(id) {
        const row = rows.get(id)
        if (row) row.published = true
      },
      async releaseClaim(ticket) {
        for (const row of rows.values()) {
          if (
            !row.published &&
            row.claimedBy === ticket.drainerId &&
            row.leaseExpiresAt === ticket.leaseExpiresAt
          ) {
            row.claimedBy = null
            row.leaseExpiresAt = null
          }
        }
      },
    }
  }

  test('the drain works against a store with no database behind it', async () => {
    const store = memoryStore()
    await store.append(store, [
      mockEnvelope('ev-2', 'test', 2),
      mockEnvelope('ev-1', 'test', 1),
    ])

    const published: EventEnvelope[] = []
    const count = await drainOutbox(store, async (e) => {
      published.push(e)
    })

    expect(count).toBe(2)
    expect(published.map((e) => e.id)).toEqual(['ev-1', 'ev-2']) // drain sorted, store did not
    expect([...store.rows.values()].every((r) => r.published)).toBe(true)
  })

  test('poison isolation and claim release hold for a foreign store too', async () => {
    const store = memoryStore()
    await store.append(store, [
      mockEnvelope('ev-1', 'test', 1),
      mockEnvelope('ev-poison', 'test', 2),
      mockEnvelope('ev-3', 'test', 3),
    ])

    try {
      await drainOutbox(
        store,
        async (e) => {
          if (e.id === 'ev-poison') throw new Error('poison event')
        },
        { leaseMs: 600_000 },
      )
    } catch {
      // Expected
    }

    expect(store.rows.get('ev-1')!.published).toBe(true) // marked, won't redeliver
    expect(store.rows.get('ev-poison')!.published).toBe(false)
    expect(store.rows.get('ev-3')!.published).toBe(false)
    // Released rather than left leased, so the next drain retries immediately.
    expect(store.rows.get('ev-poison')!.leaseExpiresAt).toBeNull()
    expect(store.rows.get('ev-3')!.leaseExpiresAt).toBeNull()
  })
})
