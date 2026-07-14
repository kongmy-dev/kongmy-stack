/**
 * Test runner for PGlite file-backed lane
 */

import {
  createPGliteFileLane,
  cleanupPGliteFileData,
} from "./lanes/pglite-file.ts";
import { runAllAssertions, printResultsMatrix } from "./suite.ts";

async function main() {
  const results = new Map();

  // Clean up any previous test data
  console.log("Cleaning previous test data...\n");
  cleanupPGliteFileData();

  try {
    const lane = await createPGliteFileLane();

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
