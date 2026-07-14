import { z } from "zod";
import { action, type ActionContract } from "./helpers.js";

/**
 * ADR-0009: Document lifecycle convention
 *
 * Immutability rule: draft→posted→cancelled
 * - draft: fully editable
 * - posted: immutable (append-only, correct via reversals)
 * - cancelled: marked void
 *
 * Transitions are action()s → permissions + MCP tools are automatic.
 * No `soft delete` by default (ADR-0005).
 */

export type DocumentLifecycleState = "draft" | "posted" | "cancelled";

/**
 * Document lifecycle declaration helper
 *
 * Emits actions for each valid transition + transition schemas.
 * Example:
 *   const invoiceLifecycle = documentLifecycle({
 *     resource: 'invoice',
 *     draftSchema: invoiceCreateSchema,
 *     postedSchema: invoicePostedSchema,
 *     validateBeforePost: invoiceValidateSchema,
 *   });
 *
 * Derives:
 *   - action: post (draft→posted)
 *   - action: cancel (any→cancelled)
 *   - (update available only for draft)
 *   - (delete available only for draft)
 */

export interface DocumentLifecycleOptions {
  /** Resource name (e.g., 'invoice') */
  resource: string;
  /** Schema for draft state (editable fields) */
  draftSchema: z.ZodType;
  /** Schema for posted state (immutable view) */
  postedSchema: z.ZodType;
  /** Optional: schema for pre-posting validation */
  validateBeforePost?: z.ZodType;
  /** Summary for post action */
  postSummary?: string;
  /** Summary for cancel action */
  cancelSummary?: string;
}

export interface DocumentLifecycleActions {
  post: ActionContract;
  cancel: ActionContract;
}

/**
 * documentLifecycle() helper: emits post and cancel actions with transition rules
 *
 * Rationale:
 * - POST /invoices/{id}/post transitions draft→posted (server updates status)
 * - POST /invoices/{id}/cancel transitions any→cancelled (idempotent)
 * - PUT /invoices/{id} only works in draft state (enforced via schema or service)
 * - DELETE /invoices/{id} only works in draft state (enforced via service)
 *
 * Derived permissions:
 * - invoice:post (transition permission)
 * - invoice:cancel (transition permission)
 * - invoice:update (existing, draft-only via service)
 * - invoice:delete (existing, draft-only via service)
 */
export function documentLifecycle(
  opts: DocumentLifecycleOptions
): DocumentLifecycleActions {
  const resourceSingular = opts.resource.toLowerCase();

  const postInput = opts.validateBeforePost || opts.draftSchema;

  return {
    post: action({
      name: "post",
      resource: resourceSingular,
      summary: opts.postSummary ||
        `Post ${resourceSingular} (transition draft → posted, immutable)`,
      description:
        `Transition ${resourceSingular} from draft to posted state. Posted documents are immutable; corrections must be issued as reversals (credit notes).`,
      inputSchema: postInput,
      outputSchema: opts.postedSchema,
      category: "write",
      errorCodes: [
        "NOT_FOUND",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "INVALID_STATE",
        "BUSINESS_RULE_VIOLATION",
      ],
      autonomy: "suggest",
    }),

    cancel: action({
      name: "cancel",
      resource: resourceSingular,
      summary: opts.cancelSummary ||
        `Cancel ${resourceSingular} (mark void)`,
      description:
        `Cancel ${resourceSingular}. Cancelled documents are immutable and null out; corrections use reversals.`,
      inputSchema: z
        .object({
          reason: z.string().optional().describe("Cancellation reason"),
        })
        .describe("Input for cancelling document"),
      outputSchema: opts.postedSchema,
      category: "write",
      errorCodes: [
        "NOT_FOUND",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "INVALID_STATE",
      ],
      autonomy: "assist",
    }),
  };
}

/**
 * DocumentStatusEnum: standard domain enum for document state
 * Used by resources with draft→posted→cancelled lifecycle
 */
export const documentStatus = z
  .enum(["draft", "posted", "cancelled"])
  .describe(
    "Document status: draft (editable) → posted (immutable) → cancelled (reversals)"
  );

export type DocumentStatus = z.infer<typeof documentStatus>;
