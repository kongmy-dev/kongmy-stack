#!/usr/bin/env bun
/**
 * Discover and run verify scripts across all modules and skeleton packages.
 * Exit 0 if all pass, nonzero if any fail.
 *
 * Usage: bun scripts/verify-all.ts
 */

import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "bun";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

async function findPackagesWithVerify(): Promise<Array<{ name: string; dir: string }>> {
  const results: Array<{ name: string; dir: string }> = [];

  // Check modules/*/package.json (only if node_modules exists, since modules are vendored)
  const modulesDir = "modules";
  try {
    const entries = await fs.readdir(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(modulesDir, entry.name, "package.json");
      const nmPath = path.join(modulesDir, entry.name, "node_modules");
      try {
        // Modules are standalone packages: install deps if missing, then verify.
        // Silently skipping "uninstalled" modules would mean never verifying anything.
        try {
          await fs.stat(nmPath);
        } catch {
          const install = Bun.spawnSync(["bun", "install"], { cwd: path.join(modulesDir, entry.name) });
          if (install.exitCode !== 0) {
            console.error(`bun install failed for ${entry.name}`);
          }
        }

        const content = await fs.readFile(pkgPath, "utf-8");
        const pkg: PackageJson = JSON.parse(content);
        if (pkg.scripts?.verify) {
          results.push({
            name: pkg.name || entry.name,
            dir: path.join(modulesDir, entry.name),
          });
        }
      } catch {
        // Not a valid package, skip
      }
    }
  } catch {
    // modules/ doesn't exist
  }

  // Check skeleton/packages/*/package.json
  const skeletonPkgsDir = "skeleton/packages";
  try {
    const entries = await fs.readdir(skeletonPkgsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(skeletonPkgsDir, entry.name, "package.json");
      try {
        const content = await fs.readFile(pkgPath, "utf-8");
        const pkg: PackageJson = JSON.parse(content);
        if (pkg.scripts?.verify) {
          results.push({
            name: pkg.name || entry.name,
            dir: path.join(skeletonPkgsDir, entry.name),
          });
        }
      } catch {
        // Not a valid package, skip
      }
    }
  } catch {
    // skeleton/packages/ doesn't exist
  }

  // Check skeleton/apps/*/package.json
  const skeletonAppsDir = "skeleton/apps";
  try {
    const entries = await fs.readdir(skeletonAppsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(skeletonAppsDir, entry.name, "package.json");
      try {
        const content = await fs.readFile(pkgPath, "utf-8");
        const pkg: PackageJson = JSON.parse(content);
        if (pkg.scripts?.verify) {
          results.push({
            name: pkg.name || entry.name,
            dir: path.join(skeletonAppsDir, entry.name),
          });
        }
      } catch {
        // Not a valid package, skip
      }
    }
  } catch {
    // skeleton/apps/ doesn't exist
  }

  return results;
}

async function main() {
  console.log("🔍 Discovering packages with verify scripts...\n");

  const packages = await findPackagesWithVerify();

  if (packages.length === 0) {
    console.log("ℹ️  No packages with verify scripts found");
    return;
  }

  console.log(`Found ${packages.length} package(s) with verify scripts:\n`);

  const results: Array<{ name: string; pass: boolean; duration: number }> = [];

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    process.stdout.write(`[${i + 1}/${packages.length}] ${pkg.name}... `);

    const startTime = Date.now();

    try {
      const proc = spawn(["bun", "run", "verify"], {
        cwd: pkg.dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const duration = Date.now() - startTime;

      if (exitCode === 0) {
        console.log(`✓ (${duration}ms)`);
        results.push({ name: pkg.name, pass: true, duration });
      } else {
        console.log(`✗`);
        // Print stderr on failure
        const stderr = await Bun.readableStreamToText(proc.stderr!);
        const stdout = await Bun.readableStreamToText(proc.stdout!);
        console.error(`   ${pkg.name} failed (${duration}ms):`);
        if (stdout) {
          const lines = stdout.split("\n").slice(-10).join("\n");
          console.error(`   ${lines}`);
        }
        if (stderr) {
          const lines = stderr.split("\n").slice(-10).join("\n");
          console.error(`   ${lines}`);
        }
        results.push({ name: pkg.name, pass: false, duration });
      }
    } catch (err) {
      console.log(`✗ (exception)`);
      console.error(`   ${err instanceof Error ? err.message : String(err)}`);
      results.push({ name: pkg.name, pass: false, duration: 0 });
    }
  }

  // Summary table
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log();
  console.log("Package".padEnd(40) + "Status".padEnd(10) + "Duration");
  console.log("-".repeat(60));
  for (const result of results) {
    const status = result.pass ? "✓ PASS" : "✗ FAIL";
    console.log(result.name.padEnd(40) + status.padEnd(10) + `${result.duration}ms`);
  }

  const passCount = results.filter((r) => r.pass).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log("-".repeat(60));
  console.log(
    `Total: ${passCount}/${results.length} passed ${passCount === results.length ? "✓" : "✗"} (${totalTime}ms)`
  );
  console.log();

  if (passCount !== results.length) {
    console.error("❌ Some verify scripts failed");
    process.exit(1);
  } else {
    console.log("✅ All verify scripts passed");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
