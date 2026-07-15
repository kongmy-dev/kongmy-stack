/**
 * Tracing seam tests per ADR-0010.
 *
 * Verifies:
 * - W3C traceparent parsing/generation
 * - Request trace context creation
 * - Traceparent propagation through responses
 */

import { describe, it, expect } from "bun:test";
import {
  extractTraceContext,
  exportSpanConsole,
} from "./tracing.js";

describe("Tracing (ADR-0010)", () => {
  describe("extractTraceContext", () => {
    it("generates new trace when no traceparent provided", () => {
      const trace = extractTraceContext();

      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace.traceparent()).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
      );
    });

    it("continues existing trace when valid traceparent provided", () => {
      const incomingTraceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
      const trace = extractTraceContext(incomingTraceparent);

      // traceId should match incoming
      expect(trace.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      // spanId should be new (different from parent)
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace.spanId).not.toBe("00f067aa0ba902b7");
      // traceparent header should use incoming traceId
      expect(trace.traceparent()).toMatch(
        /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/
      );
    });

    it("starts fresh trace on invalid traceparent", () => {
      const invalidTraceparent = "invalid-format-header";
      const trace = extractTraceContext(invalidTraceparent);

      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace.traceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it("exposes startTime for duration calculations", () => {
      const before = Date.now();
      const trace = extractTraceContext();
      const after = Date.now();

      expect(trace.startTime).toBeGreaterThanOrEqual(before);
      expect(trace.startTime).toBeLessThanOrEqual(after);
    });

    it("traceparent() returns consistent header", () => {
      const trace = extractTraceContext();
      const header1 = trace.traceparent();
      const header2 = trace.traceparent();

      expect(header1).toBe(header2);
    });
  });

  describe("exportSpanConsole", () => {
    it("logs span data to console", () => {
      // Capture console.log
      let logged: any = null;
      const originalLog = console.log;
      console.log = (msg: any) => {
        if (typeof msg === "string" && msg.includes('"span"')) {
          logged = JSON.parse(msg);
        }
      };

      try {
        exportSpanConsole({
          name: "test_span",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          startTime: 1000,
          endTime: 1050,
          attributes: { method: "POST" },
        });

        expect(logged).not.toBeNull();
        expect(logged.level).toBe("span");
        expect(logged.name).toBe("test_span");
        expect(logged.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
        expect(logged.spanId).toBe("00f067aa0ba902b7");
        expect(logged.duration).toBe(50);
        expect(logged.attributes.method).toBe("POST");
      } finally {
        console.log = originalLog;
      }
    });
  });
});
