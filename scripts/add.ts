#!/usr/bin/env bun

/**
 * scripts/add.ts — Module copier (ADR-0003)
 *
 * Usage: bun scripts/add.ts <module-name> [--into <path>]
 *
 * Copies a module from modules/<name> into the target skeleton:
 *   - Copies modules/<name> → <skeleton>/packages/<name>
 *   - Patches <skeleton>/package.json to add workspace entry
 *   - Merges dependencies into packages that import it
 *
 * Arguments:
 *   <module-name>     Name of the module to add (e.g., 'money', 'queue')
 *   --into <path>     Target skeleton path (default: ./skeleton)
 *
 * Idempotent: run multiple times on the same module is safe.
 */

import { existsSync, copyFileSync, mkdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const CWD = process.cwd()
const REPO_ROOT = process.env.KONGMY_STACK_ROOT || CWD
const MODULES_ROOT = join(REPO_ROOT, 'modules')

async function main() {
  const moduleName = process.argv[2]
  const intoIndex = process.argv.indexOf('--into')
  const skeletonRoot = intoIndex >= 0 ? process.argv[intoIndex + 1] : join(CWD, 'skeleton')

  if (!moduleName) {
    console.error('Usage: bun scripts/add.ts <module-name> [--into <path>]')
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

  const skeletonPackages = join(skeletonRoot, 'packages')
  const targetPath = join(skeletonPackages, moduleName)

  // Copy module to skeleton/packages/<name>
  console.log(`Adding module: ${moduleName}`)
  console.log(`  Module source: ${modulePath}`)
  console.log(`  Target path: ${relative(CWD, targetPath)}`)

  if (existsSync(targetPath)) {
    console.log('  (already exists, replacing...)')
    rmSync(targetPath, { recursive: true, force: true })
  }
  copyRecursive(modulePath, targetPath)
  console.log('  ✓ module copied')

  // Patch skeleton/package.json to add workspace entry
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
