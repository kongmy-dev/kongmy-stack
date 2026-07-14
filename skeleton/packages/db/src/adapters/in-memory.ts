/**
 * In-memory adapter — PGlite running in-memory for testing.
 *
 * Per ADR-0005: in-memory adapters for tests + PGlite for embedded deployments.
 * Per ADR-0002: seam interface (db) with swappable implementations.
 *
 * This is NOT a mock or fake. It's PGlite's real Postgres-compatible database
 * running without persistent storage. All SQL semantics are preserved,
 * including transactions, sequences, row locks, and UNIQUE constraints.
 *
 * Each test file should create a fresh instance to ensure isolation.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "../schema";

export type DbInstance = PgDatabase<
  any,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Create a fresh in-memory database instance.
 * Data is ephemeral; lost on process exit or when this instance is garbage-collected.
 * Schema is initialized immediately.
 */
export async function createInMemoryAdapter(): Promise<DbInstance & { rawDb: PGlite }> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });

  // Initialize all tables
  await initializeSchema(pg);

  return Object.assign(db, { rawDb: pg });
}

/**
 * Initialize the schema on a fresh in-memory instance.
 * Creates all tables with their columns and constraints.
 *
 * This is IDEMPOTENT via CREATE TABLE IF NOT EXISTS,
 * so it's safe to call on startup or between tests.
 */
async function initializeSchema(pg: PGlite): Promise<void> {
  // Create organizations table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      org_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create branches table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      branch_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create users table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create roles table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      role_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      permission_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create memberships table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS memberships (
      membership_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create audit_log table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      audit_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      autonomy_level TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create document_sequences table with UNIQUE constraint
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS document_sequences (
      docseq_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      series TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      gapless BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
      UNIQUE(organization_id, series, fiscal_year)
    )
  `);

  // Create invoices table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      inv_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create better_auth_user table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS better_auth_user (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      name TEXT,
      image TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create better_auth_session table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS better_auth_session (
      id TEXT PRIMARY KEY,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL
    )
  `);

  // Create better_auth_account table with password column (ADR-0008 credentials)
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS better_auth_account (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      password TEXT,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at TIMESTAMP WITH TIME ZONE,
      refresh_token_expires_at TIMESTAMP WITH TIME ZONE,
      scope TEXT,
      id_token TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create better_auth_verification table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS better_auth_verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE
    )
  `);
}
