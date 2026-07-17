#!/usr/bin/env bun

/**
 * scripts/add.ts — Module vendorer (ADR-0003)
 *
 * Usage: bun scripts/add.ts <module-name> [--into <path>] [--ref <ref>] [--force]
 *
 * Vendors a module from this repo into a target skeleton as owned source:
 *   - Extracts modules/<name> at <ref> (default HEAD) → <skeleton>/packages/<name>
 *   - Records provenance in <skeleton>/packages/<name>/.vendor.json
 *   - Patches <skeleton>/package.json to add the workspace entry
 *
 * Arguments:
 *   <module-name>     Module to vendor (e.g. 'money', 'queue')
 *   --into <path>     Target skeleton path (default: ./skeleton)
 *   --ref <ref>       Source commit-ish to vendor (default: HEAD)
 *   --force           Skip every refusal below (use with caution)
 *
 * Vendors from a git ref, never the working tree. Two consequences, both load-bearing:
 * uncommitted work upstream cannot leak into a consumer, and the sha recorded in .vendor.json
 * makes "what am I running, and how does it differ from upstream?" answerable later.
 * It also keeps untracked files out of the copy for free — node_modules is gitignored, so
 * `git archive` never sees it.
 *
 * Refuses, unless --force:
 *   - the SOURCE module is dirty (ambiguous: your edits are not what would be vendored)
 *   - the TARGET repo is dirty (you would lose the ability to review this as a diff)
 *   - the TARGET's copy diverged from its recorded hashes (it carries a local patch)
 *
 * Idempotent: re-running on an unmodified copy is safe.
 */

import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'

const CWD = process.cwd()
const REPO_ROOT = process.env.KONGMY_STACK_ROOT || CWD
const MODULES_ROOT = join(REPO_ROOT, 'modules')
const MANIFEST_NAME = '.vendor.json'

/** Provenance written into the vendored copy. Committed by the consumer; read on re-vendor. */
interface VendorManifest {
  module: string
  sourceRef: string
  sourceSha: string
  sourceTree: string
  vendoredAt: string
  /** relpath → sha256 of the bytes as vendored. Divergence = this map no longer matches disk. */
  files: Record<string, string>
}

function git(args: string[], cwd = REPO_ROOT): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim()
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Hash every file under dir (relpath → sha256), skipping the manifest and untracked junk. */
function hashTree(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === MANIFEST_NAME || entry.name === '.git') {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(out, hashTree(full, base))
    } else if (entry.isFile()) {
      out[relative(base, full)] = sha256(readFileSync(full))
    }
  }
  return out
}

/** Files that differ from the manifest: modified, deleted, or added since vendoring. */
function diffAgainstManifest(
  manifest: VendorManifest,
  actual: Record<string, string>,
): { modified: string[]; deleted: string[]; added: string[] } {
  const modified: string[] = []
  const deleted: string[] = []
  const added: string[] = []
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!(path in actual)) deleted.push(path)
    else if (actual[path] !== hash) modified.push(path)
  }
  for (const path of Object.keys(actual)) {
    if (!(path in manifest.files)) added.push(path)
  }
  return { modified: modified.sort(), deleted: deleted.sort(), added: added.sort() }
}

function fail(lines: string[]): never {
  console.error(`\n${lines.join('\n')}\n`)
  process.exit(1)
}

