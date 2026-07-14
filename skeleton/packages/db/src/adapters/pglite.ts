/**
 * PGlite adapter — in-memory Postgres-compatible database.
 *
 * Per ADR-0005: PGlite for tests and embedded deployments.
 * Per ADR-0002: seam interface (db) with swappable implementations.
 *
 * @electric-sql/pglite provides a WASM Postgres runtime that runs in JS.
 * Returns a drizzle PgDatabase instance compatible with all repo functions.
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
 * Create an in-memory PGlite instance.
 * Ideal for tests; data is lost on process exit.
 * Migrations still required (schema is empty at start).
 */
export async function createPGliteAdapter(): Promise<DbInstance> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });

  // Seed the schema on startup
  await seedSchema(pg);

  return db;
}

/**
 * Create a PGlite instance with persistent storage.
 * Pass a file path like "data/test.db" for durability.
 */
export async function createPGliteAdapterWithFile(
  filePath: string
): Promise<DbInstance> {
  const pg = new PGlite(`file://${filePath}`);
  const db = drizzle(pg, { schema });

  await seedSchema(pg);

  return db;
}

/**
 * Initialize schema on a fresh PGlite instance.
 * Runs the full DDL to create all tables.
 */
async function seedSchema(pg: PGlite): Promise<void> {
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

  // Create document_sequences table
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
}
