/**
 * @kongmy-stack/contract
 *
 * Zod SSOT: the single source of truth for all operations.
 * Everything derives from here: API routes, OpenAPI docs, MCP tools, generated clients, forms, URL state.
 *
 * ADR-0004: API design
 * ADR-0008: AuthZ (permission derivation)
 * ADR-0009: Scalar vocabulary
 * ADR-0010: Audit, OTel, metrics
 * ADR-0011: OpenAPI adapter (contracts import only zod)
 */

// ============================================================================
// Scalars (ADR-0009)
// ============================================================================

export {
  // Identifiers
  id,
  // Money & Currency
  currencyCode,
  money,
  exchangeRate,
  // Quantities & Units
  unitOfMeasure,
  quantity,
  // Tax & Rates
  basisPoints,
  taxCode,
  // Dates & Time
  dateOnly,
  dateTime,
  timezone,
  // Document Numbering
  documentNumber,
  // Contact Information
  phone,
  email,
  address,
  // Files
  fileRef,
  // Audit & Versioning
  auditStamp,
  version,
  // Domain Enums
  documentStatus,
} from "./scalars.js";

export type {
  CurrencyCode,
  Money,
  ExchangeRate,
  UnitOfMeasure,
  Quantity,
  BasisPoints,
  TaxCode,
  DateOnly,
  DateTime,
  Timezone,
  DocumentNumber,
  Phone,
  Email,
  Address,
  FileRef,
  AuditStamp,
  Version,
  DocumentStatus,
} from "./scalars.js";

// ============================================================================
// Errors (ADR-0004, ADR-0009)
// ============================================================================

export {
  errorCode,
  errorEnvelope,
  httpErrorResponse,
  validationErrorDetail,
} from "./errors.js";

export type {
  ErrorCode,
  ErrorEnvelope,
  HttpErrorResponse,
  ValidationErrorDetail,
} from "./errors.js";

// ============================================================================
// Helpers (ADR-0004, ADR-0008, ADR-0010)
// ============================================================================

export {
  paginationQuery,
  paginationMeta,
  listResponse,
  resource,
  action,
} from "./helpers.js";

export type {
  PaginationQuery,
  PaginationMeta,
  RouteMetadata,
  PermissionId,
  ToolDescriptor,
  ToolResult,
  ResourceOptions,
  ResourceContract,
  ActionOptions,
  ActionContract,
} from "./helpers.js";

// ============================================================================
// Document Lifecycle (ADR-0009)
// ============================================================================

export { documentLifecycle } from "./document-lifecycle.js";

export type {
  DocumentLifecycleState,
  DocumentLifecycleOptions,
  DocumentLifecycleActions,
} from "./document-lifecycle.js";

// ============================================================================
// Realtime (ADR-0006)
// ============================================================================

export { realtimeEventSchema } from "./realtime.js";

export type { RealtimeEvent } from "./realtime.js";

// ============================================================================
// Example Contract (Reference)
// ============================================================================

export {
  invoiceResource,
  invoiceLifecycle,
  sendInvoiceAction,
  invoiceDraft,
  invoicePosted,
  invoiceListItem,
  invoiceCreateInput,
  invoiceUpdateInput,
} from "./example.js";

export type {
  InvoiceDraft,
  InvoicePosted,
  InvoiceListItem,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  SendInvoiceInput,
  SendInvoiceOutput,
} from "./example.js";
