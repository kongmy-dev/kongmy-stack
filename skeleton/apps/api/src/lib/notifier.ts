/**
 * Notifier Seam (ADR-0006, ADR-0002)
 *
 * Interface for sending notifications via multiple channels:
 * - Email
 * - Telegram
 * - Lark
 *
 * Implementations:
 * 1. inMemoryNotifier: Records drafts only (no external I/O). Used in tests.
 * 2. Real adapters (email, telegram, lark): Placeholder for future phases.
 *
 * Autonomy gate: actions produce DRAFT by default (suggest level).
 * Notifier.send() returns a draft; caller decides to send if autonomy=auto.
 */

export interface NotificationDraft {
  id: string;
  type: "email" | "telegram" | "lark";
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO-8601 UTC
}

export interface Notifier {
  /**
   * Create a notification draft (not sent).
   * Autonomy gate: produce draft, let caller decide.
   */
  draft(input: {
    type: "email" | "telegram" | "lark";
    recipient: string;
    subject?: string;
    body: string;
    metadata?: Record<string, unknown>;
  }): Promise<NotificationDraft>;

  /**
   * Get draft history (for tests / audit).
   */
  getDrafts(organizationId: string): NotificationDraft[];

  /**
   * Clear all drafts (for test isolation).
   */
  clearDrafts(): void;
}

/**
 * In-memory notifier: records drafts only, no external I/O.
 * Used during development and in tests.
 */
export function inMemoryNotifier(): Notifier {
  const drafts: Map<string, NotificationDraft[]> = new Map();

  return {
    async draft(input) {
      // In a real implementation, this would call the appropriate channel adapter.
      // For now, we just record the draft.
      const draft: NotificationDraft = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        type: input.type,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        metadata: input.metadata,
        createdAt: new Date().toISOString(),
      };

      // We'd normally have organization context, but in this demo
      // we use a default key. In a real app, pass organizationId through ctx.
      const key = "default_org";
      if (!drafts.has(key)) {
        drafts.set(key, []);
      }
      drafts.get(key)!.push(draft);

      return draft;
    },

    getDrafts(organizationId: string) {
      return drafts.get(organizationId) || [];
    },

    clearDrafts() {
      drafts.clear();
    },
  };
}
