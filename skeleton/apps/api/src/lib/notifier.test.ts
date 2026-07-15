/**
 * Notifier seam contract tests (ADR-0006, ADR-0005)
 *
 * Tests:
 * 1. draft() creates and records a notification draft
 * 2. getDrafts() returns recorded drafts for an org
 * 3. clearDrafts() resets the draft history
 * 4. Multiple drafts can be recorded
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { inMemoryNotifier } from "./notifier.js";

describe("Notifier Seam", () => {
  let notifier: any;

  beforeEach(() => {
    notifier = inMemoryNotifier();
  });

  it("draft() creates a notification draft with unique ID", async () => {
    const draft = await notifier.draft({
      type: "email",
      recipient: "test@example.com",
      subject: "Test",
      body: "Test notification",
    });

    expect(draft).toBeDefined();
    expect(draft.id).toMatch(/^draft_/);
    expect(draft.type).toBe("email");
    expect(draft.recipient).toBe("test@example.com");
    expect(draft.subject).toBe("Test");
    expect(draft.body).toBe("Test notification");
    expect(draft.createdAt).toBeDefined();
  });

  it("draft() records metadata when provided", async () => {
    const metadata = { invoiceId: "inv_123", orderId: "ord_456" };
    const draft = await notifier.draft({
      type: "email",
      recipient: "test@example.com",
      body: "Invoice notification",
      metadata,
    });

    expect(draft.metadata).toEqual(metadata);
  });

  it("getDrafts() returns recorded drafts for an org", async () => {
    const draft1 = await notifier.draft({
      type: "email",
      recipient: "user1@example.com",
      body: "First draft",
    });

    const draft2 = await notifier.draft({
      type: "telegram",
      recipient: "123456789",
      body: "Second draft",
    });

    const drafts = notifier.getDrafts("default_org");
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toEqual(draft1);
    expect(drafts[1]).toEqual(draft2);
  });

  it("getDrafts() returns empty array for unknown org", async () => {
    const drafts = notifier.getDrafts("unknown_org");
    expect(drafts).toHaveLength(0);
  });

  it("clearDrafts() resets draft history", async () => {
    await notifier.draft({
      type: "email",
      recipient: "test@example.com",
      body: "Draft 1",
    });

    await notifier.draft({
      type: "email",
      recipient: "test@example.com",
      body: "Draft 2",
    });

    let drafts = notifier.getDrafts("default_org");
    expect(drafts).toHaveLength(2);

    notifier.clearDrafts();

    drafts = notifier.getDrafts("default_org");
    expect(drafts).toHaveLength(0);
  });

  it("supports multiple notification types", async () => {
    const emailDraft = await notifier.draft({
      type: "email",
      recipient: "test@example.com",
      body: "Email notification",
    });

    const telegramDraft = await notifier.draft({
      type: "telegram",
      recipient: "123456789",
      body: "Telegram notification",
    });

    const larkDraft = await notifier.draft({
      type: "lark",
      recipient: "user_lark_123",
      body: "Lark notification",
    });

    const drafts = notifier.getDrafts("default_org");
    expect(drafts).toHaveLength(3);
    expect(emailDraft.type).toBe("email");
    expect(telegramDraft.type).toBe("telegram");
    expect(larkDraft.type).toBe("lark");
  });
});
