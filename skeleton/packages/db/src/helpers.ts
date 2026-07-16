/**
 * DB helpers — ULID generation, sequence allocation, and utilities.
 *
 * Per ADR-0004 + 0009: prefixed ULIDs for PKs, gapless document sequences via SQL.
 * Per ADR-0005: conventions for createdAt/updatedAt (set in repo layer).
 *
 * No I/O inside these helpers; they're used by repo functions.
 */

import { ulid } from "ulid";

/**
 * Raw SQL executor interface.
 * Implemented by PGlite and postgres drivers via query() or exec().
 */
export interface RawExecutor {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Generate a prefixed ULID for a given entity.
 * Example: generateId('inv') → 'inv_01J8AUZC1234567890ABCDEF'
 *
 * Per ADR-0004: all PKs are prefixed ULIDs for easy cross-tenant filtering,
 * audit trails, and client-side tracing.
 */
export function generateId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

/**
 * Allocate the next gapless document sequence number.
 *
 * Per ADR-0009: gapless sequences for accounting documents via atomic row lock.
 *
 * ⚠️ HARD RULE: This MUST be called inside the SAME TRANSACTION that persists
 * the document. The gapless property depends on the ON CONFLICT … DO UPDATE
 * semantics rolling back together with the enclosing transaction. If you call
 * this outside the document transaction, the allocation commits but the document
 * insert/update may roll back, leaving gaps.
 *
 * Example (CORRECT):
 *   await tx.begin();
 *   const seqNumber = await allocateSequenceNumber(tx, org, series, year);
 *   await createDocument(tx, { ..., docNumber: seqNumber });
 *   await tx.commit();
 *
 * Example (WRONG — causes gaps):
 *   const seqNumber = await allocateSequenceNumber(db, org, series, year); // commits immediately
 *   // if this fails, seqNumber is burned:
 *   await createDocument(db, { ..., docNumber: seqNumber });
 *
 * SQL statement (atomic, single round-trip):
 *   INSERT INTO document_sequences (...) VALUES (...)
 *   ON CONFLICT (org_id, series, fiscal_year)
 *   DO UPDATE SET value = document_sequences.value + 1
 *   RETURNING value
 *
 * Returns the newly allocated sequence number (1-based).
 * If the sequence doesn't exist, creates it with value = 1.
 * If it exists, increments and returns.
 *
 * Gapless behavior: Proven on PGlite (single connection). Multi-worker
 * server-Postgres deployments should add a conformance test before relying
 * on gapless property under concurrent load.
 *
 * @param executor - raw database executor (PGlite or postgres)
 * @param orgId - organization ID
 * @param series - series name (e.g., "INV", "PO")
 * @param fiscalYear - fiscal year (e.g., 2026)
 * @returns the allocated sequence number (1-based)
 */
export async function allocateSequenceNumber(
  executor: RawExecutor,
  orgId: string,
  series: string,
  fiscalYear: number
): Promise<number> {
  // Generate a unique ID for this sequence row
  const seqId = generateId("seq");

  // Use raw SQL for atomic upsert with RETURNING
  const result = await executor.query(`
    INSERT INTO document_sequences
      (docseq_id, organization_id, series, fiscal_year, value, gapless, created_at, updated_at)
    VALUES
      ($1, $2, $3, $4, 1, true, now(), now())
    ON CONFLICT (organization_id, series, fiscal_year)
    DO UPDATE SET
      value = document_sequences.value + 1,
      updated_at = now()
    RETURNING value
  `, [seqId, orgId, series, fiscalYear]);

  // Extract the returned value
  if (!result.rows || result.rows.length === 0) {
    throw new Error(`Failed to allocate sequence for ${series}/${fiscalYear}`);
  }

  const row = result.rows[0];
  const value = row.value as unknown;

  if (typeof value !== "number") {
    throw new Error(`Invalid sequence value: ${value}`);
  }

  return value;
}

/**
 * Get the current sequence value without incrementing.
 * Useful for preflight checks or generating preview document numbers.
 * NOT atomic; value may have changed by the time you use it.
 *
 * @param executor - raw database executor
 * @param orgId - organization ID
 * @param series - series name (e.g., "INV")
 * @param fiscalYear - fiscal year
 * @returns the current value, or 0 if sequence doesn't exist
 */
export async function getCurrentSequenceValue(
  executor: RawExecutor,
  orgId: string,
  series: string,
  fiscalYear: number
): Promise<number> {
  const result = await executor.query(`
    SELECT value FROM document_sequences
    WHERE organization_id = $1
    AND series = $2
    AND fiscal_year = $3
  `, [orgId, series, fiscalYear]);

  if (!result.rows || result.rows.length === 0) {
    return 0;
  }

  const row = result.rows[0];
  const value = row.value as unknown;

  return typeof value === "number" ? value : 0;
}

/**
 * Format a document number given a series, fiscal year, and sequence.
 * Example: formatDocumentNumber("INV", 2026, 42) → "INV-2026-00042"
 *
 * Per ADR-0009: DocumentNumber format is {series}-{fiscalYear}-{seq}
 * with zero-padding for the sequence (5 digits by convention, adjust as needed).
 */
export function formatDocumentNumber(
  series: string,
  fiscalYear: number,
  sequence: number
): string {
  const paddedSeq = String(sequence).padStart(5, "0");
  return `${series}-${fiscalYear}-${paddedSeq}`;
}

/**
 * Get the current timestamp in ISO-8601 format (UTC).
 * Used by repo functions to set createdAt/updatedAt.
 * Per ADR-0005: all timestamps are UTC strings, set at the repo layer.
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}
