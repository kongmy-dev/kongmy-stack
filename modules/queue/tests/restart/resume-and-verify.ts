/**
 * Restart-durability phase 2: open the SAME file-backed store in a fresh
 * process and verify the job enqueued by the crashed process is delivered.
 * Usage: bun tests/restart/resume-and-verify.ts <store-path>
 */
import { PGlite } from "@electric-sql/pglite";
import { pgbossQueue } from "../../src/index";

const storePath = process.argv[2];
if (!storePath) {
  console.error("usage: resume-and-verify.ts <store-path>");
  process.exit(2);
}

const queue = await pgbossQueue({ pglite: new PGlite(storePath) });
let delivered: string | null = null;

await queue.work<{ marker: string }>("restart-proof", async (job) => {
  delivered = job.data.marker;
});

for (let i = 0; i < 60 && !delivered; i++) {
  await new Promise((r) => setTimeout(r, 250));
}
await queue.stop();

if (delivered === "survive-me") {
  console.log("RESTART DURABILITY OK: job survived process death and was processed");
  process.exit(0);
}
console.error(`RESTART DURABILITY FAILED: delivered=${delivered}`);
process.exit(1);
