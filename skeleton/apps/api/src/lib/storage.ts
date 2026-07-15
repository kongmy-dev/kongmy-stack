/**
 * Storage Seam (ADR-0006, ADR-0002)
 *
 * Interface for presigned direct upload model: create upload URL, create download URL, delete.
 * Used by: routes for file handling, frontend for presigned S3/GCS uploads.
 *
 * Implementations:
 * 1. inMemoryStorage: Per-organization file registry. Used in tests + local dev.
 * 2. Real adapters: S3 (presigned URLs), GCS, etc. (Placeholder for future phases).
 *
 * Pattern: routes call storage.createUploadUrl() → return presigned URL to client
 * → client uploads directly to storage backend → routes call storage.createDownloadUrl()
 * FileRef scalar from packages/contract.
 */

import type { FileRef } from "@kongmy-stack/contract";

export interface UploadUrlInfo {
  url: string;
  fileRef: FileRef;
  expiresAt: string; // ISO-8601 UTC
}

export interface StorageAdapter {
  /**
   * Create a presigned upload URL (valid for limited time).
   * Returns the URL, a FileRef for storage metadata, and expiration time.
   */
  createUploadUrl(input: {
    organizationId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadUrlInfo>;

  /**
   * Create a presigned download URL for an existing file.
   * Valid for limited time; links are single-use per storage backend semantics.
   */
  createDownloadUrl(fileRef: FileRef): Promise<string>;

  /**
   * Delete a file by its FileRef.
   */
  delete(fileRef: FileRef): Promise<void>;

  /**
   * Get stored bytes for a file (for tests / round-trip verification).
   * Returns null if not found.
   */
  getBytes(fileRef: FileRef): Promise<Buffer | null>;

  /**
   * Clear all files (for test isolation).
   */
  clear(): void;
}

/**
 * In-memory storage: stores file bytes indexed by FileRef key.
 * Upload URLs are fake but functional; download URLs return the stored bytes.
 * Used during development and in tests.
 */
export function inMemoryStorage(): StorageAdapter & { _storeBytes(fileRef: FileRef, bytes: Buffer): void } {
  const files: Map<string, Buffer> = new Map();

  return {
    async createUploadUrl(input) {
      // Generate a fake key (in reality, would be UUID or unique per backend)
      const key = `${input.organizationId}/${Date.now()}_${Math.random().toString(36).substring(7)}/${input.fileName}`;
      const fileRef: FileRef = {
        key,
        mime: input.mimeType,
        size: input.sizeBytes,
        name: input.fileName,
      };

      // Presigned URL is fake but includes the key for testing
      const url = `http://localhost:3000/upload/${key}`;
      const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

      return {
        url,
        fileRef,
        expiresAt,
      };
    },

    async createDownloadUrl(fileRef) {
      // In real impl, would generate a presigned URL from storage backend
      // For tests, just return a download URL that references the key
      return `http://localhost:3000/download/${fileRef.key}`;
    },

    async delete(fileRef) {
      files.delete(fileRef.key);
    },

    async getBytes(fileRef) {
      return files.get(fileRef.key) || null;
    },

    clear() {
      files.clear();
    },

    /**
     * Internal: store bytes for a file (called after simulated upload in tests).
     * Exposed for testing round-trip: upload → store → download.
     */
    _storeBytes(fileRef: FileRef, bytes: Buffer) {
      files.set(fileRef.key, bytes);
    },
  };
}
