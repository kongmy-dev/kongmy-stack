/**
 * Lane: PGlite file-backed
 *
 * This lane runs pg-boss against a file-backed PGlite instance.
 * Data persists across process death (tested by restart scripts).
 */

import { PGlite } from "@electric-sql/pglite";
import { PgBoss, fromPglite } from "pg-boss";
import * as fs from "fs";
import * as path from "path";
import type { QueueLane } from "../suite.ts";

const DB_DIR = ".conformance-test-data";

export async function createPGliteFileLane(): Promise<QueueLane> {
  console.log("Initializing PGlite file-backed lane...");

  // Create data directory if needed
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log(`✓ Created data directory: ${DB_DIR}`);
  }

  // Create file-backed PGlite instance
  // PGlite expects a directory path (without 'file:' prefix for local storage)
  const pglite = new PGlite(DB_DIR);
  console.log(`✓ PGlite initialized (file-backed at ${DB_DIR})`);

  // Wrap with pg-boss adapter
  const db = await fromPglite(pglite);
  console.log("✓ pg-boss adapter configured");

  // Initialize pg-boss
  const boss = new PgBoss({
    db,
    newJobCheckInterval: 100,
  });

  await boss.start();
  console.log("✓ pg-boss started\n");

  return {
    name: "pglite-file",
    boss,
    backingFile: DB_DIR,
    cleanup: async () => {
      console.log("Cleaning up pglite-file lane...");
      await boss.stop();
      console.log(`File-backed storage preserved at: ${DB_DIR}`);
    },
  };
}

export function cleanupPGliteFileData() {
  if (fs.existsSync(DB_DIR)) {
    fs.rmSync(DB_DIR, { recursive: true, force: true });
    console.log(`✓ Cleaned up file-backed data directory: ${DB_DIR}`);
  }
}
