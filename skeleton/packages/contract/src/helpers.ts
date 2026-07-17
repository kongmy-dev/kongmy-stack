import { z } from "zod";
import { ErrorCode } from "./errors.js";

/**
 * ADR-0004: Contract helpers (the enforcement surface)
 * ADR-0008: Permission IDs derived from contracts
 *
 * Authoring with helpers IS compliance. No Hono imports; route metadata is transport-agnostic.
 * Adapter layer (T5) wraps these for OpenAPI via `.openapi()`.
 *
 * Helpers emit:
 * 1. Route metadata (method, path, schemas)
 * 2. Derived permission IDs (resource:action format per ADR-0008)
 * 3. MCP tool descriptors (ToolResult shape per ADR-0010)
 */

// ============================================================================
// Pagination
// ============================================================================

/**
 * Pagination query schema
 * Limit/offset/sort/filter names are FINAL and propagate everywhere:
 * - API validation (here)
 * - DataTable state (T6)
 * - URL search params (shareable URLs must be valid queries)
 *
 * Choice rationale: limit/offset (stateless, link-shareable, REST-idiomatic)
 * sort: "field:asc|desc" (DataTable convention)
 * filter: free-form object per resource (contract-level, not here)
 */
export const paginationQuery = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Items per page (1–100, default 20)"),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe("Offset for pagination (0-based, default 0)"),
    sort: z
      .string()
      .optional()
      .describe("Sort key: 'fieldName:asc' or 'fieldName:desc'"),
  })
  .describe("Pagination query: limit/offset/sort (final names, propagate everywhere)");

export type PaginationQuery = z.infer<typeof paginationQuery>;

/**
 * Pagination metadata in list responses
 * Consumed by: DataTable, QueryOptions factories, URL state
 */
export const paginationMeta = z
  .object({
    limit: z.number().int().min(1).describe("Items per page"),
    offset: z.number().int().nonnegative().describe("Current offset"),
    total: z.number().int().nonnegative().describe("Total count"),
    hasMore: z.boolean().describe("Whether more items exist"),
  })
  .describe("Pagination metadata in list responses");

export type PaginationMeta = z.infer<typeof paginationMeta>;

/**
 * List response envelope: data + meta
 * Bare objects for single resources; {data, meta} for lists only (ADR-0004)
 */
export function listResponse<T extends z.ZodType>(schema: T) {
  return z
    .object({
      data: z.array(schema).describe("Array of resources"),
      meta: paginationMeta.describe("Pagination metadata"),
    })
    .describe("List response envelope: data + meta (bare object for single resources only)");
}

// ============================================================================
// Route Metadata (transport-agnostic)
// ============================================================================

/**
 * HTTP method
 */
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Route metadata: emitted by resource()/action() helpers
 * Used by: T5 adapter to wire routes, OpenAPI doc generation, MCP tool registration
 * NO Hono/adapter-specific fields; this is the data layer.
 */
export interface RouteMetadata {
  method: HttpMethod;
  path: string;
  summary?: string | undefined;
  description?: string | undefined;
  inputSchema?: z.ZodType | undefined;
  outputSchema: z.ZodType;
  errorCodes?: ErrorCode[] | undefined;
  requiresAuth?: boolean | undefined;
  operationId?: string | undefined;
}

// ============================================================================
// Permission ID Derivation (ADR-0008)
// ============================================================================

/**
 * ADR-0008: Permission IDs are DERIVED from contracts, never hand-authored
 * resource('invoice') → [invoice:read, invoice:create, invoice:update, invoice:delete]
 * action('send', ...) → invoice:send
 *
 * The permission vocabulary cannot drift from the API because it IS the API.
 */

export type PermissionId = `${string}:${string}`;

function derivePermissionId(resource: string, verb: string): PermissionId {
  return `${resource}:${verb}` as PermissionId;
}

// ============================================================================
// MCP Tool Descriptor (ADR-0010)
// ============================================================================

/**
 * ToolResult envelope: ok + (summary || error) + optional data
 * Summary written for the LLM; data is structured detail
 * No transport binding here; MCP seam wraps this in handlers
 */
export interface ToolResult<T = unknown> {
  ok: boolean;
  summary: string;
  data?: T;
  traceId?: string;
}

/**
 * MCP tool metadata: emitted by action() helper
 * Consumed by: T5 registry.execute(), MCP tool registration
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  category: "read" | "write" | "admin";
  inputSchema: z.ZodType;
  requiresAuth: boolean;
  permissionId: PermissionId;
}

// ============================================================================
// resource() helper: CRUD contract set + permission derivation
// ============================================================================

export interface ResourceOptions {
  name: string;
  summary?: string;
  description?: string;
  listSchema: z.ZodType;
  getSchema: z.ZodType;
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  errorCodes?: ErrorCode[];
}

export interface ResourceContract {
  name: string;
  listRoute: RouteMetadata;
  getRoute: RouteMetadata;
  createRoute: RouteMetadata;
  updateRoute: RouteMetadata;
  deleteRoute: RouteMetadata;
  permissions: {
    read: PermissionId;
    create: PermissionId;
    update: PermissionId;
    delete: PermissionId;
  };
}

/**
 * resource() helper: generates CRUD routes + derived permission IDs
 * Authoring with resource() IS compliance (ADR-0004, ADR-0008)
 *
 * Usage:
 *   const invoice = resource({
 *     name: 'invoice',
 *     summary: 'Sales invoice',
 *     listSchema: invoiceListItem,
 *     getSchema: invoiceDetail,
 *     createSchema: invoiceCreate,
 *     updateSchema: invoiceUpdate,
 *   });
 *
 * Derives:
 *   - invoice:read (GET /invoices/:id)
 *   - invoice:create (POST /invoices)
 *   - invoice:update (PUT/PATCH /invoices/:id)
 *   - invoice:delete (DELETE /invoices/:id)
 */
