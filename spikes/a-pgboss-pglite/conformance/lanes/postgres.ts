/**
 * Lane: PostgreSQL server
 *
 * This lane runs pg-boss against a live PostgreSQL 16 server.
 * Assumes a server is running at localhost:5433.
 */

import { PgBoss } from "pg-boss";
import type { QueueLane } from "../suite.ts";

const PG_CONNECTION_STRING =
  process.env.PG_CONNECTION_STRING ||
  "postgres://postgres:spike@localhost:5433/postgres";

// Test database name (separate from default postgres db to avoid conflicts)
const TEST_DB = "pgboss_conformance_test";

export async function createPostgresLane(): Promise<QueueLane> {
  console.log("Initializing PostgreSQL lane...");
  console.log(`Connection: ${PG_CONNECTION_STRING.split("@")[1] || "localhost:5433"}`);

  // First, verify connection to the default database
  try {
    const tempBoss = new PgBoss({
      connectionString: PG_CONNECTION_STRING,
    });

    // Test connection by getting queue list
    await tempBoss.start();
    console.log("✓ PostgreSQL connection verified");

    // Clean up temp boss
    await tempBoss.stop();
  } catch (error) {
    throw new Error(
      `Failed to connect to PostgreSQL: ${
        error instanceof Error ? error.message : String(error)
      }. ` +
      `Ensure Postgres 16 is running at ${PG_CONNECTION_STRING.split("@")[1] || "localhost:5433"}`
    );
  }

  // Initialize pg-boss with the connection string
  const boss = new PgBoss({
    connectionString: PG_CONNECTION_STRING,
    newJobCheckInterval: 100,
    // Use the schema 'pgboss' to isolate conformance tests
    schema: "pgboss",
  });

  await boss.start();
  console.log("✓ pg-boss started\n");

  return {
    name: "postgres",
    boss,
    cleanup: async () => {
      console.log("Cleaning up postgres lane...");
      // We keep the postgres data and schema for inspection
      // (restart tests depend on this persistence)
      await boss.stop();
      console.log("Postgres schema preserved for restart tests");
    },
  };
}

export async function cleanupPostgresSchema() {
  // This is optional cleanup for completely wiping conformance test data
  // For safety, we don't auto-clean; operators should manage this manually
  console.log(
    `To clean up test data, connect to postgres and run: DROP SCHEMA IF EXISTS pgboss CASCADE;`
  );
}
