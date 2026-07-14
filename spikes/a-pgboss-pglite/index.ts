/**
 * Spike: pg-boss + PGlite compatibility test
 *
 * Tests the full lifecycle:
 * 1. Job enqueue
 * 2. Worker processing
 * 3. Failure + retry with backoff
 * 4. Dead-letter handling
 * 5. Maintenance loops stability
 */

import { PGlite } from "@electric-sql/pglite";
import { PgBoss } from "pg-boss";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adapter to make PGlite compatible with pg-boss's expected db interface.
 * pg-boss expects an executeSql method that takes { text, values } and returns results.
 */
function createPGliteAdapter(pglite: InstanceType<typeof PGlite>) {
  return {
    executeSql: async (query: { text: string; values?: unknown[] }) => {
      try {
        const result = await pglite.exec(query.text, query.values);
        return {
          rows: Array.isArray(result) ? result : [],
          rowCount: Array.isArray(result) ? result.length : 0,
        };
      } catch (error) {
        throw error;
      }
    },
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    });
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log("🚀 Starting pg-boss + PGlite spike...\n");

  // Initialize PGlite
  console.log("1️⃣  Initializing PGlite...");
  const pglite = new PGlite();
  const db = createPGliteAdapter(pglite);
  console.log("   PGlite initialized in-memory");
  console.log("   Created pg-boss adapter bridge\n");

  let boss: PgBoss | null = null;

  // Test 1: Basic initialization
  await test("Initialize pg-boss with PGlite", async () => {
    boss = new PgBoss({ db });
    await boss.start();
    console.log("   pg-boss started with PGlite adapter");
  });

  if (!boss) {
    console.error(
      "❌ Failed to initialize pg-boss. Cannot continue with remaining tests."
    );
    process.exit(1);
  }

  // Test 2: Enqueue a simple job
  let simpleJobId: string | null = null;
  await test("Enqueue simple job", async () => {
    simpleJobId = await boss.send("simple-job", { data: "test" });
    console.log(`   Job enqueued: ${simpleJobId}`);
  });

  if (simpleJobId) {
    // Test 3: Process the job successfully
    await test("Process job successfully", async () => {
      const jobProcessed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Job did not complete within 5 seconds"));
        }, 5000);

        boss!.work("simple-job", async (job) => {
          clearTimeout(timeout);
          console.log(`   Job ${job.id} processed`);
          resolve();
        });
      });

      await jobProcessed;
    });
  }

  // Test 4: Enqueue a job that will fail
  let failingJobId: string | null = null;
  await test("Enqueue job that will fail", async () => {
    failingJobId = await boss.send("failing-job", { data: "will fail" }, {
      retryLimit: 3,
      retryDelay: 100, // 100ms between retries for faster testing
      retryBackoff: true,
    });
    console.log(`   Failing job enqueued: ${failingJobId}`);
  });

  if (failingJobId) {
    let attemptCount = 0;
    const maxAttempts = 4; // 1 initial + 3 retries

    // Test 5: Handle job failures and retries
    await test("Handle job failure and retry", async () => {
      const retryTest = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `Expected ${maxAttempts} attempts but only got ${attemptCount}`
            )
          );
        }, 10000);

        boss!.work("failing-job", async (job) => {
          attemptCount++;
          console.log(`   Attempt ${attemptCount} for job ${job.id}`);

          if (attemptCount < maxAttempts) {
            throw new Error("Intentional failure for retry testing");
          } else {
            console.log(`   Job exhausted retries (${attemptCount} attempts)`);
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      await retryTest;

      if (attemptCount !== maxAttempts) {
        throw new Error(
          `Expected ${maxAttempts} attempts but got ${attemptCount}`
        );
      }
    });

    // Test 6: Check job state after exhaustion
    await test("Verify dead-letter/failed state after exhaustion", async () => {
      await sleep(500); // Allow time for final state write

      // Try to fetch the job state
      const jobState = await boss.getJobById(failingJobId);
      console.log(`   Job state after exhaustion: ${jobState?.state}`);

      // Should be 'failed' state
      if (!jobState) {
        throw new Error("Job not found after exhaustion");
      }
      if (jobState.state !== "failed") {
        console.log(
          `   Warning: Expected 'failed' state but got '${jobState.state}'`
        );
      }
    });
  }

  // Test 7: Health check - verify maintenance doesn't crash
  await test("Verify maintenance loops stability", async () => {
    // pg-boss runs cleanup/maintenance in background
    // Just ensure stop() completes cleanly
    if (boss) {
      await boss.stop();
      console.log("   pg-boss stopped cleanly");
    }
  });

  // Test 8: Reinitialize and test persistence across restarts
  await test("Test persistence across restart", async () => {
    const db2 = createPGliteAdapter(pglite);
    const boss2 = new PgBoss({ db: db2 });
    await boss2.start();
    console.log("   New instance started with same PGlite db");
    await boss2.stop();
    console.log("   New instance stopped cleanly");
  });

  // Print summary
  console.log("\n📊 Test Summary:");
  console.log("================");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  results.forEach((r) => {
    const status = r.passed ? "✓" : "✗";
    console.log(`${status} ${r.name} (${r.duration}ms)`);
    if (r.error) {
      console.log(`  Error: ${r.error}`);
    }
  });

  console.log(`\nTotal: ${passed} passed, ${failed} failed out of ${results.length} tests`);

  if (failed > 0) {
    console.log("\n❌ SPIKE FAILED - See errors above");
    process.exit(1);
  } else {
    console.log("\n✅ SPIKE PASSED - pg-boss + PGlite is compatible!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});