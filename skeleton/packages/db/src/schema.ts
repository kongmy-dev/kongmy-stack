/**
 * Schema definitions — all tables with conventions.
 *
 * Per ADR-0005:
 * - pk: prefixed ULID (e.g., inv_01J8...)
 * - createdAt/updatedAt: UTC, set in repo layer
 * - No soft delete by default
 *
 * Per ADR-0008: roles/memberships tables with seeded defaults
 * Per ADR-0010: audit_log append-only table
 * Per ADR-0009: document_sequence table with gapless option
 *
 * All tables use these column helpers to maintain consistency.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Utility: create a prefixed ULID primary key column.
 * Example: id('inv') → inv_01J8AUZC... column
 *
 * Branded types happen at the service layer via zod scalars (ADR-0004/0009).
 * At the DB layer, they're just strings with a runtime check.
 *
 * NOTE: Using random UUID default here for simplicity; real code would use
 * ulid() package to generate proper ULIDs with prefixes. See helpers.ts.
 */
export const prefixedId = (prefix: string) =>
  text(`${prefix}_id`).primaryKey();

/**
 * Utility: timestamp columns for audit trail.
 * Set by the repo layer on INSERT/UPDATE, never by the database.
 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull();

/**
 * Utility: tenant foreign key.
 * All tables (except organizations) reference an organization_id.
 */
export const organizationIdFk = () =>
  text("organization_id").notNull();

/**
 * Organizations — the top-level tenant boundary.
 * Per ADR-0003: modular monolith with tenancy.
 */
export const organizations = pgTable("organizations", {
  id: prefixedId("org"),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Branches — sub-tenant scope within an organization.
 * Per ADR-0008: membership carries branch-level scope constraints.
 */
export const branches = pgTable("branches", {
  id: prefixedId("branch"),
  organizationId: organizationIdFk(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Users — principals in the system.
 * Authentication details (password hash, OIDC claims) live in a separate auth system (BetterAuth/Keycloak).
 * This table is for authorization state only.
 */
export const users = pgTable("users", {
  id: prefixedId("user"),
  organizationId: organizationIdFk(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Roles — tenant-scoped authorization roles.
 * Per ADR-0008: roles are data, not code. Seeded with defaults per tenant.
 * permission_ids are generated at runtime from contract resource/action definitions.
 */
export const roles = pgTable("roles", {
  id: prefixedId("role"),
  organizationId: organizationIdFk(),
  name: text("name").notNull(),
  description: text("description"),
  permissionIds: jsonb("permission_ids").notNull().$type<string[]>().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Memberships — links users to roles within a branch.
 * Per ADR-0008: membership carries branch-level scope constraints.
 * Multiple memberships per user are allowed (multi-branch access).
 */
export const memberships = pgTable("memberships", {
  id: prefixedId("membership"),
  organizationId: organizationIdFk(),
  branchId: text("branch_id").notNull(),
  userId: text("user_id").notNull(),
  roleId: text("role_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * AuditLog — append-only record of all commands that modified state.
 * Per ADR-0010: written at the command door (one place, covers REST + MCP + agents).
 * Autonomy level recorded (suggest/assist/auto).
 */
export const auditLog = pgTable("audit_log", {
  id: prefixedId("audit"),
  organizationId: organizationIdFk(),
  userId: text("user_id"),
  action: text("action").notNull(), // e.g. "invoice:create", "payment:post"
  resourceType: text("resource_type").notNull(), // e.g. "invoice"
  resourceId: text("resource_id").notNull(), // the entity modified
  autonomyLevel: text("autonomy_level").notNull(), // "suggest" | "assist" | "auto"
  details: jsonb("details"), // what changed (optional)
  createdAt: createdAt(),
});

/**
 * DocumentSequence — per-tenant, per-series sequence counter for gapless document numbers.
 * Per ADR-0009: gapless option for accounting documents via atomic row-locking.
 * Example: series="INV", fiscalYear=2026, value=42 → next number is 43
 *
 * For gapless sequences, the allocate() function locks this row in a transaction,
 * increments value, and returns it. Non-gapless sequences use regular integers.
 */
export const documentSequences = pgTable("document_sequences", {
  id: prefixedId("docseq"),
  organizationId: organizationIdFk(),
  series: text("series").notNull(), // e.g. "INV", "PO", "SO"
  fiscalYear: integer("fiscal_year").notNull(), // e.g. 2026
  value: integer("value").notNull().default(0), // current sequence counter
  gapless: boolean("gapless").notNull().default(true), // if true, use row-lock; if false, use fast path
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Example resource: invoices.
 * Exercises prefixed ULID pk, createdAt/updatedAt, scope constraint.
 * Per ADR-0005: no soft delete by default.
 */
export const invoices = pgTable("invoices", {
  id: prefixedId("inv"),
  organizationId: organizationIdFk(),
  branchId: text("branch_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  customerName: text("customer_name").notNull(),
  amount: integer("amount").notNull(), // in minor units (cents)
  status: text("status").notNull().default("draft"), // draft | posted | cancelled
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
