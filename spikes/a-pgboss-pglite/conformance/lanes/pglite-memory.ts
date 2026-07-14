/**
 * Lane: PGlite in-memory
 *
 * This lane runs pg-boss against an in-memory PGlite instance.
 * No data persists across process death.
 */

import { PGlite } from "@electric-sql/pglite";
import { PgBoss, fromPglite } from "pg-boss";
import type { QueueLane } from "../suite.ts";

export async function createPGliteMemoryLane(): Promise<QueueLane> {
  console.log("Initializing PGlite in-memory lane...");

  // Create in-memory PGlite instance
  const pglite = new PGlite();
  console.log("✓ PGlite initialized (in-memory)");

  // Wrap with pg-boss adapter
  const db = await fromPglite(pglite);
  console.log("✓ pg-boss adapter configured");

  // Initialize pg-boss
  const boss = new PgBoss({
    db,
    newJobCheckInterval: 100, // Poll every 100ms (PGlite has no LISTEN/NOTIFY)
  });

  await boss.start();
  console.log("✓ pg-boss started\n");

  return {
    name: "pglite-memory",
    boss,
    cleanup: async () => {
      console.log("Cleaning up pglite-memory lane...");
      await boss.stop();
      // pglite in-memory data is lost on stop (by design)
    },
  };
}
