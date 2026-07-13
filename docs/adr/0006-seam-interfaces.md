# ADR-0006 — Seam interfaces: contract now, implementation on first pull

**Status:** accepted 2026-07-13

Each seam below gets its **interface + fake defined in the skeleton day 1** (so services/tests code against it), with real implementations arriving when the first project pulls them. This is promote-when-proven applied to integrations: the interface is the cheap, stable part; implementations are pulled, never anticipated.

## Storage (blob/file)
- Interface: `put/get/delete/presignUpload(key, opts)`. Convention: **presigned direct upload** (client → storage), API only mints the URL and records metadata — request bodies never carry files.
- Impls on pull: R2/S3 (same API), local FS (dev/on-prem). Key convention: `{tenant}/{domain}/{ulid}.{ext}`.

## Notifier
- Interface: `notify(channel, template, params, recipient)` — one seam for email + chat (Telegram/Lark) so business code never knows the transport.
- Impls on pull: Resend (email), Telegram bot, Lark webhook. Templates live with the module, params typed by zod (same describe/no-any rules as contracts).

## Realtime
- **SSE is the default** (Hono `streamSSE`); WebSocket only when genuinely bidirectional need is demonstrated.
- Convention: `GET /api/<resource>/events`, events carry the canonical envelope's `type` + minimal payload; client re-fetches via Query invalidation rather than trusting event payloads as state.

## HTTP caching
- Convention: explicit `Cache-Control` per route class — `no-store` default for authed API, `public, max-age` + ETag only on deliberately cacheable public reads. A route helper sets it; silence = `no-store` (safe default).
- KV/Redis object caching: not in the skeleton; arrives with a demonstrated hot path (escalation path per queue ADR applies).

## Tenant lifecycle
- Lives beside `withScope`: `scripts/new-tenant.ts` (provision + seed), tenant status field (active/suspended), and the **impersonation pattern** (support user assumes tenant ctx; audited via the command door; visually marked in web shell).
