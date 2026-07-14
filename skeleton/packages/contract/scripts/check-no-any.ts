#!/usr/bin/env bun
/**
 * CI Check: no-any / no-unknown
 *
 * ADR-0004: Prohibit z.any() and z.unknown() in contracts
 * These undermine type safety and make generated clients/forms unusable.
 *
 * Exit code 0: clean
 * Exit code 1: z.any() or z.unknown() found
 */

import * as fs from "fs";
import * as path from "path";

const srcDir = path.join(import.meta.dir, "..", "src");

function checkFile(filePath: string): {
  file: string;
  any: Array<{ line: number; code: string }>;
  unknown: Array<{ line: number; code: string }>;
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const anyMatches: Array<{ line: number; code: string }> = [];
  const unknownMatches: Array<{ line: number; code: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Look for z.any() or z.unknown()
    if (/z\.any\(\)/.test(line)) {
      anyMatches.push({
        line: lineNum,
        code: line.trim(),
      });
    }

    if (/z\.unknown\(\)/.test(line)) {
      unknownMatches.push({
        line: lineNum,
        code: line.trim(),
      });
    }
  }

  return { file: filePath, any: anyMatches, unknown: unknownMatches };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("Checking for z.any() and z.unknown() in packages/contract/src...\n");

  const tsFiles = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(srcDir, f));

  let totalIssues = 0;

  for (const file of tsFiles) {
    const result = checkFile(file);
    const fileName = path.basename(result.file);

    if (result.any.length > 0) {
      console.error(`\n❌ ${fileName}: ${result.any.length} z.any() found`);

      for (const match of result.any) {
        console.error(`   Line ${match.line}: ${match.code}`);
      }

      totalIssues += result.any.length;
    }

    if (result.unknown.length > 0) {
      console.error(
        `\n❌ ${fileName}: ${result.unknown.length} z.unknown() found`
      );

      for (const match of result.unknown) {
        console.error(`   Line ${match.line}: ${match.code}`);
      }

      totalIssues += result.unknown.length;
    }
  }

  if (totalIssues === 0) {
    console.log("✓ No z.any() or z.unknown() found");
    process.exit(0);
  } else {
    console.error(
      `\n❌ Found ${totalIssues} forbidden patterns (z.any/z.unknown)`
    );
    console.error(
      "\nRationale: These patterns break type safety and generated clients."
    );
    console.error(
      "Use explicit schemas instead (z.string(), z.object({...}), etc.)"
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