function main() {
  const argv = process.argv.slice(2)
  const moduleName = argv[0]
  const intoIndex = argv.indexOf('--into')
  const refIndex = argv.indexOf('--ref')
  const skeletonRoot = resolve(intoIndex >= 0 ? argv[intoIndex + 1]! : join(CWD, 'skeleton'))
  const ref = refIndex >= 0 ? argv[refIndex + 1]! : 'HEAD'
  const refWasExplicit = refIndex >= 0
  const hasForce = argv.includes('--force')

  if (!moduleName || moduleName.startsWith('--')) {
    console.error('Usage: bun scripts/add.ts <module-name> [--into <path>] [--ref <ref>] [--force]')
    console.error('')
    console.error('Examples:')
    console.error('  bun scripts/add.ts queue')
    console.error('  bun scripts/add.ts money --into /path/to/my-project')
    console.error('  bun scripts/add.ts events --ref v0.3.0 --into /path/to/my-project')
    process.exit(1)
  }

  // Both values reach `git` as argv entries, not a shell string, but keep them boring anyway:
  // a module name is a directory here, and a ref that needs quoting is a ref worth rejecting.
  if (!/^[a-z][a-z0-9-]*$/.test(moduleName)) {
    fail([`❌ Invalid module name: ${moduleName}`, '   Expected lowercase kebab-case.'])
  }
  if (!/^[A-Za-z0-9._/^~@{}-]+$/.test(ref)) {
    fail([`❌ Invalid ref: ${ref}`])
  }

  if (!existsSync(join(MODULES_ROOT, moduleName))) {
    fail([`❌ Module not found: ${join(MODULES_ROOT, moduleName)}`, `   Searched in: ${MODULES_ROOT}`])
  }
  if (!existsSync(skeletonRoot)) {
    fail([`❌ Skeleton not found: ${skeletonRoot}`])
  }

  // ── Resolve what we are actually vendoring ────────────────────────────────
  let sourceSha: string
  let sourceTree: string
  try {
    sourceSha = git(['rev-parse', ref])
    sourceTree = git(['rev-parse', `${ref}:modules/${moduleName}`])
  } catch {
    fail([
      `❌ Cannot resolve ${ref}:modules/${moduleName} in ${REPO_ROOT}`,
      `   The module must be committed at that ref to be vendored.`,
    ])
  }

  console.log(`Vendoring:       ${moduleName}`)
  console.log(`  from:          ${REPO_ROOT} @ ${ref} (${sourceSha.slice(0, 8)})`)
  console.log(`  into:          ${skeletonRoot}`)

  // ── Refusal 1: dirty SOURCE ───────────────────────────────────────────────
  // The check that did not exist. It asked whether the *target* was clean; nothing ever asked
  // whether the source was — and the source is where the bytes come from.
  if (!hasForce && !refWasExplicit) {
    let sourceStatus = ''
    try {
      sourceStatus = git(['status', '--porcelain', '--', `modules/${moduleName}`])
    } catch {
      // Source is not a git repo. Nothing to compare against; the archive step will fail louder.
    }
    if (sourceStatus) {
      fail([
        `❌ Source module has uncommitted changes:`,
        '',
        sourceStatus,
        '',
        `   These edits would NOT be vendored — ${ref} is what gets copied, not your working tree.`,
        `   Commit them, or pass --ref ${ref} to confirm you want the committed state,`,
        `   or --force to skip this check.`,
      ])
    }
  }

  // ── Refusal 2: dirty TARGET ───────────────────────────────────────────────
  if (!hasForce) {
    try {
      const status = git(['status', '--porcelain'], skeletonRoot)
      if (status) {
        fail([
          `❌ Target repo has uncommitted changes:`,
          '',
          status,
          '',
          `   Commit or stash them first so this vendor lands as a reviewable diff,`,
          `   or pass --force to skip this check.`,
        ])
      }
    } catch {
      // Not a git repo — a fresh clone without .git is a legitimate target.
    }
  }

  const skeletonPackages = join(skeletonRoot, 'packages')
  const targetPath = join(skeletonPackages, moduleName)

  // Containment: a module lands under packages/, never at the repo root.
  if (!targetPath.startsWith(skeletonPackages + '/')) {
    fail([`❌ Security: target path outside packages/: ${targetPath}`])
  }

  // ── Refusal 3: TARGET copy diverged (a consumer patch) ────────────────────
  // A committed local patch looks clean to a `git status` check and would be silently destroyed.
  // The manifest is what makes it visible.
  if (existsSync(targetPath)) {
    const manifestPath = join(targetPath, MANIFEST_NAME)
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as VendorManifest
      const { modified, deleted, added } = diffAgainstManifest(manifest, hashTree(targetPath))
      const touched = [
        ...modified.map((f) => `   M ${f}`),
        ...deleted.map((f) => `   D ${f}`),
        ...added.map((f) => `   ? ${f}`),
      ]
      if (touched.length > 0 && !hasForce) {
        fail([
          `❌ Target copy carries local changes since it was vendored:`,
          '',
          ...touched,
          '',
          `   Vendored from ${manifest.sourceSha.slice(0, 8)} on ${manifest.vendoredAt.slice(0, 10)}.`,
          `   Re-vendoring would destroy them. If they are a patch you need, either land it`,
          `   upstream and vendor again, or record it before passing --force.`,
        ])
      }
      if (manifest.sourceTree === sourceTree && touched.length === 0) {
        console.log(`  ✓ already at ${sourceSha.slice(0, 8)}, unmodified — nothing to do`)
        return
      }
    } else {
      // Pre-manifest copy: we cannot tell a patch from a stale vendor, so say so rather than guess.
      console.log(`  ! existing copy has no ${MANIFEST_NAME} — cannot detect local patches`)
      if (!hasForce) {
        fail([
          `❌ Refusing to overwrite an unprovenanced copy at ${targetPath}`,
          '',
          `   It predates provenance tracking, so local patches in it are undetectable.`,
          `   Diff it against the source first:`,
          `     git -C ${REPO_ROOT} archive ${ref}:modules/${moduleName} | tar -x -C /tmp/vendor-check`,
          `     diff -rq ${targetPath} /tmp/vendor-check`,
          `   Then pass --force to replace it.`,
        ])
      }
    }
    rmSync(targetPath, { recursive: true, force: true })
  }

  // ── Extract from the ref ──────────────────────────────────────────────────
  // `git archive` emits only tracked files, so node_modules and other untracked residue in the
  // source working tree cannot ride along.
  mkdirSync(targetPath, { recursive: true })
  const tar = execFileSync(
    'git',
    ['-C', REPO_ROOT, 'archive', '--format=tar', `${ref}:modules/${moduleName}`],
    { maxBuffer: 512 * 1024 * 1024 },
  )
  execFileSync('tar', ['-x', '-C', targetPath], { input: tar, maxBuffer: 512 * 1024 * 1024 })

  const files = hashTree(targetPath)
  console.log(`  ✓ extracted ${Object.keys(files).length} files from ${sourceSha.slice(0, 8)}`)

  // ── Record provenance ─────────────────────────────────────────────────────
  const manifest: VendorManifest = {
    module: moduleName,
    sourceRef: ref,
    sourceSha,
    sourceTree,
    vendoredAt: new Date().toISOString(),
    files,
  }
  writeFileSync(join(targetPath, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`  ✓ wrote ${MANIFEST_NAME}`)

  // ── Patch the workspace ───────────────────────────────────────────────────
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

  console.log(`\n✅ ${moduleName} vendored from ${sourceSha.slice(0, 8)}`)
  console.log(`\nNext steps:`)
  console.log(`  cd ${relative(CWD, skeletonRoot) || '.'}`)
  console.log(`  bun install`)
  console.log(`  bun run test`)
  console.log(`\nCommit ${workspaceEntry}/${MANIFEST_NAME} — it is what makes the next pull safe.`)
}

main()
