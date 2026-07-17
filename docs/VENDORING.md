# Vendoring modules

Modules in `modules/` are **copyable source, not packages**. You vendor a module into your repo, you
own the copy, and you diverge freely. Nothing here is published to npm and nothing you build takes a
versioned dependency on this repo. That is the whole distribution model — see `CLAUDE.md`.

This document is the process. It is product-neutral on purpose: per-consumer pull notes get written
for one team and then deleted when the repo is scrubbed for public release, and the knowledge in
them goes with it.

## Pulling a module

```bash
bun scripts/add.ts <module> --into /path/to/your-repo
```

That extracts `modules/<module>` **at a commit** (default `HEAD`) into `<your-repo>/packages/<module>`,
writes a `.vendor.json` provenance file, and adds the workspace entry. Then:

```bash
cd /path/to/your-repo && bun install && bun run test
```

Pin a specific commit or tag with `--ref`:

```bash
bun scripts/add.ts events --ref v0.3.0 --into /path/to/your-repo
```

### Check both repos, not just yours

The natural precondition to check is your own working tree — "am I about to lose local edits?" That
is the wrong half. **The source is where the bytes come from.** A vendor pull that copies the source
*working tree* will happily ship someone's uncommitted work-in-progress into your repo, attributed
to no commit, and your CI will go green and tell you nothing.

`add.ts` vendors from a git ref for exactly this reason, and refuses when either side is ambiguous:

| Refusal | Why | Override |
|---|---|---|
| Source module is dirty | Your uncommitted upstream edits are **not** what would be vendored — `<ref>` is. Silently vendoring `HEAD` while you have WIP open is its own trap. | commit them, or `--ref <ref>` to confirm you mean the committed state |
| Target repo is dirty | You lose the ability to review the pull as a diff | commit/stash, or `--force` |
| Target copy diverged from `.vendor.json` | Your copy carries a local patch. Re-vendoring destroys it. | `--force` |
| Target copy has no `.vendor.json` | It predates provenance; a local patch in it is undetectable, so the tool will not guess | `--force` |

### Commit `.vendor.json`

It records the module, the source sha, and a hash per file:

```json
{
  "module": "events",
  "sourceRef": "HEAD",
  "sourceSha": "c487879010c4142635cdd8036abe48e2d954aa54",
  "sourceTree": "2bb0cb5aefdb16ec010aea55e590aba87951fe1a",
  "vendoredAt": "2026-07-17T10:40:20.377Z",
  "files": { "src/outbox.ts": "…", "…": "…" }
}
```

It answers two questions that are otherwise unanswerable once a copy is in your tree: **which sha is
this?** and **have we patched it since?** The second is what makes a re-pull safe — a committed local
patch looks perfectly clean to a `git status` check and would otherwise be overwritten without a
word.

You do not need a `PATCHES.md` convention. If you patch a vendored module, the next `add.ts` will
stop and list the files you touched.

## If you patch a vendored module

You own the copy, so patching it is allowed and sometimes correct. But a patch you must re-apply on
every pull is a tax. Prefer, in order:

1. **Land it upstream**, then re-vendor. Best for anything that is a plain bug or a portability fix
   — those are usually not specific to you.
2. **Patch locally** and let `.vendor.json` protect it. `add.ts` will refuse to clobber it and tell
   you which files diverged.

## Pull the tests even when you use none of the code

A vendored module's **tests run in your CI**. This is the part that surprises people.

If you took a module and rebuilt half of it — you call none of its persistence, say, because you
wrote your own — it is tempting to conclude that a fix to that half is "nothing to pull". That
reasons about the code you *call*. It ignores that you also vendored a test suite, and that suite is
in your pipeline: it costs your CI memory, its exit code is your exit code, and its bugs are yours.

One consumer's vendored copy of a single leaking test file was ~90% of their entire CI memory peak
while they called none of the code it tested. **If you vendor a module, pull its test fixes too.**

## Running a module's tests

`bun test` runs a package's files in **one process**. That masks per-file problems: a file that
leaks a database handle and exits non-zero on its own can sit inside a green suite indefinitely,
because whatever makes it fail alone does not surface when five other files run alongside it.

If you run one process per test file (a reasonable thing to do — WASM heaps like PGlite's are never
returned to the OS, so a process is the only thing that truly frees them), you will find these. Both
shapes are worth checking:

```bash
bun test                       # what CI runs — green
bun test tests/one.test.ts     # what finds the leak — exit 99, every test passing
```

Open one handle per test and close it in `afterEach`, not with a trailing `close()` — a trailing
close leaks whenever a test throws early.

## The example is the API

Whatever a module's README shows in its usage block is what consumers copy, and therefore what they
run in production. A documented precondition that the example quietly violates will be violated by
everyone. If an example is wrong, that is a defect in the module, not in the reader.
