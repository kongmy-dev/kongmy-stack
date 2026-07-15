/**
 * Storage seam tests (ADR-0006, ADR-0002)
 *
 * Tests:
 * 1. Round-trip upload → store → download through the fake implementation
 * 2. Expiry honored (URLs have expiration times)
 * 3. Delete removes the file
 * 4. Null returned for non-existent files
 */

import { describe, it, expect } from "bun:test";
import { inMemoryStorage } from "./storage.js";

describe("Storage Adapter (In-Memory)", () => {
  it("creates upload URL with FileRef and expiration", async () => {
    const storage = inMemoryStorage();

    const uploadInfo = await storage.createUploadUrl({
      organizationId: "org_123",
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(uploadInfo.url).toContain("http://localhost:3000/upload/");
    expect(uploadInfo.fileRef.key).toBeDefined();
    expect(uploadInfo.fileRef.mime).toBe("application/pdf");
    expect(uploadInfo.fileRef.size).toBe(2048);
    expect(uploadInfo.fileRef.name).toBe("invoice.pdf");

    // Verify expiration is a valid ISO string (ends with Z for UTC)
    expect(uploadInfo.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Verify expiration is in the future (should be ~1 hour)
    const expiresAtDate = new Date(uploadInfo.expiresAt);
    const nowDate = new Date();
    expect(expiresAtDate.getTime() > nowDate.getTime()).toBe(true);
  });

  it("round-trip: upload, store, and download", async () => {
    const storage = inMemoryStorage();

    // Step 1: Create upload URL
    const uploadInfo = await storage.createUploadUrl({
      organizationId: "org_123",
      fileName: "data.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
    });

    // Step 2: Simulate client upload by storing bytes
    const fileContent = Buffer.from("Hello, World!");
    (storage as any)._storeBytes(uploadInfo.fileRef, fileContent);

    // Step 3: Create download URL
    const downloadUrl = await storage.createDownloadUrl(uploadInfo.fileRef);
    expect(downloadUrl).toContain(uploadInfo.fileRef.key);

    // Step 4: Retrieve bytes (simulating download)
    const retrievedBytes = await storage.getBytes(uploadInfo.fileRef);
    expect(retrievedBytes).toEqual(fileContent);
  });

  it("delete removes the file", async () => {
    const storage = inMemoryStorage();

    // Create and store a file
    const uploadInfo = await storage.createUploadUrl({
      organizationId: "org_123",
      fileName: "temp.txt",
      mimeType: "text/plain",
      sizeBytes: 50,
    });

    const fileContent = Buffer.from("temporary");
    (storage as any)._storeBytes(uploadInfo.fileRef, fileContent);

    // Verify it exists
    let retrieved = await storage.getBytes(uploadInfo.fileRef);
    expect(retrieved).toEqual(fileContent);

    // Delete it
    await storage.delete(uploadInfo.fileRef);

    // Verify it's gone
    retrieved = await storage.getBytes(uploadInfo.fileRef);
    expect(retrieved).toBeNull();
  });

  it("returns null for non-existent files", async () => {
    const storage = inMemoryStorage();

    const bytes = await storage.getBytes({
      key: "nonexistent_key",
      mime: "text/plain",
      size: 0,
      name: "ghost.txt",
    });

    expect(bytes).toBeNull();
  });

  it("clear() removes all files", async () => {
    const storage = inMemoryStorage();

    // Create and store multiple files
    const upload1 = await storage.createUploadUrl({
      organizationId: "org_123",
      fileName: "file1.txt",
      mimeType: "text/plain",
      sizeBytes: 50,
    });

    const upload2 = await storage.createUploadUrl({
      organizationId: "org_123",
      fileName: "file2.txt",
      mimeType: "text/plain",
      sizeBytes: 50,
    });

    (storage as any)._storeBytes(upload1.fileRef, Buffer.from("content1"));
    (storage as any)._storeBytes(upload2.fileRef, Buffer.from("content2"));

    // Verify both exist
    expect(await storage.getBytes(upload1.fileRef)).toBeTruthy();
    expect(await storage.getBytes(upload2.fileRef)).toBeTruthy();

    // Clear all
    storage.clear();

    // Verify both are gone
    expect(await storage.getBytes(upload1.fileRef)).toBeNull();
    expect(await storage.getBytes(upload2.fileRef)).toBeNull();
  });
});
