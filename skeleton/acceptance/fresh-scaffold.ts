#!/usr/bin/env bun
/**
 * Fresh-scaffold acceptance gate: proves skeleton can go from empty → running in one command.
 *
 * Catches:
 * - Missing dependencies (bun install fails)
 * - TypeScript errors (type-check fails)
 * - Boundary violations (dep-cruiser fails)
 * - Test failures (bun test fails)
 * - Client generation failures (gen:client fails)
 * - Build errors (vite build fails)
 *
 * Exit: 0 = all steps pass; nonzero with failing step tail printed.
 */

import { spawn } from "bun";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";

interface Step {
  name: string;
  cwd: string;
  command: string;
  args: string[];
}

async function main() {
  // Create temp directory for fresh scaffold
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "scaffold-"));
  // The skeleton directory is the parent of acceptance/ (this script)
  const skeletonRoot = path.dirname(path.dirname(import.meta.path));

  console.log(`📦 Fresh-scaffold acceptance gate`);
  console.log(`   Scaffolding into: ${workDir}\n`);

  // Step 0: Copy skeleton to temp dir (respecting .gitignore)
  console.log(`[1/7] Copying skeleton (respecting .gitignore)...`);
  try {
    const ignorePatterns = ["node_modules", ".git", ".bun", "dist", "build", "coverage", ".claude"];
    const copyDir = async (src: string, dest: string) => {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        if (ignorePatterns.includes(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    };
    await copyDir(skeletonRoot, workDir);
    console.log(`   ✓ Copied skeleton`);
  } catch (err) {
    console.error(`   ✗ Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Remove acceptance test files before running bun test (they're Playwright, not bun tests)
  try {
    await fs.rm(path.join(workDir, "acceptance"), { recursive: true, force: true });
  } catch {
    // Ignore
  }

  const steps: Step[] = [
    {
      name: "bun install",
      cwd: workDir,
      command: "bun",
      args: ["install"],
    },
    {
      name: "type-check",
      cwd: workDir,
      command: "bun",
      args: ["run", "type-check"],
    },
    {
      name: "boundary-check",
      cwd: workDir,
      command: "bun",
      args: ["run", "boundary-check"],
    },
    {
      name: "test",
      cwd: workDir,
      command: "bun",
      args: ["run", "test"],
    },
    {
      name: "gen:client",
      cwd: workDir,
      command: "bun",
      args: ["run", "gen:client"],
    },
    {
      name: "web vite build",
      cwd: path.join(workDir, "apps/web"),
      command: "bun",
      args: ["run", "build"],
    },
  ];

  let allPass = true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    process.stdout.write(`[${i + 2}/7] ${step.name}... `);

    try {
      const proc = Bun.spawn([step.command, ...step.args], {
        cwd: step.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      if (exitCode === 0) {
        console.log(`✓`);
      } else {
        console.log(`✗`);
        // Print last 30 lines of output
        const stderr = await Bun.readableStreamToText(proc.stderr!);
        const stdout = await Bun.readableStreamToText(proc.stdout!);
        const combined = (stdout + stderr).split("\n");
        const tail = combined.slice(-30).join("\n");
        console.error(`\n   Error in ${step.name}:\n${tail}\n`);
        allPass = false;
        break;
      }
    } catch (err) {
      console.log(`✗`);
      console.error(`   Exception: ${err instanceof Error ? err.message : String(err)}`);
      allPass = false;
      break;
    }
  }

  // Cleanup
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  if (allPass) {
    console.log(`\n✅ All acceptance gates passed`);
    process.exit(0);
  } else {
    console.log(`\n❌ Acceptance gate failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
