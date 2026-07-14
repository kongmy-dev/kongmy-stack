#!/usr/bin/env bun

/**
 * scripts/add.ts — Module copier (ADR-0003)
 *
 * Usage: bun scripts/add.ts <module-name> [--into <path>]
 *
 * Copies a module from modules/<name> into the target project:
 *   - Copies modules/<name> → skeleton/packages/<name>
 *   - Patches skeleton/package.json to add workspace entry
 *   - Merges dependencies into packages that import it
 *
 * Idempotent: run multiple times on the same module is safe.
 */

import { existsSync, copyFileSync, mkdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const CWD = process.cwd()
const MODULES_ROOT = join(CWD, 'modules')
const SKELETON_PACKAGES = join(CWD, 'skeleton', 'packages')

async function main() {
  const moduleName = process.argv[2]
  if (!moduleName) {
    console.error('Usage: bun scripts/add.ts <module-name>')
    console.error('  bun scripts/add.ts queue')
    console.error('  bun scripts/add.ts money')
    process.exit(1)
  }

  const modulePath = join(MODULES_ROOT, moduleName)
  if (!existsSync(modulePath)) {
    console.error(`Module not found: ${modulePath}`)
    process.exit(1)
  }

  const targetPath = join(SKELETON_PACKAGES, moduleName)

  // Copy module to skeleton/packages/<name>
  console.log(`Copying ${moduleName} to ${relative(CWD, targetPath)}...`)
  if (existsSync(targetPath)) {
    console.log('  (exists, replacing...)')
    rmSync(targetPath, { recursive: true, force: true })
  }
  copyRecursive(modulePath, targetPath)
  console.log('  ✓ copied')

  // Patch skeleton/package.json to add workspace entry
  const skeletonPackageJson = join(CWD, 'skeleton', 'package.json')
  const pkg = JSON.parse(readFileSync(skeletonPackageJson, 'utf-8'))

  const workspaceEntry = `packages/${moduleName}`
  if (!pkg.workspaces?.includes(workspaceEntry)) {
    if (!pkg.workspaces) pkg.workspaces = []
    pkg.workspaces.push(workspaceEntry)
    writeFileSync(skeletonPackageJson, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  ✓ added workspace entry: ${workspaceEntry}`)
  }

  console.log(`\n✅ ${moduleName} added to skeleton.`)
  console.log(`Run: cd skeleton && bun install`)
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
