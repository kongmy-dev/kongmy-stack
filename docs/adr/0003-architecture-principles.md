# ADR-0003 — Architecture principles: DI, file shape, DDD, modular monolith, packages, monorepo

**Status:** accepted 2026-07-13

## DI — the principle without the machinery

DI exists as the `ctx` parameter; no container, no decorators/`reflect-metadata`, no service locator, no factory ceremony.

- **Two-level ctx, built at exactly one place each:** app-level deps (`db`, `queue`, `config`, adapters) constructed once at each entrypoint's composition root (`main.ts`); request-level ctx (`tenant`, `user`, `logger`) derived per request in one middleware. Nothing below those two points constructs its own dependencies.
- **Inject I/O, import purity:** services receive `ctx` because effects must be fakeable in tests; `packages/core` pure functions are imported directly — injecting deterministic functions is cargo-cult DI.

## File shape — legislate concerns, not line counts

No max-lines CI rule (proxy metric, invites gaming). Controls: one resource per route/service file (the generator emits this granularity), `features/` slices keep related code adjacent, dep-cruiser catches import sprawl. Heuristics: a file needing section-divider comments should split; ~400 lines is a review smell. Lean small for agent-driven editing — small focused files make automated edits surgical and diffs reviewable.

## DDD — strategic 20%, not tactical 80%

**Adopt:** ubiquitous language (contract schema names ARE the domain names), value objects (Money/Weight), domain events (events module), bounded contexts (materialized as apps + core packages), aggregate-style transactional boundaries where needed via the command door + decider.

**Refuse:** entity/aggregate base classes, repository-per-aggregate dogma, CQRS/event-sourcing as default (decider+outbox is opt-in for the `platform` archetype), four-layer hexagonal naming. The stack has exactly one layer vocabulary: `contract / core / db / apps` with routes → services → repos. Two competing vocabularies is how conventions die; ours wins because it is the enforced one.

## Modular monolith — named and default

Every archetype is a **modular monolith with multiple entrypoints**: one repo, one domain layer, several thin mains (`api`, `worker`, `cron`) sharing the same packages. Module boundaries enforced by dep-cruiser instead of network calls — microservice isolation at zero distributed-systems cost. Split a service out only on *demonstrated* independent-scaling need or hard runtime mismatch; never for "clean separation" (the import rules already deliver that). For a solo dev, a microservice is a monolith you deploy n times.

## Package separation — packages are for sharing, not taxonomy

**A package exists only when 2+ apps/entrypoints consume it.** Skeleton ships exactly three (`contract`, `core`, `db`); that number should feel sticky. Everything else is a folder inside an app until sharing is proven (promote-when-proven, applied inward). Anti-pattern on record: `shared-types`/`shared-utils`/`shared-ui` filing-cabinet sprawl. Vendored modules copy into existing structure; they don't each become a package.

## Monorepo — per-product, never umbrella

Within a project: bun workspaces, `workspace:*` internal refs (no internal versioning), one lockfile, one `bun run ci`, no Turbo, no tsc project-references gymnastics (negative value at 3 packages + 3 apps). Across projects: **repo per product/client**, uniform because they share the template — client handoff, licensing isolation, and public/private boundaries demand repo separation, and the template makes separation cheap. kongmy-stack is a progenitor, not a parent.

## Meta-rules (all six answers reduce to these)

1. **Enforce with the compiler and CI, not with vocabulary.** DI containers, DDD layer names, and package taxonomies are naming systems pretending to be enforcement.
2. **Promote-when-proven.** A package, a service split, an event system, an abstraction — each earns existence via a second consumer or demonstrated need, never anticipation.
