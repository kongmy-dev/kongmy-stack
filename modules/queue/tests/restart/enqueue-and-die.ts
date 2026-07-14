/**
 * Restart-durability phase 1: enqueue a job into a file-backed PGlite store,
 * then die WITHOUT processing it (hard exit — no graceful stop).
 * Usage: bun tests/restart/enqueue-and-die.ts <store-path>
 */
import { PGlite } from "@electric-sql/pglite";
import { pgbossQueue } from "../../src/index";

const storePath = process.argv[2];
if (!storePath) {
  console.error("usage: enqueue-and-die.ts <store-path>");
  process.exit(2);
}

const queue = await pgbossQueue({ pglite: new PGlite(storePath) });
const jobId = await queue.enqueue("restart-proof", { marker: "survive-me" });
console.log(`enqueued ${jobId}; dying without processing`);
// Hard exit: no queue.stop(), no graceful shutdown — simulates a crash.
process.exit(0);
