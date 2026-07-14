/**
 * Restart durability test for PostgreSQL lane
 *
 * This script tests that jobs survive a hard process kill and are
 * resumed/completed in a fresh process connecting to the same Postgres server.
 *
 * Usage:
 *   bun run restart/restart-postgres.ts
 *
 * Flow:
 *   1. Start process 1: Connect to Postgres, enqueue jobs and hold process open
 *   2. Hard-kill process 1 while jobs are still processing
 *   3. Start process 2: Connect to same Postgres and verify jobs were resumed
 *   4. Process 2: Wait for jobs to complete
 *   5. Verify all jobs reached completed state
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { PgBoss } from "pg-boss";

const PG_CONNECTION_STRING =
  process.env.PG_CONNECTION_STRING ||
  "postgres://postgres:spike@localhost:5433/postgres";

const MARKER_FILE = ".postgres-restart-marker.json";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Phase 1: Enqueue jobs in process 1, then simulate hard kill
 */
async function phase1EnqueueAndKill() {
  console.log("PHASE 1: Enqueue jobs and simulate hard kill");
  console.log("==========================================\n");

  const boss = new PgBoss({
    connectionString: PG_CONNECTION_STRING,
    newJobCheckInterval: 100,
    schema: "pgboss_restart",
  });

  try {
    await boss.start();
    console.log("✓ pg-boss started in phase 1");

    // Create queue
    try {
      await boss.createQueue("restart-test");
    } catch {
      // Queue may exist
    }

    // Enqueue 5 jobs
    const jobIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = await boss.send("restart-test", {
        jobNum: i,
        message: `Job ${i}`,
      });
      jobIds.push(id);
      console.log(`✓ Enqueued job ${i}: ${id}`);
    }

    // Write marker file to signal to phase 2 that jobs were enqueued
    fs.writeFileSync(MARKER_FILE, JSON.stringify({ jobIds, timestamp: Date.now() }));
    console.log(`✓ Written marker file with ${jobIds.length} job IDs\n`);

    // Set up a worker but don't let it finish processing
    let processedCount = 0;
    boss.work("restart-test", async (job) => {
      processedCount++;
      console.log(`[Phase 1] Processing job ${job.data.jobNum} (${processedCount})`);
      // Simulate slow work
      await sleep(2000);
    });

    // Let some processing happen (but not complete)
    await sleep(1000);
    console.log(`[Phase 1] Processed ${processedCount} jobs before simulated kill\n`);

    // Simulate hard kill: exit immediately
    console.log("⚡ Simulating hard process kill...\n");
    process.exit(0);
  } catch (error) {
    console.error("✗ Phase 1 failed:", error);
    process.exit(1);
  }
}

/**
 * Phase 2: Verify jobs survived and complete them
 */
async function phase2VerifyAndComplete() {
  console.log("\nPHASE 2: Verify jobs survived and complete processing");
  console.log("=====================================================\n");

  // Wait a moment for database to settle
  await sleep(500);

  // Read marker file to get expected job IDs
  if (!fs.existsSync(MARKER_FILE)) {
    console.error("✗ Marker file not found. Phase 1 may have failed.");
    process.exit(1);
  }

  const marker = JSON.parse(fs.readFileSync(MARKER_FILE, "utf-8"));
  const expectedJobIds = marker.jobIds;
  console.log(`✓ Read marker file: ${expectedJobIds.length} jobs expected\n`);

  const boss = new PgBoss({
    connectionString: PG_CONNECTION_STRING,
    newJobCheckInterval: 100,
    schema: "pgboss_restart",
  });

  try {
    await boss.start();
    console.log("✓ pg-boss started in phase 2\n");

    // Verify all expected jobs still exist in the database
    console.log("Verifying jobs survived the hard kill:");
    const survivedJobs = [];
    for (const jobId of expectedJobIds) {
      const job = await boss.getJob(jobId);
      if (job) {
        survivedJobs.push(job);
        console.log(
          `  ✓ Job ${jobId.slice(0, 8)}... state=${job.state}`
        );
      } else {
        console.log(`  ✗ Job ${jobId.slice(0, 8)}... NOT FOUND`);
      }
    }

    if (survivedJobs.length !== expectedJobIds.length) {
      throw new Error(
        `Expected ${expectedJobIds.length} jobs but only found ${survivedJobs.length}`
      );
    }

    console.log(`\n✓ All ${survivedJobs.length} jobs survived the hard kill\n`);

    // Now process the surviving jobs
    console.log("Processing surviving jobs:");
    let completedCount = 0;

    boss.work("restart-test", async (job) => {
      console.log(`  Processing job ${job.data.jobNum}`);
      // Actually process the job (no delay this time)
      completedCount++;
    });

    // Wait for all jobs to complete
    await sleep(3000);

    console.log(`\n✓ Completed ${completedCount} jobs in phase 2\n`);

    await boss.unsubscribe("restart-test");

    // Verify all jobs reached completed state
    console.log("Verifying final job states:");
    let allCompleted = true;
    for (const jobId of expectedJobIds) {
      const job = await boss.getJob(jobId);
      if (job?.state === "completed") {
        console.log(`  ✓ Job ${jobId.slice(0, 8)}... COMPLETED`);
      } else {
        console.log(
          `  ✗ Job ${jobId.slice(0, 8)}... state=${job?.state || "MISSING"}`
        );
        allCompleted = false;
      }
    }

    if (!allCompleted) {
      throw new Error("Not all jobs reached completed state");
    }

    console.log("\n✓✓✓ RESTART DURABILITY TEST PASSED ✓✓✓");
    console.log("All jobs survived the hard process kill and completed successfully.\n");

    await boss.stop();
  } catch (error) {
    console.error("✗ Phase 2 failed:", error);
    process.exit(1);
  }
}

/**
 * Main: Orchestrate the restart test
 */
async function main() {
  const args = process.argv.slice(2);
  const phase = args[0];

  console.log("RESTART DURABILITY TEST - PostgreSQL\n");

  if (phase === "phase1") {
    await phase1EnqueueAndKill();
  } else if (phase === "phase2") {
    await phase2VerifyAndComplete();
  } else {
    // Orchestrate both phases
    console.log("Starting automated restart test...\n");

    // Clean up any previous marker
    if (fs.existsSync(MARKER_FILE)) {
      fs.unlinkSync(MARKER_FILE);
    }

    // Start phase 1 in a child process
    console.log("Launching phase 1 (enqueue & kill)...");
    const phase1Process = spawn("bun", ["run", "restart/restart-postgres.ts", "phase1"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    // Wait for phase 1 to exit (hard kill)
    await new Promise((resolve) => {
      phase1Process.on("exit", resolve);
    });

    console.log("\nPhase 1 completed (process killed)");
    await sleep(1000);

    // Start phase 2 in a child process
    console.log("Launching phase 2 (verify & complete)...");
    const phase2Process = spawn("bun", ["run", "restart/restart-postgres.ts", "phase2"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    // Wait for phase 2 to complete
    phase2Process.on("exit", (code) => {
      // Clean up marker file
      if (fs.existsSync(MARKER_FILE)) {
        fs.unlinkSync(MARKER_FILE);
      }
      process.exit(code || 0);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
