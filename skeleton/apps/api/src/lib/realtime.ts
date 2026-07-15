/**
 * Realtime Publisher Seam (ADR-0006, ADR-0002)
 *
 * Interface for publishing real-time events to subscribers.
 * Used by: service layer (after mutations), frontend (SSE subscription).
 *
 * Implementations:
 * 1. inMemoryPublisher: Per-organization subscriber registry. Used in tests + local dev.
 * 2. Real adapters: Redis Pub/Sub, Kafka, etc. (Placeholder for future phases).
 *
 * Pattern: services publish events → publisher broadcasts to subscribers in same org
 */

import type { RealtimeEvent } from "@kongmy-stack/contract";

export type Subscriber = (event: RealtimeEvent) => void;

export interface RealtimePublisher {
  /**
   * Publish an event to all subscribers in the same organization.
   */
  publish(event: RealtimeEvent): void;

  /**
   * Subscribe to events for a specific organization.
   * Returns an unsubscribe function.
   */
  subscribe(organizationId: string, subscriber: Subscriber): () => void;

  /**
   * Get all subscribers for an organization (for tests).
   */
  getSubscribers(organizationId: string): Subscriber[];

  /**
   * Clear all subscribers (for test isolation).
   */
  clearSubscribers(): void;
}

/**
 * In-memory publisher: maintains per-org subscriber registry.
 * Each subscriber is a callback that receives events published to its org.
 */
export function inMemoryPublisher(): RealtimePublisher {
  const subscribers: Map<string, Subscriber[]> = new Map();

  return {
    publish(event) {
      const orgSubscribers = subscribers.get(event.organizationId) || [];
      for (const subscriber of orgSubscribers) {
        try {
          subscriber(event);
        } catch (err) {
          // Subscriber threw; log and continue
          console.error("Subscriber error:", err);
        }
      }
    },

    subscribe(organizationId, subscriber) {
      if (!subscribers.has(organizationId)) {
        subscribers.set(organizationId, []);
      }
      subscribers.get(organizationId)!.push(subscriber);

      // Return unsubscribe function
      return () => {
        const list = subscribers.get(organizationId);
        if (list) {
          const idx = list.indexOf(subscriber);
          if (idx !== -1) {
            list.splice(idx, 1);
          }
        }
      };
    },

    getSubscribers(organizationId) {
      return subscribers.get(organizationId) || [];
    },

    clearSubscribers() {
      subscribers.clear();
    },
  };
}
