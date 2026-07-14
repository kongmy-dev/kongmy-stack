/**
 * Postgres adapter — production database using postgres-js driver.
 *
 * Per ADR-0005: Postgres at every altitude (PGlite → local → Neon).
 * Per ADR-0002: seam interface (db) with swappable implementations.
 *
 * Connects to a server-side Postgres instance via postgres-js driver.
 * Returns a drizzle PgDatabase instance compatible with all repo functions.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "../schema";

export type DbInstance = PgDatabase<
  any,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Create a Postgres adapter connected to a remote server.
 * Expects DSN in environment or as parameter.
 */
export async function createPostgresAdapter(dsn: string): Promise<DbInstance> {
  const client = postgres(dsn);
  const db = drizzle(client, { schema });

  // Test the connection
  await client`SELECT 1`;

  return db;
}

/**
 * Close the Postgres connection pool.
 * Must be called before process exit to drain pending queries.
 */
export async function closePostgresAdapter(
  client: postgres.Sql
): Promise<void> {
  await client.end();
}
