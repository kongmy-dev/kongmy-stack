#!/usr/bin/env bun

/**
 * scripts/add.ts — Module copier (ADR-0003)
 *
 * Usage: bun scripts/add.ts <module-name> [--into <path>] [--force]
 *
 * Copies a module from modules/<name> into the target skeleton:
 *   - Copies modules/<name> → <skeleton>/packages/<name>
 *   - Patches <skeleton>/package.json to add workspace entry
 *   - Merges dependencies into packages that import it
 *
 * Arguments:
 *   <module-name>     Name of the module to add (e.g., 'money', 'queue')
 *   --into <path>     Target skeleton path (default: ./skeleton)
 *   --force           Skip git status check (use with caution)
 *
 * Idempotent: run multiple times on the same module is safe.
 * Refuses to run if the target directory is a git repo with uncommitted changes
 * unless --force is passed.
 */

import { existsSync, copyFileSync, mkdirSync, rmSync } from 'fs'
import { join, relative, resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const CWD = process.cwd()
const REPO_ROOT = process.env.KONGMY_STACK_ROOT || CWD
const MODULES_ROOT = join(REPO_ROOT, 'modules')

async function main() {
  const moduleName = process.argv[2]
  const intoIndex = process.argv.indexOf('--into')
  const skeletonRoot = resolve(intoIndex >= 0 ? process.argv[intoIndex + 1] : join(CWD, 'skeleton'))
  const hasForce = process.argv.includes('--force')

  if (!moduleName) {
    console.error('Usage: bun scripts/add.ts <module-name> [--into <path>] [--force]')
    console.error('')
    console.error('Examples:')
    console.error('  bun scripts/add.ts queue')
    console.error('  bun scripts/add.ts money')
    console.error('  bun scripts/add.ts queue --into /path/to/my-project')
    process.exit(1)
  }

  // Validate module exists
  const modulePath = join(MODULES_ROOT, moduleName)
  if (!existsSync(modulePath)) {
    console.error(`❌ Module not found: ${modulePath}`)
    console.error(`   Searched in: ${MODULES_ROOT}`)
    process.exit(1)
  }

  // Validate skeleton exists
  if (!existsSync(skeletonRoot)) {
    console.error(`❌ Skeleton not found: ${skeletonRoot}`)
    process.exit(1)
  }

  // Print target path clearly (absolute)
  console.log(`Target skeleton: ${skeletonRoot}`)

  // Check for uncommitted changes in git repo
  if (!hasForce) {
    try {
      const status = execSync(`git -C "${skeletonRoot}" status --porcelain`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (status) {
        console.error(`\n❌ Target directory has uncommitted changes:`)
        console.error(`\n${status}\n`)
        console.error(`Commit or stash changes before running add.ts, or pass --force to skip this check.`)
        process.exit(1)
      }
    } catch (err) {
      // Not a git repo or git command failed — either way, proceed
      // (target might be a fresh clone without .git)
    }
  }

  const skeletonPackages = join(skeletonRoot, 'packages')
  const targetPath = join(skeletonPackages, moduleName)

  // Verify target path is under packages/ (security: prevent module dumps to repo root)
  if (!targetPath.startsWith(skeletonPackages + '/') && targetPath !== skeletonPackages) {
    console.error(`❌ Security: target path outside packages/: ${targetPath}`)
    process.exit(1)
  }

  // Copy module to skeleton/packages/<name>
  console.log(`Adding module: ${moduleName}`)
  console.log(`  Module source: ${modulePath}`)
  console.log(`  Target path: ${targetPath}`)

  if (existsSync(targetPath)) {
    console.log('  (already exists, replacing...)')
    rmSync(targetPath, { recursive: true, force: true })
  }
  copyRecursive(modulePath, targetPath)
  console.log('  ✓ module copied')

  // Patch skeleton/package.json to add workspace entry (root edit is allowed)
  const skeletonPackageJson = join(skeletonRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(skeletonPackageJson, 'utf-8'))

  const workspaceEntry = `packages/${moduleName}`
  if (!pkg.workspaces?.includes(workspaceEntry)) {
    if (!pkg.workspaces) pkg.workspaces = []
    pkg.workspaces.push(workspaceEntry)
    writeFileSync(skeletonPackageJson, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  ✓ added workspace entry: ${workspaceEntry}`)
  } else {
    console.log(`  ✓ workspace entry already present`)
  }

  console.log(`\n✅ ${moduleName} added successfully`)
  console.log(`\nNext steps:`)
  console.log(`  cd ${relative(CWD, skeletonRoot)}`)
  console.log(`  bun install`)
  console.log(`  bun run test`)
}

function copyRecursive(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })

  const entries = require('fs').readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
