/**
 * Test runner for PostgreSQL lane
 */

import { createPostgresLane, cleanupPostgresSchema } from "./lanes/postgres.ts";
import { runAllAssertions, printResultsMatrix } from "./suite.ts";

async function main() {
  const results = new Map();

  try {
    const lane = await createPostgresLane();

    const assertions = await runAllAssertions(lane);
    results.set(lane.name, assertions);

    await lane.cleanup();

    // Print results
    printResultsMatrix(results);

    // Exit with error if any assertion failed
    const failed = assertions.some((a) => !a.passed);
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error("Fatal error:", error);
    console.log("\nNote: This test requires a PostgreSQL 16 server running at localhost:5433");
    console.log("See conformance/README.md for setup instructions");
    process.exit(1);
  }
}

main();
