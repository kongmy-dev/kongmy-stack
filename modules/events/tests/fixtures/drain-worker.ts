/**
 * Drain worker script for crash recovery testing.
 * Invoked by Bun.spawn with arguments: dbPath deliveryLogFile maxEventCount [leaseMs]
 * Publishes events and appends delivery IDs to a file, so we can verify
 * which events survived a SIGKILL.
 *
 * leaseMs is short here so the test can wait out this worker's claim after SIGKILL without
 * sleeping for the 30s default — a killed drainer never releases its own lease.
 */

import { PGlite } from '@electric-sql/pglite'
import { drainOutbox, type RawExecutor } from '../../src/outbox'
import fs from 'fs/promises'

const dbPath = process.argv[2]
const deliveryLogFile = process.argv[3]
const maxEventCount = parseInt(process.argv[4], 10)
const leaseMs = process.argv[5] ? parseInt(process.argv[5], 10) : undefined

function createExecutor(db: PGlite): RawExecutor {
  return {
    query: async (sql: string, params: unknown[]) => {
      const rawResult = await db.query(sql, params as string[])
      return { rows: rawResult.rows as Record<string, unknown>[] }
    },
  }
}

const db = new PGlite(dbPath)

let eventCount = 0
const publish = async (e: any) => {
  eventCount++
  // Append event ID to delivery log (simulating a consumer)
  const line = `${e.id}\n`
  await fs.appendFile(deliveryLogFile, line, { flag: 'a' })
  // Sleep briefly to give SIGKILL time to hit mid-drain
  await new Promise((r) => setTimeout(r, 50))
  // If we've hit maxEventCount, simulate the crash by not returning
  // (in real scenario, SIGKILL will hit regardless)
  if (eventCount >= maxEventCount) {
    // Force a long pause — the test will SIGKILL us during this
    await new Promise(() => {}) // Never resolves
  }
}

drainOutbox(createExecutor(db), publish, 'org-crash-test', 'br-crash-test', { leaseMs })
  .then(() => {
    db.close()
    process.exit(0)
  })
  .catch((err) => {
    console.error('Drain error:', err)
    db.close()
    process.exit(1)
  })
