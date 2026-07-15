/**
 * Metrics seam per ADR-0010: RED metrics (Rate, Errors, Duration).
 *
 * Middleware-collected metrics per route class (method + path pattern):
 * - request_count: total requests by route, method
 * - request_errors: error count by route, method, status
 * - request_duration: histogram of request durations by route, method
 *
 * Domain counters via ctx.meter:
 * - Custom business counters (e.g., invoices_created_total)
 * - Exposed alongside RED metrics
 *
 * Export: optional GET /metrics endpoint (Prometheus text format) gated by env flag.
 */

/**
 * In-memory metric storage (replaced with persistent store in production).
 */
interface MetricBucket {
  [key: string]: number;
}

interface HistogramBuckets {
  [key: string]: number[];
}

export interface MetricStore {
  // RED counters
  requestCount: MetricBucket;
  requestErrors: MetricBucket;
  // Histogram: route -> durations in ms
  requestDurations: HistogramBuckets;
  // Domain counters
  domainCounters: MetricBucket;
}

const metrics: MetricStore = {
  requestCount: {},
  requestErrors: {},
  requestDurations: {},
  domainCounters: {},
};

/**
 * Meter API exposed on ctx.meter for domain-specific counters.
 */
export interface Meter {
  inc(name: string, labels?: Record<string, string>): void;
  add(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * Create a meter instance for a request.
 */
export function createMeter(): Meter {
  return {
    inc: (name: string, labels?: Record<string, string>) => {
      const key = formatMetricKey(name, labels);
      metrics.domainCounters[key] = (metrics.domainCounters[key] || 0) + 1;
    },
    add: (name: string, value: number, labels?: Record<string, string>) => {
      const key = formatMetricKey(name, labels);
      metrics.domainCounters[key] = (metrics.domainCounters[key] || 0) + value;
    },
  };
}

/**
 * Format metric key from name and optional labels.
 */
function formatMetricKey(
  name: string,
  labels?: Record<string, string>
): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name;
  }
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return `${name}{${labelStr}}`;
}

/**
 * Record a request in RED metrics.
 */
export function recordRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  const routeKey = `${method} ${normalizeRoute(path)}`;

  // Request count
  const countKey = `${routeKey}`;
  metrics.requestCount[countKey] = (metrics.requestCount[countKey] || 0) + 1;

  // Error count (4xx, 5xx)
  if (statusCode >= 400) {
    const errorKey = `${routeKey} ${statusCode}`;
    metrics.requestErrors[errorKey] = (metrics.requestErrors[errorKey] || 0) + 1;
  }

  // Duration histogram
  if (!metrics.requestDurations[routeKey]) {
    metrics.requestDurations[routeKey] = [];
  }
  metrics.requestDurations[routeKey].push(durationMs);
}

/**
 * Normalize route paths: /invoices/{id} → /invoices/{id}
 * (avoid cardinality explosion from unique IDs)
 */
function normalizeRoute(path: string): string {
  // Replace ULIDs and UUIDs with {id}
  return path.replace(/\/[a-z0-9_-]{26,}/gi, "/{id}");
}

/**
 * Export metrics in Prometheus text format.
 * See: https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function exportMetricsText(): string {
  const lines: string[] = [];

  lines.push("# HELP request_count Total HTTP requests");
  lines.push("# TYPE request_count counter");
  for (const [key, value] of Object.entries(metrics.requestCount)) {
    lines.push(`request_count{${key}} ${value}`);
  }
  lines.push("");

  lines.push("# HELP request_errors_total Total HTTP errors");
  lines.push("# TYPE request_errors_total counter");
  for (const [key, value] of Object.entries(metrics.requestErrors)) {
    lines.push(`request_errors_total{${key}} ${value}`);
  }
  lines.push("");

  lines.push("# HELP request_duration_ms Request duration in milliseconds");
  lines.push("# TYPE request_duration_ms histogram");
  for (const [route, durations] of Object.entries(metrics.requestDurations)) {
    const count = durations.length;
    const sum = durations.reduce((a, b) => a + b, 0);
    lines.push(
      `request_duration_ms_bucket{route="${route}",le="50"} ${durations.filter((d) => d <= 50).length}`
    );
    lines.push(
      `request_duration_ms_bucket{route="${route}",le="100"} ${durations.filter((d) => d <= 100).length}`
    );
    lines.push(
      `request_duration_ms_bucket{route="${route}",le="500"} ${durations.filter((d) => d <= 500).length}`
    );
    lines.push(
      `request_duration_ms_bucket{route="${route}",le="1000"} ${durations.filter((d) => d <= 1000).length}`
    );
    lines.push(
      `request_duration_ms_bucket{route="${route}",le="+Inf"} ${count}`
    );
    lines.push(
      `request_duration_ms_sum{route="${route}"} ${sum}`
    );
    lines.push(`request_duration_ms_count{route="${route}"} ${count}`);
  }
  lines.push("");

  lines.push("# HELP domain_counters Custom domain counters");
  lines.push("# TYPE domain_counters counter");
  for (const [key, value] of Object.entries(metrics.domainCounters)) {
    lines.push(`domain_counters{${key}} ${value}`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Reset metrics (for testing).
 */
export function resetMetrics(): void {
  metrics.requestCount = {};
  metrics.requestErrors = {};
  metrics.requestDurations = {};
  metrics.domainCounters = {};
}

/**
 * Get raw metrics object (for testing/inspection).
 */
export function getMetrics(): MetricStore {
  return { ...metrics };
}
