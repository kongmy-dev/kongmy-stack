#!/usr/bin/env bun
/**
 * CI Check: describe-coverage
 *
 * ADR-0004: Mandatory `.describe()` on all schemas
 * Verifies every z.* schema has a description, recursively.
 *
 * Exit code 0: all good
 * Exit code 1: missing descriptions found
 */

import * as fs from "fs";
import * as path from "path";

const srcDir = path.join(import.meta.dir, "..", "src");

// ============================================================================
// AST-level check: look for z.* calls without .describe()
// ============================================================================

/**
 * Naive regex-based check:
 * - Find z.* patterns (object, string, number, enum, array, etc.)
 * - Check if followed by .describe()
 *
 * Limitation: doesn't handle complex expressions or comments perfectly
 * Good enough for CI gate; false negatives are acceptable (devs should read output)
 */

function checkFile(filePath: string): {
  file: string;
  missing: Array<{ line: number; code: string }>;
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const missing: Array<{ line: number; code: string }> = [];

  // Pattern: z.string(), z.number(), z.object(), z.array(), z.enum(), etc.
  // without a .describe() on the same or next line
  const zodPattern = /z\.(string|number|int|boolean|object|array|enum|literal|optional|default)\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments and documentation
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line) || /\/\*|^\s*\*\s|^\s*\*\//.test(line)) {
      continue;
    }

    if (!zodPattern.test(line)) continue;

    // Skip if this line already has .describe()
    if (/\.describe\(/.test(line)) continue;

    // Skip if next line(s) start with .describe()
    let foundDescribe = false;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      if (/^\s*\.describe\(/.test(lines[j])) {
        foundDescribe = true;
        break;
      }
      // Stop looking if we hit a new statement or closing bracket
      if (/^[};\)]/.test(lines[j].trim())) break;
    }

    if (!foundDescribe) {
      missing.push({
        line: lineNum,
        code: line.trim(),
      });
    }
  }

  return { file: filePath, missing };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("Checking describe-coverage in packages/contract/src...\n");

  const tsFiles = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(srcDir, f));

  let totalIssues = 0;

  for (const file of tsFiles) {
    const result = checkFile(file);

    if (result.missing.length > 0) {
      console.error(
        `\n❌ ${path.basename(result.file)}: ${result.missing.length} missing describe()`
      );

      for (const issue of result.missing) {
        console.error(`   Line ${issue.line}: ${issue.code}`);
      }

      totalIssues += result.missing.length;
    }
  }

  if (totalIssues === 0) {
    console.log("✓ All schemas have .describe()");
    process.exit(0);
  } else {
    console.error(`\n❌ Found ${totalIssues} schemas missing .describe()`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
