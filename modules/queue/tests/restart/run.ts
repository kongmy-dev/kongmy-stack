/**
 * Restart-durability driver: phase 1 enqueues then hard-exits; phase 2 is a
 * FRESH process on the same store that must receive the job. Proves jobs
 * survive process death on the file-backed PGlite lane (ADR-0012).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const store = join(mkdtempSync(join(tmpdir(), "queue-restart-")), "store");

const phase = (script: string) =>
  Bun.spawnSync(["bun", join(import.meta.dir, script), store], {
    stdout: "inherit",
    stderr: "inherit",
  });

const p1 = phase("enqueue-and-die.ts");
if (p1.exitCode !== 0) {
  console.error("phase 1 (enqueue-and-die) failed");
  process.exit(1);
}

const p2 = phase("resume-and-verify.ts");
rmSync(join(store, ".."), { recursive: true, force: true });
process.exit(p2.exitCode === 0 ? 0 : 1);
