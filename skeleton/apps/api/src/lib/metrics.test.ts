/**
 * Metrics seam tests per ADR-0010.
 *
 * Verifies:
 * - RED metric collection (Rate, Errors, Duration)
 * - Domain counter collection
 * - Metrics export in Prometheus text format
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createMeter,
  recordRequest,
  exportMetricsText,
  resetMetrics,
  getMetrics,
} from "./metrics.js";

describe("Metrics (ADR-0010)", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("recordRequest (RED metrics)", () => {
    it("counts requests by route", () => {
      recordRequest("GET", "/invoices", 200, 50);
      recordRequest("GET", "/invoices", 200, 45);
      recordRequest("GET", "/invoices/{id}", 200, 30);

      const metrics = getMetrics();
      expect(metrics.requestCount["GET /invoices"]).toBe(2);
      expect(metrics.requestCount["GET /invoices/{id}"]).toBe(1);
    });

    it("normalizes route paths to avoid cardinality explosion", () => {
      recordRequest("GET", "/invoices/inv_01234567890123456789012345", 200, 50);
      recordRequest("GET", "/invoices/inv_98765432109876543210987654", 200, 45);

      const metrics = getMetrics();
      // Both should be counted under the same normalized route
      expect(metrics.requestCount["GET /invoices/{id}"]).toBe(2);
    });

    it("counts errors separately", () => {
      recordRequest("GET", "/invoices", 200, 50);
      recordRequest("GET", "/invoices", 400, 60);
      recordRequest("GET", "/invoices", 500, 70);

      const metrics = getMetrics();
      expect(metrics.requestCount["GET /invoices"]).toBe(3);
      expect(metrics.requestErrors["GET /invoices 400"]).toBe(1);
      expect(metrics.requestErrors["GET /invoices 500"]).toBe(1);
    });

    it("records duration histogram", () => {
      recordRequest("POST", "/invoices", 201, 100);
      recordRequest("POST", "/invoices", 201, 150);
      recordRequest("POST", "/invoices", 201, 80);

      const metrics = getMetrics();
      expect(metrics.requestDurations["POST /invoices"]).toContain(100);
      expect(metrics.requestDurations["POST /invoices"]).toContain(150);
      expect(metrics.requestDurations["POST /invoices"]).toContain(80);
    });
  });

  describe("Meter (domain counters)", () => {
    it("increments domain counter", () => {
      const meter = createMeter();
      meter.inc("invoices_created_total");
      meter.inc("invoices_created_total");

      const metrics = getMetrics();
      expect(metrics.domainCounters["invoices_created_total"]).toBe(2);
    });

    it("adds arbitrary values to counter", () => {
      const meter = createMeter();
      meter.add("invoice_total_amount", 1000);
      meter.add("invoice_total_amount", 500);

      const metrics = getMetrics();
      expect(metrics.domainCounters["invoice_total_amount"]).toBe(1500);
    });

    it("supports labeled counters", () => {
      const meter = createMeter();
      meter.inc("invoices_created_total", { status: "draft" });
      meter.inc("invoices_created_total", { status: "posted" });
      meter.inc("invoices_created_total", { status: "draft" });

      const metrics = getMetrics();
      expect(metrics.domainCounters['invoices_created_total{status="draft"}']).toBe(2);
      expect(metrics.domainCounters['invoices_created_total{status="posted"}']).toBe(1);
    });
  });

  describe("exportMetricsText (Prometheus format)", () => {
    it("exports empty metrics", () => {
      const text = exportMetricsText();
      expect(text).toContain("# HELP request_count");
      expect(text).toContain("# TYPE request_count counter");
      expect(text).toContain("# HELP request_errors_total");
      expect(text).toContain("# HELP request_duration_ms");
      expect(text).toContain("# HELP domain_counters");
    });

    it("exports RED metrics in Prometheus format", () => {
      recordRequest("GET", "/invoices", 200, 50);
      recordRequest("GET", "/invoices", 200, 150);
      recordRequest("GET", "/invoices", 500, 200);

      const text = exportMetricsText();

      // Count metric
      expect(text).toContain('request_count{GET /invoices} 3');

      // Error metric
      expect(text).toContain('request_errors_total{GET /invoices 500} 1');

      // Duration histogram buckets
      expect(text).toContain('request_duration_ms_bucket{route="GET /invoices",le="50"} 1');
      expect(text).toContain('request_duration_ms_bucket{route="GET /invoices",le="100"} 1');
      expect(text).toContain('request_duration_ms_bucket{route="GET /invoices",le="500"} 3');
      expect(text).toContain('request_duration_ms_bucket{route="GET /invoices",le="+Inf"} 3');

      // Duration sum and count
      expect(text).toContain('request_duration_ms_sum{route="GET /invoices"} 400');
      expect(text).toContain('request_duration_ms_count{route="GET /invoices"} 3');
    });

    it("exports domain counters", () => {
      const meter = createMeter();
      meter.inc("invoices_created_total");
      meter.inc("invoices_created_total");

      const text = exportMetricsText();
      expect(text).toContain("# HELP domain_counters");
      expect(text).toContain('domain_counters{invoices_created_total} 2');
    });

    it("returns valid Prometheus text format (no double ##)", () => {
      recordRequest("GET", "/health", 200, 5);
      const meter = createMeter();
      meter.inc("test_counter");

      const text = exportMetricsText();

      // Lines should start with # (comment) or metric name, not ##
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.trim().length > 0) {
          expect(
            line.startsWith("#") || /^[a-z_]+/.test(line)
          ).toBe(true);
        }
      }
    });
  });

  describe("resetMetrics", () => {
    it("clears all metrics", () => {
      recordRequest("GET", "/invoices", 200, 50);
      const meter = createMeter();
      meter.inc("invoices_created_total");

      resetMetrics();

      const metrics = getMetrics();
      expect(Object.keys(metrics.requestCount).length).toBe(0);
      expect(Object.keys(metrics.requestErrors).length).toBe(0);
      expect(Object.keys(metrics.requestDurations).length).toBe(0);
      expect(Object.keys(metrics.domainCounters).length).toBe(0);
    });
  });
});
