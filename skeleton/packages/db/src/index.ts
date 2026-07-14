/**
 * @kongmy-stack/db — database layer with multi-adapter support.
 *
 * Exports:
 * - Adapters: createInMemoryAdapter, createPGliteAdapter, createPostgresAdapter
 * - Schema: organizations, branches, users, roles, memberships, audit_log, document_sequences, invoices
 * - Helpers: generateId, allocateSequenceNumber, getCurrentSequenceValue, formatDocumentNumber, getCurrentTimestamp
 * - Repos: invoiceRepo (example)
 * - Scope: withScope, assertEntityInScope, TenantScope
 * - Types: Invoice, InvoiceInput, DbInstance, RawExecutor
 */

// Adapters
export { createInMemoryAdapter } from "./adapters/in-memory";
export { createPGliteAdapter, createPGliteAdapterWithFile } from "./adapters/pglite";
export {
  createPostgresAdapter,
  closePostgresAdapter,
  type DbInstance,
} from "./adapters/postgres";

// Schema
export {
  organizations,
  branches,
  users,
  roles,
  memberships,
  auditLog,
  documentSequences,
  invoices,
} from "./schema";

// Helpers
export {
  generateId,
  allocateSequenceNumber,
  getCurrentSequenceValue,
  formatDocumentNumber,
  getCurrentTimestamp,
  type RawExecutor,
} from "./helpers";

// Repos
export { invoiceRepo, type Invoice, type InvoiceInput } from "./repos";

// Scope
export {
  withScope,
  assertEntityInScope,
  type TenantScope,
  type ScopedRepo,
} from "./with-scope";
