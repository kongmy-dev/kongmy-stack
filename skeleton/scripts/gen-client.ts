/**
 * Generate TypeScript client types from OpenAPI spec.
 * Wired as `bun run gen:client` in root package.json.
 *
 * Builds the API app, fetches the OpenAPI spec, and generates TS types.
 */

import { createInMemoryAdapter } from "../packages/db/src/index.ts";
import { createApp, env } from "../apps/api/src/main.ts";
import * as fs from "fs/promises";
import * as path from "path";

async function generateClient() {
  try {
    // Build API app
    console.log("Building API app...");
    const db = await createInMemoryAdapter();
    const app = createApp({ db, env });

    // Fetch OpenAPI spec
    console.log("Fetching OpenAPI spec...");
    const specRes = await app.request("/openapi.json");
    if (specRes.status !== 200) {
      throw new Error(`Failed to fetch OpenAPI spec: ${specRes.status}`);
    }

    const spec = await specRes.json();

    // Ensure output directory exists
    const outputDir = path.join(import.meta.dir, "../apps/web/src/lib/generated");
    await fs.mkdir(outputDir, { recursive: true });

    // Write spec to file
    const specPath = path.join(outputDir, "openapi.json");
    await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
    console.log(`Wrote OpenAPI spec to ${specPath}`);

    // Generate TypeScript types using openapi-typescript
    console.log("Generating TypeScript types...");
    const openapiTS = await import("openapi-typescript");

    const output = await openapiTS.default(spec);
    const typesPath = path.join(outputDir, "api-types.ts");
    await fs.writeFile(typesPath, output);
    console.log(`Generated TypeScript client types at ${typesPath}`);

    console.log("✓ Client generation complete");
  } catch (err) {
    console.error("✗ Client generation failed:", err);
    process.exit(1);
  }
}

generateClient();
