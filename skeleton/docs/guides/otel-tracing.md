# Observability: Tracing & Metrics (ADR-0010)

This guide explains the tracing and metrics seam implemented per ADR-0010 in `skeleton/apps/api/src/lib/tracing.ts` and `skeleton/apps/api/src/lib/metrics.ts`.

## Quick Start

**By default, tracing and metrics are enabled with console output.** No setup needed — just run the app.

```bash
bun run dev
# Requests logged to stdout with traceId, spanId, metrics available at GET /metrics
```

## Overview

### Three Concerns (ADR-0010)

1. **Logs** — Structured JSON logs with traceId/spanId for correlation
2. **Audit** — Append-only table at the command door (separate from logs, not covered here)
3. **Tracing** — W3C traceparent propagation + request spans
4. **Metrics** — RED (Rate, Errors, Duration) per route class + domain counters

### Architecture

- **Seam interface**: OTel API shape (`traceId`, `spanId`, `traceparent()` function)
- **Default exporter**: Console (structured JSON), no collector needed
- **OTel exporter**: Activated via `OTEL_EXPORTER_OTLP_ENDPOINT` env var (future; not implemented yet)
- **Metrics storage**: In-memory (replaced with persistent store in production)

## Components

### 1. Tracing Seam (`lib/tracing.ts`)

Implements W3C trace propagation without pulling the full OTel SDK (which adds Node-specific dependencies).

#### Key Functions

- `extractTraceContext(incomingTraceparent?)` — Parse incoming traceparent header or generate a new trace
- `exportSpanConsole(span)` — Log a span to stdout (default exporter)

#### Context Injection

On each request, the middleware creates a `trace` context:

```typescript
interface TraceContext {
  traceId: string;           // 32 hex digits
  spanId: string;            // 16 hex digits
  traceparent(): string;     // "00-{traceId}-{spanId}-01"
  startTime: number;         // Date.now()
}
```

This is exposed on `ctx.trace` in handlers and services.

#### Traceparent Propagation

**Request → Middleware**

```
Incoming header:  traceparent: 00-{traceId}-{oldSpanId}-01
                                         ↓
                        extractTraceContext()
                                         ↓
Response header:  traceparent: 00-{traceId}-{newSpanId}-01
                                                   ↑
                                        (new span per request)
```

This enables end-to-end trace correlation across service boundaries.

### 2. Metrics Seam (`lib/metrics.ts`)

Collects RED metrics (Rate, Errors, Duration) via middleware and domain counters via `ctx.meter`.

#### RED Metrics

Middleware records:
- **Rate**: Request count by route (normalized to avoid cardinality explosion)
- **Errors**: Count by route + status code
- **Duration**: Histogram buckets (50ms, 100ms, 500ms, 1000ms, +Inf)

```typescript
recordRequest(method, path, statusCode, durationMs);
```

Paths are normalized: `/invoices/{id}` (UUIDs/ULIDs replaced with `{id}`)

#### Domain Counters

Services use `ctx.meter` to emit domain-specific counters:

```typescript
// In services/invoice.ts
ctx.meter.inc("invoices_created_total");
ctx.meter.add("invoice_total_amount", amount);
```

#### Prometheus Exposition

Metrics are exported in Prometheus text format at `GET /metrics`:

```
# HELP request_count Total HTTP requests
# TYPE request_count counter
request_count{GET /invoices} 42

# HELP request_errors_total Total HTTP errors
# TYPE request_errors_total counter
request_errors_total{GET /invoices 500} 2

# HELP request_duration_ms Request duration in milliseconds
# TYPE request_duration_ms histogram
request_duration_ms_bucket{route="GET /invoices",le="50"} 10
request_duration_ms_bucket{route="GET /invoices",le="100"} 25
request_duration_ms_bucket{route="GET /invoices",le="500"} 39
request_duration_ms_bucket{route="GET /invoices",le="+Inf"} 42
request_duration_ms_sum{route="GET /invoices"} 2150
request_duration_ms_count{route="GET /invoices"} 42

# HELP domain_counters Custom domain counters
# TYPE domain_counters counter
domain_counters{invoices_created_total} 15
domain_counters{invoice_total_amount} 50000
```

## Wiring in `main.ts`

### Context Addition

The context middleware now:
1. Extracts `traceparent` header from incoming request
2. Creates trace context via `extractTraceContext()`
3. Exposes `ctx.trace` and `ctx.meter` to handlers/services
4. Logs include `traceId`, `spanId`, `requestId`

### Middleware Stack

```typescript
// Metrics middleware: runs before + after request
app.use("*", async (ctx, next) => {
  const startTime = Date.now();
  await next();
  const durationMs = Date.now() - startTime;
  recordRequest(ctx.req.method, ctx.req.path, ctx.res.status, durationMs);
  
  // Set traceparent response header
  if (ctx.trace) {
    ctx.header("traceparent", ctx.trace.traceparent());
  }
});
```