export function resource(opts: ResourceOptions): ResourceContract {
  const basePath = `/${opts.name.toLowerCase()}s`;
  const errorCodes = opts.errorCodes || [
    "NOT_FOUND",
    "UNAUTHORIZED",
    "FORBIDDEN",
  ];

  return {
    name: opts.name,
    listRoute: {
      method: "GET",
      path: basePath,
      summary: `List ${opts.name}s`,
      description: opts.description,
      inputSchema: paginationQuery,
      outputSchema: listResponse(opts.listSchema),
      errorCodes,
      requiresAuth: true,
      operationId: `list_${opts.name}s`,
    },
    getRoute: {
      method: "GET",
      path: `${basePath}/:id`,
      summary: `Get ${opts.name}`,
      description: opts.description,
      outputSchema: opts.getSchema,
      errorCodes,
      requiresAuth: true,
      operationId: `get_${opts.name}`,
    },
    createRoute: {
      method: "POST",
      path: basePath,
      summary: `Create ${opts.name}`,
      description: opts.description,
      inputSchema: opts.createSchema,
      outputSchema: opts.getSchema,
      errorCodes: [
        ...errorCodes,
        "VALIDATION_ERROR",
        "BUSINESS_RULE_VIOLATION",
      ],
      requiresAuth: true,
      operationId: `create_${opts.name}`,
    },
    updateRoute: {
      method: "PUT",
      path: `${basePath}/:id`,
      summary: `Update ${opts.name}`,
      description: opts.description,
      inputSchema: opts.updateSchema,
      outputSchema: opts.getSchema,
      errorCodes: [
        ...errorCodes,
        "VALIDATION_ERROR",
        "BUSINESS_RULE_VIOLATION",
        "CONFLICT",
        "DOCUMENT_IMMUTABLE",
      ],
      requiresAuth: true,
      operationId: `update_${opts.name}`,
    },
    deleteRoute: {
      method: "DELETE",
      path: `${basePath}/:id`,
      summary: `Delete ${opts.name}`,
      description: opts.description,
      outputSchema: z
        .object({
          success: z
            .boolean()
            .describe("Whether deletion succeeded"),
        })
        .describe("Deletion response"),
      errorCodes: [
        ...errorCodes,
        "CONFLICT",
        "DOCUMENT_IMMUTABLE",
      ],
      requiresAuth: true,
      operationId: `delete_${opts.name}`,
    },
    permissions: {
      read: derivePermissionId(opts.name, "read"),
      create: derivePermissionId(opts.name, "create"),
      update: derivePermissionId(opts.name, "update"),
      delete: derivePermissionId(opts.name, "delete"),
    },
  };
}

// ============================================================================
// action() helper: RPC action route + MCP tool descriptor
// ============================================================================

export interface ActionOptions {
  name: string;
  resource: string;
  summary?: string;
  description?: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  category?: "read" | "write" | "admin";
  errorCodes?: ErrorCode[];
  autonomy?: "suggest" | "assist" | "auto";
}

export interface ActionContract {
  name: string;
  resource: string;
  route: RouteMetadata;
  tool: ToolDescriptor;
  permission: PermissionId;
}

/**
 * action() helper: generates RPC route + MCP tool descriptor + permission
 * Actions map 1:1 to MCP tools; same permission ID for both
 * Authoring with action() IS compliance (ADR-0004, ADR-0008, ADR-0010)
 *
 * Usage:
 *   const sendInvoice = action({
 *     name: 'send',
 *     resource: 'invoice',
 *     summary: 'Send invoice to customer',
 *     inputSchema: sendInvoiceInput,
 *     outputSchema: invoiceDetail,
 *     category: 'write',
 *   });
 *
 * Derives:
 *   - route: POST /invoices/{id}/send
 *   - permission: invoice:send
 *   - MCP tool: send_invoice (ToolResult shape, summary written for LLM)
 */
export function action(opts: ActionOptions): ActionContract {
  const resourcePlural = opts.resource.toLowerCase() + "s";
  const path = `/${resourcePlural}/:id/${opts.name}`;
  const permId = derivePermissionId(opts.resource, opts.name);

  return {
    name: opts.name,
    resource: opts.resource,
    route: {
      method: "POST",
      path,
      summary:
        opts.summary ||
        `Perform ${opts.name} on ${opts.resource}`,
      description: opts.description,
      inputSchema: opts.inputSchema,
      outputSchema: opts.outputSchema,
      errorCodes: opts.errorCodes || [
        "NOT_FOUND",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "INVALID_STATE",
        "BUSINESS_RULE_VIOLATION",
      ],
      requiresAuth: true,
      operationId: `${opts.name}_${opts.resource}`,
    },
    tool: {
      name: `${opts.name}_${opts.resource}`,
      description:
        opts.summary ||
        `Perform ${opts.name} on ${opts.resource}`,
      category: opts.category || "write",
      inputSchema: opts.inputSchema,
      requiresAuth: true,
      permissionId: permId,
    },
    permission: permId,
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { errorEnvelope, errorCode } from "./errors.js";
export type { ErrorEnvelope, ErrorCode } from "./errors.js";
