# ADR-0006 Notifier Seam Implementation Guide

**Status:** Completed (Wave B, T1)  
**Decision Date:** 2026-07-15  
**Context:** Template needs ONE seam for email+Telegram+Lark notifications with autonomy gate (draft before send).

## What Was Decided

- **One seam, many channels:** Single `Notifier` interface supports email, Telegram, Lark
- **Autonomy gate (suggest level):** Actions produce drafts; caller decides to send (not auto-send)
- **No I/O in template:** `inMemoryNotifier` records drafts only; no external service calls
- **Audit trail:** Draft records include metadata (timestamp, recipient, type); queryable for later replay

## Why This Approach

1. **Autonomy gate:** By default, send actions draft notifications and pause for human/agent review. In autonomy=auto mode, caller can send (but template ships suggest only).
2. **One interface:** Consumers don't know/care which channel; routing logic (email vs. Telegram) is in adapter, not caller
3. **Testable:** No mocking framework needed; in-memory adapter records drafts; tests inspect history
4. **Extensible:** Swap `inMemoryNotifier()` for real adapters (email, Telegram, Lark) without touching service code

## Implementation

### Seam Interface

**File:** `skeleton/apps/api/src/lib/notifier.ts`

```typescript
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
```

### Adapter: In-Memory

```typescript
export function inMemoryNotifier(): Notifier {
  const drafts: Map<string, NotificationDraft[]> = new Map();

  return {
    async draft(input) {
      const draft: NotificationDraft = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        type: input.type,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        metadata: input.metadata,
        createdAt: new Date().toISOString(),
      };
      
      const key = "default_org"; // In production, pass organizationId via ctx
      if (!drafts.has(key)) drafts.set(key, []);
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
```

### Integration: Service Layer

**File:** `skeleton/apps/api/src/services/invoice.ts`

```typescript
export async function sendInvoice(ctx: Ctx, id: string) {
  ctx.authz.assert("invoice:send");
  
  const invoice = await invoiceRepo.getById(ctx.db, scopeOf(ctx), id);
  if (!invoice) throw new NotFoundError(`Invoice ${id} not found`);

  // Autonomy gate: draft the notification (suggest level by default)
  const notificationDraft = await ctx.notifier.draft({
    type: "email",
    recipient: invoice.customerEmail, // Would be in invoice in real app
    subject: `Invoice ${invoice.invoiceNumber}`,
    body: `Please find attached your invoice.`,
    metadata: {
      invoiceId: id,
      invoiceNumber: invoice.invoiceNumber,
    },
  });

  // Log and publish event
  await writeAudit(ctx, "invoice:send", id);
  publishInvoiceEvent(ctx, "invoice_sent", id, {
    notificationDraftId: notificationDraft.id,
  });

  return {
    id: invoice.invId,
    notificationDraftId: notificationDraft.id,
    message: "Invoice send notification drafted",
  };
}
```

### Wiring: Main Composition

**File:** `skeleton/apps/api/src/main.ts`

```typescript
import { inMemoryNotifier, type Notifier } from "./lib/notifier.js";

export interface AppContext {
  notifier: Notifier;
  // ... other fields
}

export function createApp(deps: {
  notifier?: Notifier;
  // ...
}) {
  const notifier = deps.notifier || inMemoryNotifier();
  
  app.use("*", async (ctx, next) => {
    ctx.set("notifier", notifier);
    // ...
  });
}
```

## Scenario Walkthrough

### Wave B Dogfood: Send Invoice Action

1. **User (admin) action:** Click "Send" button on an invoice in web UI
   - Calls `POST /invoices/{id}/send` (contract-derived action route)

2. **Backend (suggest autonomy):**
   - Service calls `sendInvoice(ctx, invoiceId)`
   - Calls `ctx.notifier.draft({ type: "email", recipient: "...", body: "..." })`
   - Notifier records draft with unique ID (e.g., `draft_1721071234567_abc123`)
   - Returns draft ID to client
   - No external I/O (email not sent)

3. **Response to client:**
   ```json
   {
     "id": "inv_abc123",
     "notificationDraftId": "draft_1721071234567_abc123",
     "message": "Invoice send notification drafted"
   }
   ```

4. **Test verification:**
   - Call `GET /api/invoices/:id/send` (action route)
   - Check `notifier.getDrafts("org_test")` contains the draft
   - Verify metadata (recipient, subject, body)
   - Test isolation: `notifier.clearDrafts()` before next test

