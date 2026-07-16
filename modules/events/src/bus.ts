import type { EventEnvelope } from './envelope.js'

/**
 * Subscriber callback: async handler for an event.
 * Receives the sealed envelope and performs domain-specific handling.
 * May throw; caller is responsible for error handling (typically logged and processed as a poison message).
 */
export type Subscriber = (e: EventEnvelope) => void | Promise<void>

/**
 * In-process publish/subscribe event bus — the shop-box transport for the event backbone.
 * Subscribers register per event type or for all events (wildcard '*').
 * At scale (SaaS, multi-service), subscribers would connect via a real broker (Kafka, RabbitMQ);
 * the bus abstraction ensures swappability: same domain code works with in-proc or external bus.
 */
export class EventBus {
  private readonly subs = new Map<string, Set<Subscriber>>()

  /**
   * Subscribe to a specific event type or all events.
   *
   * @param type - Event type to subscribe to (e.g. 'invoice.posted'), or '*' for all events
   * @param fn - Subscriber callback
   * @returns Unsubscribe function; call to remove the subscription
   */
  on(type: string, fn: Subscriber): () => void {
    const set = this.subs.get(type) ?? new Set<Subscriber>()
    set.add(fn)
    this.subs.set(type, set)
    return () => set.delete(fn)
  }

  /**
   * Publish an event to all matching subscribers.
   * Calls subscribers for the specific event type and any wildcard '*' subscribers.
   * Awaits each subscriber's completion (serial order).
   *
   * @param e - EventEnvelope to publish
   */
  async publish(e: EventEnvelope): Promise<void> {
    for (const fn of this.subs.get(e.type) ?? []) await fn(e)
    for (const fn of this.subs.get('*') ?? []) await fn(e)
  }
}
