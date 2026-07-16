# ADR-0010 — Audit, OTel-compliant tracing, metrics (upgrades ADR-0005 observability)

**Status:** accepted 2026-07-13

Three distinct records, never conflated:
- **Logs** = operator debugging (may be discarded)
- **Audit** = business accountability (append-only, queryable by entity, shown to users)
- **Events** = domain facts for integration (ADR-0006/events module)

## Audit (baseline, skeleton-level)

- Append-only `audit_log` table: `{ id, tenantId, actorId, action, entityRef (type + prefixed-ULID), requestId, at, summary, diff? }`.
- **Written at the command door** — one write point, automatically covering REST, MCP tools, and agent-initiated commands (actor = user or agent principal; autonomy level recorded for agent actions).
- Reads (GETs) are not audited by default; sensitive-read auditing is per-resource opt-in.
- UI convention: entity detail pages show an Activity section fed by `entityRef`; deep-links both ways.
- `diff` = before/after field diff for updates, computed in the command helper, excluded for large payloads. No custom audit lib — this is ~100 lines over the existing envelope.

## Tracing — OTel-compliant

- **W3C `traceparent` propagation**: honored inbound, generated at edge otherwise, propagated to outbound fetch and queue jobs (carried in job payload envelope).
- One request span per request; ctx logger lines carry `trace_id`/`span_id` (JSON fields) so logs correlate with traces without a vendor.
- **OTel API as the seam, exporter as config:** code touches only the OTel API surface (tracer/meter from ctx); OTLP endpoint via env (`OTEL_EXPORTER_OTLP_ENDPOINT`), console/no-op default. No collector infrastructure assumed.
- Runtime caveat: full OTel SDK is Node/Bun-safe; on Workers use the lightweight shim path (interface identical — it's a seam like everything else).

## Metrics

- **RED by default** (rate/errors/duration per route class) from one middleware — free with the request span.
- Domain counters/gauges via `ctx.meter` (OTel metrics API) — used sparingly, named `domain_thing_total`.
- Export: OTLP when configured; optional `/metrics` Prometheus endpoint per deploy recipe (systemd lane pairs with a scraper; Workers lane skips it).
- Queue instrumentation: job duration/failure counters ship inside the queue module, same meter seam.

## Business metrics — NOT OTel (three-tier measurement model)

| Tier | Source | Properties | Consumer |
|---|---|---|---|
| Infra metrics (RED) | OTel middleware | lossy, restart-reset, near-real-time | Grafana/ops via OTLP or `/metrics` |
| Operational counters | `ctx.meter` | lossy OK, trend-only | same |
| **Business metrics** | **SQL over domain tables + events/audit** | exact, auditable, reproducible | admin app via contract endpoints (Stat/DataTable blocks), reports |

Rule: revenue, AR aging, conversion, utilization — anything a human makes a decision on — is **derived by query from domain data** (e.g. P&L/balance-sheet/aging are queries over GL), never accumulated in OTel counters (lossy + unauditable). Where a business metric isn't naturally in tables, the **events module provides the projection path** (facts → projection table → query). Report endpoints are ordinary contracts, so business metrics are automatically typed, permissioned (ADR-0008), and MCP-exposed — an agent can ask for the numbers through the same door.