## Gotchas & Lessons

### 1. Organization scoping is a placeholder

The `inMemoryNotifier` uses a hardcoded `"default_org"` key. In production:

```typescript
// ✅ Real implementation would accept organizationId
const draft = await ctx.notifier.draft({
  organizationId: ctx.tenant.orgId,  // Add this
  type: "email",
  // ...
});
```

For now, all tests use `notifier.getDrafts("default_org")`.

### 2. No automatic sending in suggest mode

The skeleton ships suggest-level autonomy (draft only). To actually send:

```typescript
// ✅ Real adapter would need a send() method
const draft = await ctx.notifier.draft({ type: "email", ... });

// Later, if autonomy=auto:
// await ctx.notifier.send(draft.id);
```

Deferred to connector module (when integrating real email/Telegram services).

### 3. Recipient resolution is service-specific

The `sendInvoice` service extracts the recipient from the invoice object. In a real system:

```typescript
const draft = await ctx.notifier.draft({
  type: "email",
  recipient: invoice.customerEmail, // Must be valid for the channel
  // ...
});
```

For Telegram, the recipient is a chat ID. For Lark, an app ID. The service must know which channel + how to resolve the recipient.

**Solution:** Channel-specific action contracts (e.g., `sendInvoiceViaEmail`, `sendInvoiceViaTelegram`). Deferred to later phase.

### 4. No retries or error handling in draft

If `notifier.draft()` throws, the service call fails. For production:

```typescript
export async function sendInvoice(ctx: Ctx, id: string) {
  // ...
  let draftId: string;
  try {
    const draft = await ctx.notifier.draft({ ... });
    draftId = draft.id;
  } catch (err) {
    // Log error, maybe retry, maybe return error
    ctx.logger.error("Draft notification failed", { invoiceId: id, error: err });
    draftId = "draft_failed";
  }
  // Continue with audit/event even if draft failed
}
```

## Contract Tests

See `skeleton/apps/api/src/lib/notifier.test.ts`:

- `draft()` creates a notification with unique ID
- `draft()` records metadata when provided
- `getDrafts()` returns recorded drafts
- `getDrafts()` returns empty array for unknown org
- `clearDrafts()` resets draft history
- Multiple notification types (email, telegram, lark) are supported

## Acceptance Test (Dogfood)

Verified via `skeleton/apps/api/src/routes/invoice.test.ts`:

- `sendInvoice` service creates a notification draft
- Draft contains correct recipient, subject, body
- Realtime event is published (covered by realtime.e2e.ts)

## Sealing for Phase 2+

### Adapter: Real Email (SMTP)

```typescript
export function smtpNotifier(config: SMTPConfig): Notifier {
  return {
    async draft(input) {
      if (input.type !== "email") throw new Error("SMTP only supports email");
      
      // In a real adapter, this would actually send via SMTP
      // For now, record a draft
      const draft = { ... };
      
      // Future: await sendEmail(draft.recipient, draft.subject, draft.body);
      
      return draft;
    },
    // ...
  };
}
```

### Adapter: Telegram Bot

```typescript
export function telegramNotifier(botToken: string): Notifier {
  return {
    async draft(input) {
      if (input.type !== "telegram") throw new Error("Telegram adapter for telegram only");
      
      // Recipient is chat ID
      // Future: await telegramBot.sendMessage(input.recipient, input.body);
      
      return draft;
    },
    // ...
  };
}
```

## References

- ADR-0006: Seam interfaces (notifier: one seam for email+Telegram+Lark)
- ADR-0002: Patterns (seams = interface + adapters)
- ADR-0003: DI (two-level context; app deps injected at startup)
- ADR-0008: AuthZ (autonomy gate: suggest → assist → auto)

## Future Work

- [ ] Real email adapter (SMTP, SendGrid, Mailgun)
- [ ] Telegram adapter (Bot API)
- [ ] Lark adapter (Card messaging)
- [ ] Channel-specific action contracts (sendViaEmail, sendViaTelegram)
- [ ] Autonomy=assist mode (draft + web UI form to review/edit before send)
- [ ] Autonomy=auto mode (actually send, no human review)
- [ ] Notification history + audit trail (table, UI)
- [ ] Retry + backoff for failed sends
- [ ] Template variables + rendering (e.g., `{invoiceNumber}`, `{customerName}`)