### `/metrics` Endpoint

```typescript
app.get("/metrics", (ctx) => {
  return ctx.text(exportMetricsText(), 200, {
    "content-type": "text/plain; charset=utf-8",
  });
});
```

## Configuration

### Environment Variables

```bash
# Optional: OTLP collector endpoint (not yet implemented)
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Optional: Enable tracing (default: false, console always on)
# OTEL_TRACE_ENABLED=true
```

See `.env.example` for current defaults.

## Example: Viewing Traces in Logs

A typical request log:

```json
{
  "level": "info",
  "message": "invoice_created",
  "requestId": "req_1705513200000",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "invoiceId": "inv_01234567890123456789012345",
  "auditId": "audit_98765432109876543210987654"
}
```

Combined with request-level metrics at `/metrics`:

```
request_count{POST /invoices} 1
request_duration_ms_bucket{route="POST /invoices",le="500"} 1
domain_counters{invoices_created_total} 1
```

## Testing

### Unit Tests

- `lib/tracing.test.ts` — W3C traceparent parsing/generation
- `lib/metrics.test.ts` — RED metric collection, domain counters, Prometheus export

### Integration Tests

- `integration/tracing-metrics.integration.test.ts` — End-to-end verification:
  - Traceparent propagation (request → response)
  - Trace IDs in logs
  - RED metrics + domain counters
  - `/metrics` endpoint

Run all tests:

```bash
bun test
```

Run tracing tests only:

```bash
bun test apps/api/src/lib/tracing.test.ts
```

## Production Use

### Console → Collector Migration

To export to an OpenTelemetry collector (e.g., Jaeger, Tempo, Honeycomb):

1. **Set the collector endpoint**:
   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.example.com:4318
   ```

2. **Implement OTLP exporter** in `lib/tracing.ts`:
   ```typescript
   async function exportSpanOTLP(span: Span, endpoint: string): Promise<void> {
     // POST to /v1/traces with OTLP protobuf or JSON
   }
   ```

3. **Add meter forwarding** in `lib/metrics.ts` for real metric backends:
   ```typescript
   // Push to Prometheus, StatsD, or CloudWatch
   ```

### Metrics Scraping

Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: "api"
    static_configs:
      - targets: ["localhost:3000"]
    metrics_path: "/metrics"
```

## Limitations & Next Steps

### Current

- **Metrics storage**: In-memory only (resets on restart)
- **OTLP export**: Not implemented (console only)
- **Distributed tracing**: Spans logged to console, not sent to collector
- **Sampling**: All traces sampled (no dynamic sampling policy)

### Future

1. Implement OTLP exporter to send spans to Jaeger/Tempo
2. Add persistent metrics store (ClickHouse, Prometheus remote write)
3. Add dynamic sampling per `OTEL_SAMPLER_*` env vars
4. Add span links for causality tracking
5. Add W3C baggage propagation for cross-cutting concerns

### Queue Job Propagation (Out of Scope, ADR-0010 Note)

ADR-0010 specifies that traceparent should propagate through queue jobs:

```typescript
// In modules/queue enqueue():
const traceparent = ctx.trace.traceparent();
await queue.enqueue({ payload, metadata: { traceparent } });

// In modules/queue worker:
const parentTraceparent = job.metadata.traceparent;
const trace = extractTraceContext(parentTraceparent);
```

This is documented but not implemented in the skeleton. Consumers adding the queue module should follow this pattern.

## Troubleshooting

### "traceparent not in response headers"

Check that the metrics middleware runs **after** the context middleware:

```typescript
// WRONG: traceparent not set yet
app.use("*", responseTraceMiddleware);
app.use("*", contextMiddleware);

// CORRECT
app.use("*", contextMiddleware);
app.use("*", responseTraceMiddleware);
```

### "Trace IDs not in logs"

Ensure `createMockLogger` includes trace context:

```typescript
const mockLogger = {
  info: (msg, data) => {
    console.log(JSON.stringify({
      level: "info",
      message: msg,
      requestId,
      traceId: trace.traceId,  // <- ensure this
      spanId: trace.spanId,    // <- and this
      ...data,
    }));
  },
};
```

### "Metrics endpoint returns 404"

The `/metrics` endpoint is unconditionally enabled. If you see 404, check that it's being registered in `createApp()`:

```typescript
app.get("/metrics", (ctx) => {
  return ctx.text(exportMetricsText(), 200, {
    "content-type": "text/plain; charset=utf-8",
  });
});
```

## References

- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry API](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
- [Prometheus Metrics Format](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [ADR-0010: Logs ≠ Audit ≠ Events](../adr/0010.md)
