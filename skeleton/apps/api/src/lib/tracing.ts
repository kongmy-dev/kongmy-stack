/**
 * Tracing seam per ADR-0010: W3C trace propagation + request spans.
 *
 * The seam is the OTel API shape (trace(), span context extraction/injection);
 * the default exporter is console (no collector). OTLP activated via env vars.
 *
 * This is a minimal implementation that avoids pulling the full OTel SDK,
 * because the SDK adds Node-specific dependencies that don't work cleanly
 * in Bun/Workers. Instead, we implement W3C traceparent parsing/generation
 * ourselves and expose the same interface `{traceId, spanId, traceparent()}`.
 *
 * Reference: https://www.w3.org/TR/trace-context/
 * Format: traceparent = version-traceId-parentId-traceFlags
 *   version:    2 hex digits (always "00" for v1)
 *   traceId:    32 hex digits
 *   parentId:   16 hex digits
 *   traceFlags: 2 hex digits (sampled=01, not sampled=00)
 */

/**
 * Generate a random hex string of the given length.
 */
function randomHex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse W3C traceparent header.
 * Returns {traceId, parentId, traceFlags} or null if invalid.
 */
function parseTraceparent(header: string): {
  traceId: string;
  parentId: string;
  traceFlags: string;
} | null {
  // Format: version-traceId-parentId-traceFlags
  const parts = header.split("-");
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, traceFlags] = parts;

  // Validate format
  if (version !== "00") return null; // Only support v1
  if (!/^[0-9a-f]{32}$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(parentId)) return null;
  if (!/^[0-9a-f]{2}$/.test(traceFlags)) return null;

  return { traceId, parentId, traceFlags };
}

/**
 * Generate a new traceparent header.
 * If incomingTraceparent is provided and valid, continues that trace.
 * Otherwise, starts a new one.
 */
function generateTraceparent(incomingTraceparent?: string): {
  traceId: string;
  spanId: string;
  traceparent: string;
} {
  let traceId: string;
  let traceFlags = "01"; // Sampled

  // Parse incoming traceparent if provided
  if (incomingTraceparent) {
    const parsed = parseTraceparent(incomingTraceparent);
    if (parsed) {
      traceId = parsed.traceId;
      traceFlags = parsed.traceFlags;
    } else {
      // Invalid format — start fresh
      traceId = randomHex(32);
    }
  } else {
    traceId = randomHex(32);
  }

  // Generate a new span ID for this request
  const spanId = randomHex(16);

  // Format: version-traceId-spanId-traceFlags
  const traceparent = `00-${traceId}-${spanId}-${traceFlags}`;

  return { traceId, spanId, traceparent };
}

/**
 * Request-local tracing context exposed on AppContext.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  /**
   * Returns the traceparent header value for propagating the trace downstream.
   */
  traceparent(): string;
  /**
   * Request start time for computing duration in metrics.
   */
  startTime: number;
}

/**
 * Extract tracing context from incoming request headers.
 * Call this in the context middleware to populate trace IDs.
 */
export function extractTraceContext(incomingTraceparent?: string): TraceContext {
  const { traceId, spanId, traceparent: traceparentHeader } =
    generateTraceparent(incomingTraceparent);

  return {
    traceId,
    spanId,
    traceparent: () => traceparentHeader,
    startTime: Date.now(),
  };
}

/**
 * Console exporter for tracing spans (default, no collector needed).
 * Exported span data is structured JSON logged to stdout.
 *
 * In production, set OTEL_EXPORTER_OTLP_ENDPOINT to send to a collector instead.
 */
export interface Span {
  name: string;
  traceId: string;
  spanId: string;
  startTime: number;
  endTime: number;
  attributes?: Record<string, unknown>;
}

export function exportSpanConsole(span: Span): void {
  console.log(
    JSON.stringify({
      level: "span",
      name: span.name,
      traceId: span.traceId,
      spanId: span.spanId,
      duration: span.endTime - span.startTime,
      attributes: span.attributes,
    })
  );
}

/**
 * Placeholder for OTLP exporter (activated via OTEL_EXPORTER_OTLP_ENDPOINT env var).
 * In a real app, this would serialize and POST spans to the collector.
 * For now, we just console.log a note that OTLP is configured.
 */
export async function exportSpanOTLP(span: Span, endpoint: string): Promise<void> {
  // TODO: Implement OTLP export when a collector is available
  // For now, just log that OTLP is configured
  if (process.env.DEBUG) {
    console.log(`[OTLP] Would export span to ${endpoint}: ${span.name}`);
  }
}
