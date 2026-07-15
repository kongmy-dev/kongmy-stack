#!/usr/bin/env bun

/**
 * scripts/fresh-clone-check.ts — Seam 8 acceptance test
 *
 * Proves the scaffold path end-to-end:
 * 1. Copy skeleton to a temp dir (simulates consumer clone)
 * 2. Run bun install (proves dependency resolution)
 * 3. Run bun run ci (proves full CI pipeline)
 * 4. Add a module (proves add.ts against consumer project)
 * 5. Run module tests (proves vendored module works)
 *
 * Exit code 0 = all steps passed
 * Exit code 1 = any step failed
 */

import { existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import os from 'os'

const REPO_ROOT = process.cwd()
const SKELETON_SRC = join(REPO_ROOT, 'skeleton')
const TEMP_BASE = os.tmpdir()
const TEMP_DIR = join(TEMP_BASE, `kongmy-fresh-clone-${Date.now()}`)
const TEMP_SKELETON = join(TEMP_DIR, 'skeleton')

// --- ANSI colors for output ---
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

function log(msg: string) {
  console.log(msg)
}

function section(title: string) {
  console.log(`\n${colors.blue}═══ ${title} ${colors.reset}`)
}

function success(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`)
}

function error(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`)
}

function hint(msg: string) {
  console.log(`${colors.gray}  ${msg}${colors.reset}`)
}

function exec(cmd: string, description: string, env?: Record<string, string>): { exitCode: number; output: string } {
  try {
    hint(`$ ${cmd}`)
    const output = execSync(cmd, {
      cwd: TEMP_SKELETON,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    })
    return { exitCode: 0, output }
  } catch (err: any) {
    return { exitCode: err.status ?? 1, output: err.stdout?.toString() ?? '' }
  }
}

async function main() {
  try {
    section('STEP 1: Copy skeleton to temp dir')

    // Clean up any existing temp dir
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true, force: true })
    }

    // Copy skeleton EXCLUDING node_modules, .vite, bun.lock symlinks, playwright artifacts
    // This ensures a truly fresh install with no repo-internal assumptions
    execSync(`mkdir -p "${TEMP_DIR}"`, { stdio: 'pipe' })
    execSync(`rsync -av --exclude=node_modules --exclude=.vite --exclude=.playwright --exclude=bun.lock* "${SKELETON_SRC}/" "${TEMP_DIR}/skeleton/"`, { stdio: 'pipe' })

    if (!existsSync(TEMP_SKELETON)) {
      throw new Error('Failed to copy skeleton')
    }

    success(`Skeleton copied to ${TEMP_DIR}`)
    hint(`  (temp skeleton: ${TEMP_SKELETON})`)

    // --- STEP 2: bun install ---
    section('STEP 2: bun install')

    const installResult = exec('bun install', 'bun install')
    if (installResult.exitCode !== 0) {
      error(`bun install failed with exit code ${installResult.exitCode}`)
      if (installResult.output) {
        console.log(installResult.output)
      }
      return 1
    }
    success(`bun install completed`)

    // --- STEP 3: bun run ci ---
    section('STEP 3: bun run ci (typecheck + boundaries + tests)')

    // Clear Bun's cache to ensure fresh module resolution
    execSync('rm -rf .bunfig.toml .bun/install/cache .vite node_modules/.vite apps/web/node_modules/.vite 2>/dev/null || true', {
      cwd: TEMP_SKELETON,
      stdio: 'pipe',
    })

    const ciResult = exec('bun run ci', 'bun run ci')
    if (ciResult.exitCode !== 0) {
      error(`bun run ci failed with exit code ${ciResult.exitCode}`)
      if (ciResult.output) {
        console.log(ciResult.output)
      }
      return 1
    }
    success(`CI pipeline passed`)

    // --- STEP 4: Add a module ---
    section('STEP 4: Add money module')

    const addCmd = `bun "${join(REPO_ROOT, 'scripts/add.ts')}" money --into "${TEMP_SKELETON}"`
    const addResult = exec(addCmd, 'bun add.ts money', { KONGMY_STACK_ROOT: REPO_ROOT })
    if (addResult.exitCode !== 0) {
      error(`add.ts failed with exit code ${addResult.exitCode}`)
      if (addResult.output) {
        console.log(addResult.output)
      }
      return 1
    }
    success(`money module added`)
    if (addResult.output) {
      console.log(addResult.output)
    }

    // --- STEP 5: Reinstall and test module ---
    section('STEP 5: bun install (with money module) + test money module')

    const reinstallResult = exec('bun install', 'bun install with money')
    if (reinstallResult.exitCode !== 0) {
      error(`bun install (with module) failed with exit code ${reinstallResult.exitCode}`)
      return 1
    }
    success(`bun install completed (money module integrated)`)

    const testMoneyResult = exec('bun run --cwd packages/money test', 'money module test')
    if (testMoneyResult.exitCode !== 0) {
      error(`money module tests failed with exit code ${testMoneyResult.exitCode}`)
      if (testMoneyResult.output) {
        console.log(testMoneyResult.output)
      }
      return 1
    }
    success(`money module tests passed`)
    if (testMoneyResult.output) {
      // Show test summary
      const lines = testMoneyResult.output.split('\n')
      const summary = lines.filter((l) => l.includes('pass') || l.includes('test')).slice(-3)
      summary.forEach((l) => hint(l.trim()))
    }

    // --- SUMMARY ---
    section('ACCEPTANCE TEST PASSED')
    log(`\n${colors.green}All gates passed:${colors.reset}`)
    log(`  ✓ Skeleton copy successful`)
    log(`  ✓ bun install: exit:0`)
    log(`  ✓ bun run ci: exit:0`)
    log(`  ✓ add.ts money: exit:0`)
    log(`  ✓ money module test: exit:0`)
    log(`\nCleanup: rm -rf "${TEMP_DIR}"`)

    return 0
  } catch (err: any) {
    error(`Unhandled error: ${err.message}`)
    console.log(err.stack)
    return 1
  }
}

main().then((exitCode) => {
  if (existsSync(TEMP_DIR)) {
    try {
      rmSync(TEMP_DIR, { recursive: true, force: true })
    } catch (e) {
      console.warn(`Warning: failed to clean up ${TEMP_DIR}`)
    }
  }
  process.exit(exitCode)
})
