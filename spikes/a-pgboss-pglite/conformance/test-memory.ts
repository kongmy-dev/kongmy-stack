/**
 * Test runner for PGlite in-memory lane
 */

import { createPGliteMemoryLane } from "./lanes/pglite-memory.ts";
import { runAllAssertions, printResultsMatrix } from "./suite.ts";

async function main() {
  const results = new Map();

  try {
    const lane = await createPGliteMemoryLane();

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
    process.exit(1);
  }
}

main();
