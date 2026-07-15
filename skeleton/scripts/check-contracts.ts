#!/usr/bin/env bun

/**
 * check-contracts: CI gate for ADR-0004 contract compliance
 *
 * Enforced rules:
 * 1. Every zod schema field must have .describe() (MCP tool descriptions)
 * 2. No z.any() or z.unknown() in contracts (not generable for Kotlin, vague for agents)
 *
 * Exit codes:
 * - 0: all checks pass
 * - 1: violations found
 *
 * Runs from CI/package.json scripts; use via:
 *   bun scripts/check-contracts.ts
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

interface CheckResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
}

const result: CheckResult = {
  pass: true,
  errors: [],
  warnings: [],
};

// ============================================================================
// Helper: Inspect zod schema for describe() and z.any()
// ============================================================================

/**
 * Extract description from a schema, checking multiple possible locations
 * (since .describe() creates wrappers, and different zod constructs store it differently)
 */
function getDescription(schema: any): string | undefined {
  // Direct description on _def
  if (schema?._def?.description) {
    return schema._def.description;
  }
  // Description in wrapped schema (e.g., from .describe() -> returns a wrapper)
  if (schema?._def?.schema?._def?.description) {
    return schema._def.schema._def.description;
  }
  // Check the schema itself if it's a simple type
  if (schema?.description) {
    return schema.description;
  }
  return undefined;
}

/**
 * Check if a zod schema has proper descriptions on all fields.
 * Recursively inspects nested schemas.
 */
function checkSchemaDescriptions(schema: z.ZodType<any>, path: string): string[] {
  const issues: string[] = [];

  // Check for z.any() or z.unknown() anywhere in the schema
  if (
    schema instanceof z.ZodAny ||
    schema instanceof z.ZodUnknown
  ) {
    issues.push(`  z.any() or z.unknown() at ${path} (not allowed)`);
  }

  // For object schemas, check each field
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)?._def?.shape;
    if (shape && typeof shape === "object") {
      for (const [fieldName, fieldSchema] of Object.entries(shape)) {
        const fieldPath = `${path}.${fieldName}`;
        const fieldSchemaObj = fieldSchema as z.ZodType;

        // Check if field has description, searching multiple locations
        const hasDescription = getDescription(fieldSchema);

        if (!hasDescription) {
          issues.push(
            `  Missing .describe() on field at ${fieldPath}`
          );
        }

        // Recursively check nested schemas
        const nestedIssues = checkSchemaDescriptions(fieldSchemaObj, fieldPath);
        issues.push(...nestedIssues);
      }
    }
  }

  // For array schemas, check the element type
  if (schema instanceof z.ZodArray) {
    const elementSchema = (schema as any)?._def?.type;
    if (elementSchema) {
      const nestedIssues = checkSchemaDescriptions(elementSchema, `${path}[]`);
      issues.push(...nestedIssues);
    }
  }

  // For union/discriminated union, check each option
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema as any)?._def?.options;
    if (Array.isArray(options)) {
      options.forEach((opt: z.ZodType, i: number) => {
        const nestedIssues = checkSchemaDescriptions(opt, `${path}[union${i}]`);
        issues.push(...nestedIssues);
      });
    }
  }

  return issues;
}

// ============================================================================
// Load and check contract files
// ============================================================================

async function checkContractModule() {
  try {
    // Import the contract module to get all exported schemas
    const contractModule = await import("../packages/contract/src/index.ts");

    const schemas: { name: string; schema: z.ZodType }[] = [];

    // Find all exported zod schemas (look for ZodType instances)
    for (const [exportName, exported] of Object.entries(contractModule)) {
      if (exported instanceof z.ZodType) {
        schemas.push({
          name: exportName,
          schema: exported as z.ZodType,
        });
      }
    }

    console.log(`Checking ${schemas.length} exported schemas in @kongmy-stack/contract...\n`);

    // Check each schema
    for (const { name, schema } of schemas) {
      const issues = checkSchemaDescriptions(schema, name);

      if (issues.length > 0) {
        result.pass = false;
        result.errors.push(`${name}:`);
        result.errors.push(...issues);
      }
    }

    // Also check for z.any() in helper definitions
    const helpers = await import("../packages/contract/src/helpers.ts");
    for (const [exportName, exported] of Object.entries(helpers)) {
      if (exported instanceof z.ZodType) {
        const issues = checkSchemaDescriptions(exported as z.ZodType, `helpers.${exportName}`);
        if (issues.length > 0) {
          result.pass = false;
          result.errors.push(`helpers.${exportName}:`);
          result.errors.push(...issues);
        }
      }
    }

    // Also check scalars
    const scalars = await import("../packages/contract/src/scalars.ts");
    for (const [exportName, exported] of Object.entries(scalars)) {
      if (exported instanceof z.ZodType) {
        const issues = checkSchemaDescriptions(exported as z.ZodType, `scalars.${exportName}`);
        if (issues.length > 0) {
          result.pass = false;
          result.errors.push(`scalars.${exportName}:`);
          result.errors.push(...issues);
        }
      }
    }
  } catch (err) {
    result.pass = false;
    result.errors.push(
      `Failed to load contract module: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("═".repeat(60));
  console.log("Contract Compliance Check (ADR-0004)");
  console.log("═".repeat(60));
  console.log();

  await checkContractModule();

  console.log();
  if (result.pass) {
    console.log("✓ All contract checks pass");
    console.log("  - All fields have .describe()");
    console.log("  - No z.any() or z.unknown() found");
    console.log();
    process.exit(0);
  } else {
    if (result.errors.length > 0) {
      console.error("✗ Contract violations found (ADR-0004 enforcement):");
      console.error();
      result.errors.forEach((e) => console.error(e));
      console.error();
    }

    if (result.warnings.length > 0) {
      console.warn("Warnings:");
      result.warnings.forEach((w) => console.warn(w));
      console.warn();
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
