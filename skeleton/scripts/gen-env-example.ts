#!/usr/bin/env bun
/**
 * Generate .env.example from apps/api/src/env.ts schema.
 * Per ADR-0005: .env.example is generated from the schema, never hand-maintained.
 * Reproducibility: regen → git diff --exit-code .env.example → exit:0
 */

import { generateEnvExample } from "../apps/api/src/env.js";
import { writeFileSync } from "fs";
import { join } from "path";

const content = generateEnvExample();
const path = join(import.meta.dir, "..", ".env.example");

writeFileSync(path, content, "utf-8");
console.log(`✓ Generated .env.example (${content.length} bytes)`);
