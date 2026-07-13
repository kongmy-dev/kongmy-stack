# ADR-0008 — AuthZ: contract-derived permission matrix (ERPNext-convertible)

**Status:** accepted 2026-07-13 · closes the AUTHZ-PENDING fence

## Model

Layer 0 (already in place): tenant isolation via `withScope`. Within a tenant:

1. **Permission ids are DERIVED from contracts, never hand-authored:** `resource('invoice')` → `invoice:read|create|update|delete`; `action('send')` → `invoice:send`. The permission vocabulary cannot drift from the API because it IS the API (SSOT applied to authz; same rule that bans hand-written tool schemas).
2. **Roles are tenant-scoped DATA, not code:** `Role { id, tenantId, name, permissions: string[] }`, seeded defaults per product; per-client customization is an UPDATE, not a release (ERPNext Role-Profile lesson).
3. **Membership carries roles + scope constraints:** `Membership { userId, tenantId, roles[], scopes?: { branchIds?[] , ... } }` — scopes enforced inside `withScope` (ERPNext User-Permission equivalent; Aurum's org/branch two-level tenancy anticipated this).
4. **Owner predicate** where declared: `can('invoice:update', row)` passes on permission OR ownership rule (ERPNext `if_owner`).
5. **ONE authoritative enforcement point:** service entry / command door via `ctx.authz.assert(perm)`. Route middleware is early-reject convenience only. MCP does not pass through REST middleware — tools and routes MUST hit the same check.
6. **MCP `tools/list` filtered by `can()`** — an agent only sees tools its principal may call. Composes with autonomy: **permission = whether you may; autonomy level = how autonomously.** Orthogonal axes, one declaration each.
7. **No field-level masking.** Field visibility differences = explicit contract variants (`invoiceAdminView` vs `invoiceMemberView`). Dynamic masking breaks generated types and agent legibility (deliberate divergence from ERPNext permlevel).
8. Declaration on the contract: derived by default; `requires:` override for exceptions only.

## ERPNext convertibility (verified against frappe source shapes)

Sync scenario: a stack app running beside ERPNext imports its permission config into roles-as-data. Verified mapping (frappe `docperm.json`, `user_permission.json`, `role.json`):

| ERPNext | fields | → kongmy-stack |
|---|---|---|
| `DocPerm` | role, read/write/create/delete/submit/cancel/amend | rows → permission grants: doctype≈resource, verbs→`resource:action`; submit/cancel/amend → action perms on lifecycle commands (`invoice:submit` …) |
| `DocPerm.if_owner` | boolean | owner predicate flag on the grant |
| `User Permission` | user, allow (doctype), for_value | membership `scopes` entries (row-level constraint by value) |
| `Role` | role_name, is_custom | Role rows (roles-as-data — same philosophy) |
| `DocPerm` extra verbs | report/export/import/share/print/email | UI capabilities, not API permissions — dropped on import (or mapped to custom actions when a real need exists) |
| `DocPerm.permlevel` > 0 | field-level | **dropped with a logged warning** — represent as contract variants if the requirement is real (rule 7) |

Both models are matrices keyed `(role, resource, action)` + row-level constraints keyed `(user, resource, value)` — ours is a normalized subset, so an importer is a straightforward projection. The importer itself lives in the **connector module** and is built when a project actually syncs with ERPNext (promote-when-proven).

## Storage

`roles`, `memberships` tables in `packages/db` (skeleton); grants checked via an in-ctx resolved permission set (computed at session load, cached per request). No policy engine, no DSL.
