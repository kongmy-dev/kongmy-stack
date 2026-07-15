/**
 * Realtime publisher seam contract tests (ADR-0006, ADR-0005)
 *
 * Tests the in-memory publisher implementation:
 * 1. Events are published to subscribers in the same org
 * 2. Events are filtered by organization (no cross-org leakage)
 * 3. Multiple subscribers in the same org all receive events
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { inMemoryPublisher } from "./realtime.js";
import type { RealtimeEvent } from "@kongmy-stack/contract";

describe("Realtime Publisher Seam", () => {
  let publisher: any;

  beforeEach(() => {
    publisher = inMemoryPublisher();
  });

  it("Publisher delivers events only to subscribers in the same org", async () => {
    // Simulate two organizations
    const events1: RealtimeEvent[] = [];
    const events2: RealtimeEvent[] = [];

    const unsubscribe1 = publisher.subscribe("org_1", (event: RealtimeEvent) => {
      events1.push(event);
    });

    const unsubscribe2 = publisher.subscribe("org_2", (event: RealtimeEvent) => {
      events2.push(event);
    });

    // Publish an event to org_1
    const event: RealtimeEvent = {
      eventId: "evt_test_1",
      type: "invoice_created",
      resourceId: "inv_test_123",
      organizationId: "org_1",
      timestamp: new Date().toISOString(),
      userId: "user_123",
    };

    publisher.publish(event);

    // Only org_1 subscriber should receive it
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(0);

    unsubscribe1();
    unsubscribe2();
  });

  it("Multiple subscribers in the same org all receive events", async () => {
    const events1: RealtimeEvent[] = [];
    const events2: RealtimeEvent[] = [];

    const unsubscribe1 = publisher.subscribe("org_1", (event: RealtimeEvent) => {
      events1.push(event);
    });

    const unsubscribe2 = publisher.subscribe("org_1", (event: RealtimeEvent) => {
      events2.push(event);
    });

    const event: RealtimeEvent = {
      eventId: "evt_test_2",
      type: "invoice_updated",
      resourceId: "inv_test_456",
      organizationId: "org_1",
      timestamp: new Date().toISOString(),
      userId: "user_123",
    };

    publisher.publish(event);

    // Both subscribers should receive it
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0]).toEqual(event);
    expect(events2[0]).toEqual(event);

    unsubscribe1();
    unsubscribe2();
  });

  it("Unsubscribe stops delivering events", () => {
    const events: RealtimeEvent[] = [];

    const unsubscribe = publisher.subscribe("org_test", (event: RealtimeEvent) => {
      events.push(event);
    });

    // Publish before unsubscribe
    publisher.publish({
      eventId: "evt_1",
      type: "invoice_created",
      resourceId: "inv_1",
      organizationId: "org_test",
      timestamp: new Date().toISOString(),
      userId: "user_1",
    });

    expect(events).toHaveLength(1);

    // Unsubscribe
    unsubscribe();

    // Publish after unsubscribe
    publisher.publish({
      eventId: "evt_2",
      type: "invoice_updated",
      resourceId: "inv_2",
      organizationId: "org_test",
      timestamp: new Date().toISOString(),
      userId: "user_1",
    });

    // Should still be 1 (not 2)
    expect(events).toHaveLength(1);
  });

  it("clearSubscribers() removes all subscribers", () => {
    const events1: RealtimeEvent[] = [];
    const events2: RealtimeEvent[] = [];

    publisher.subscribe("org_1", (event: RealtimeEvent) => {
      events1.push(event);
    });

    publisher.subscribe("org_2", (event: RealtimeEvent) => {
      events2.push(event);
    });

    // Publish before clear
    publisher.publish({
      eventId: "evt_1",
      type: "invoice_created",
      resourceId: "inv_1",
      organizationId: "org_1",
      timestamp: new Date().toISOString(),
      userId: "user_1",
    });

    expect(events1).toHaveLength(1);

    // Clear all subscribers
    publisher.clearSubscribers();

    // Publish after clear
    publisher.publish({
      eventId: "evt_2",
      type: "invoice_created",
      resourceId: "inv_2",
      organizationId: "org_1",
      timestamp: new Date().toISOString(),
      userId: "user_1",
    });

    // Should still be 1 (not 2)
    expect(events1).toHaveLength(1);
  });
});
