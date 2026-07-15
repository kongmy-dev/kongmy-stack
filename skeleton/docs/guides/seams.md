# Seam Pattern & Implementation Guide

**Status:** Complete (Wave D, thread D2)

Per ADR-0002 and ADR-0006, a **seam** is the load-bearing abstraction pattern in kongmy-stack: an interface + multiple implementations that allows swapping behavior without changing caller code.

## The Seam Pattern

### Structure

```typescript
// 1. Interface: defines the contract
export interface Storage {
  createUploadUrl(...): Promise<...>;
  delete(fileRef): Promise<void>;
  // ... other methods
}

// 2. In-memory implementation: for tests + local dev
export function inMemoryStorage(): Storage {
  return {
    createUploadUrl(...) { /* fake but functional */ },
    delete(fileRef) { /* store in memory */ },
    // ...
  };
}

// 3. Real implementation (later): S3, GCS, etc.
// (Placeholder for first pull; added when needed)
```

### Why This Works

- **Decoupling**: routes/services depend on the interface, not the implementation
- **Testability**: in-memory fakes avoid I/O, work offline, support isolation
- **Swappability**: real impl added later without touching callers
- **No versioning**: interface + single-impl means no compatibility matrix
- **Grep-friendly**: no inheritance or factory ceremonies—straight function calls

## Seams in the Skeleton

| Seam | Location | Interface | In-Memory | Real (Swap Point) | Status |
|---|---|---|---|---|---|
| **Realtime Publisher** | `lib/realtime.ts` | `RealtimePublisher` | per-org subscriber registry | Redis/Kafka | ✅ Complete (Wave C) |
| **Notifier** | `lib/notifier.ts` | `Notifier` | draft-only (no send) | Email/Telegram/Lark adapters | ✅ Complete (Wave C) |
| **Storage** | `lib/storage.ts` | `StorageAdapter` | byte registry in memory | S3/GCS presigned URLs | ✅ Complete (Wave D) |
| **HTTP Caching** | `lib/cache.ts` | `cacheControlMiddleware()` + `cacheable()` helper | middleware + helper functions | no-op (middleware is the seam) | ✅ Complete (Wave D) |
| **Impersonation** | `lib/impersonation.ts` | `impersonate(ctx, userId)` | in-memory + audit write | audit trail required on all impls | ✅ Complete (Wave D) |
| **Session** | `lib/session.ts` | `SessionProvider` | header-based (test) | BetterAuth (production) | ✅ Complete (Wave C) |

## Detailed Seams

### Storage Seam

**File:** `skeleton/apps/api/src/lib/storage.ts`

**Problem Solved:**
- Routes need to create presigned upload URLs, create download URLs, delete files
- Tests must verify file round-trips without S3/GCS credentials
- Real deployments swap S3 impl without touching route code

**Interface:**
```typescript
export interface StorageAdapter {
  createUploadUrl(input: { organizationId, fileName, mimeType, sizeBytes }): Promise<UploadUrlInfo>;
  createDownloadUrl(fileRef: FileRef): Promise<string>;
  delete(fileRef: FileRef): Promise<void>;
  getBytes(fileRef: FileRef): Promise<Buffer | null>;
  clear(): void; // test isolation
}
```

**In-Memory Implementation:**
- Stores file bytes in a `Map<string, Buffer>`
- Presigned URLs are fake (`http://localhost:3000/upload/{key}`)
- `_storeBytes()` method for tests to simulate upload
- Used in tests + local dev

**Swap Point for Real Impl:**
```typescript
// S3 implementation (future)
export function s3Storage(s3Client: S3Client): StorageAdapter {
  return {
    async createUploadUrl(input) {
      // Generate S3 presigned PUT URL
      return { url: "https://bucket.s3.amazonaws.com/...", fileRef: {...} };
    },
    async createDownloadUrl(fileRef) {
      // Generate S3 presigned GET URL
    },
    // ...
  };
}

// In main.ts, swap by env:
const storage = deps.env.STORAGE_TYPE === "s3" 
  ? s3Storage(s3Client) 
  : inMemoryStorage();
```

**Verified Tests:**
- Round-trip: upload → store → download
- Expiry honored (URLs have ISO-8601 expiresAt)
- Delete removes file
- Null for non-existent files
- Clear() for test isolation

---

### HTTP Caching Seam

**File:** `skeleton/apps/api/src/lib/cache.ts`

**Problem Solved:**
- Per ADR-0004: default is `Cache-Control: no-store` (no caching)
- Public reads can opt into caching with `Cache-Control: public, max-age=X`
- Middleware must not break SSE (streaming) responses
- Centralized cache policy per ADR-0006

**Implementation (Middleware + Helpers):**

```typescript
// Middleware: sets default no-store on every response
export function cacheControlMiddleware() {
  return async (ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    await next();
  };
}

// Helper: opt into caching for public reads
export function cacheable(ctx, seconds: number): void {
  ctx.header("Cache-Control", `public, max-age=${seconds}`);
}
```

**Wiring:**
- Middleware inserted in `main.ts` after logger/cors (early in stack)
- Routes call `cacheable(ctx, 3600)` for public reads
- Private routes (with auth) skip `cacheable()` → default no-store protects data

**Rules:**
- ✅ Unauthenticated routes can call `cacheable()`
- ✅ SSE routes still work (they set their own streaming headers)
- ✅ Default protects private data (no-store)
- ❌ Never cache authenticated responses

**Verified Tests:**
- Default middleware adds `Cache-Control: no-store` to all responses
- `cacheable()` overrides with `public, max-age=<seconds>`
- SSE route (text/event-stream) not broken by cache middleware
- `noCache()` helper sets `no-cache` (for revalidation)

---

### Impersonation Seam

**File:** `skeleton/apps/api/src/lib/impersonation.ts`

**Problem Solved:**
- Admins need to troubleshoot user issues by viewing as that user
- ADR-0010 requires audit trail of who impersonated whom
- Auth check must happen before audit write
- Context must carry impersonation metadata

**Interface:**
```typescript
export async function impersonate(
  ctx: AppContext,
  targetUserId: string
): Promise<ImpersonationContext>;
```

**Implementation:**
1. Check permission `user:impersonate` (throws `ForbiddenError` if missing)
2. Write audit row with original user ID, action = `user:impersonate`, resource_id = targetUserId
3. Return new context with:
   - `user.id` = targetUserId
   - `impersonatedBy = { userId: original, userRoles: ... }`

**Audit Logging:**
```typescript
INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at, details)
VALUES ($1, $2, $3, 'user:impersonate', 'user', $6, 'auto', $8, JSON.stringify({ targetUserId }))
// Parameterized query per ADR-0010 (no string interpolation)
```

**Usage:**
```typescript
app.post("/admin/impersonate/:userId", async (ctx) => {
  const targetUserId = ctx.req.param("userId");
  const newCtx = await impersonate(ctx.var, targetUserId);
  
  // Now newCtx.user.id is targetUserId
  // Downstream code respects the impersonated identity
  // Audit log shows who did the impersonation
  
  return ctx.json({ ok: true, impersonatedAs: targetUserId });
});
```

**Verified Tests:**
- Impersonation requires `user:impersonate` permission (ForbiddenError if missing)
- User identity switched to target
- `impersonatedBy` field added to context
- Audit log entry written

---

### Tenant Lifecycle

**File:** `skeleton/scripts/new-tenant.ts`

**Purpose:**
- Create new organization + branch + default roles
- Idempotent by organization name (lookup returns existing org if found)
- Export `createTenant(db, config)` function and CLI wrapper
- Resolve database from `DATABASE_URL` env (file-backed PGlite or postgres)

**Function Signature:**
```typescript
export async function createTenant(db: DbInstance, config: TenantConfig): Promise<TenantCreateResult>;

interface TenantCreateResult {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  roles: { admin: string; user: string };
  created: boolean; // true if new, false if already existed
}
```

**CLI Usage:**
```bash
# With file-backed PGlite
DATABASE_URL="file:./dev.db" bun scripts/new-tenant.ts "Acme Corp"
# {"organizationId": "org_...", "organizationName": "Acme Corp", ..., "created": true}

# Second run with same name (idempotent)
DATABASE_URL="file:./dev.db" bun scripts/new-tenant.ts "Acme Corp"
# {"organizationId": "org_...", "organizationName": "Acme Corp", ..., "created": false}

# With postgres URL
DATABASE_URL="postgres://user:pass@localhost/db" bun scripts/new-tenant.ts "Acme Corp"

# Falls back to in-memory if DATABASE_URL not set
bun scripts/new-tenant.ts "Test Corp"
# ⚠️ Data will be lost on exit
```

**Idempotency Implementation:**
- Looks up existing org by **name** (idempotency key)
- Adds `UNIQUE(name)` constraint to organizations table if needed
- First call: creates org+branch+roles, returns `created: true`
- Subsequent calls: returns same ids with `created: false`
- Works across process boundaries when DATABASE_URL points to persistent storage

**Default Roles:**
- **admin**: all invoice permissions
- **user**: all invoice permissions except delete

**Test Coverage (in-process):**
- `scripts/new-tenant.test.ts`: calls createTenant twice against same adapter
- Verifies second call returns SAME ids with `created: false`
- Idempotency proven across multiple repeated calls

---

## Common Gotchas

### Storage Seam

1. **FileRef must come from contract scalar** (`packages/contract/scalars.ts`)
   - Do NOT add FileRef to contract in this phase (outside boundary)
   - Existing FileRef has `key`, `mime`, `size`, `name`
   - Use as-is; real impl may expand it later

2. **Presigned URLs have expiration**
   - In-memory: 1 hour (ISO-8601)
   - Real S3: varies (30 min to 24h config)
   - Test verifies expiration is in future

3. **Upload model: direct to storage backend**
   - Route creates URL, returns to client
   - Client uploads directly (no pass-through)
   - Route calls storage again to verify/reference the file
   - Reduces bandwidth + load on API

### Cache Seam

1. **Middleware MUST run early**
   - Before auth, before business logic
   - Sets default `no-store` on all responses
   - Routes opt in with `cacheable()`

2. **SSE streaming is fragile**
   - Text/event-stream response
   - Cache headers must not interfere
   - Test verifies content-type preserved

3. **Never cache authenticated responses**
   - Even if `cacheable()` is called
   - Real impl: check `ctx.session` and skip caching
   - For now: relying on caller discipline + tests

### Impersonation Seam

1. **Audit BEFORE switching**
   - Current user ID must be in audit row
   - Parameterized query (no string interpolation)
   - ADR-0010 requirement

2. **Permission check before audit**
   - `authz.assert("user:impersonate")` first
   - Throws `ForbiddenError` before DB write
   - No log entry for denied attempts (security)

3. **impersonatedBy is metadata, not auth**
   - Routes downstream should log it
   - Session/JWT still holds original user (for tokens)
   - Impersonation is per-request context only

### Tenant Lifecycle

1. **Idempotency requires UNIQUE constraints**
   - Organizations uniqueness: slug
   - Branches uniqueness: (org_id, code)
   - Roles uniqueness: (org_id, name)
   - ON CONFLICT DO NOTHING handles re-runs

2. **Role permissions are JSON arrays**
   - `permission_ids` column stores JSON: `["invoice:read", "invoice:create", ...]`
   - Admin: all permissions
   - User: all except delete
   - Extensible later (more roles, more perms)

---

## Testing Pattern

All seams follow this testing pattern:

```typescript
describe("Seam Name", () => {
  // 1. Setup: create in-memory instance + test app
  let testApp = await createTestApp();

  // 2. Verify basic operation (happy path)
  it("does the thing", async () => {
    const result = await seam.operation(...);
    expect(result).toMatchObject({ ... });
  });

  // 3. Verify edge cases (boundaries, null, errors)
  it("handles missing data", async () => {
    const result = await seam.operation(nonExistent);
    expect(result).toBeNull();
  });

  // 4. Verify auth/permission gates
  it("enforces permission check", async () => {
    expect(() => await seam.operation(ctx)).toThrow(ForbiddenError);
  });

  // 5. Verify isolation (clear for next test)
  it("clears state for test isolation", async () => {
    seam.clear();
    expect(seam.getAll()).toEqual([]);
  });
});
```

## Swap Instructions (Future)

When implementing a real seam (e.g., S3 storage):

1. **Create new file:** `skeleton/apps/api/src/lib/storage-s3.ts`
2. **Implement interface:** `StorageAdapter`
3. **Add integration tests** (with test credentials or mock S3)
4. **Update main.ts:**
   ```typescript
   import { s3Storage } from "./lib/storage-s3.js";
   
   const storage = deps.env.STORAGE_BACKEND === "s3"
     ? s3Storage(s3Client)
     : inMemoryStorage();
   ```
5. **Add to AppContext** if needed (e.g., `ctx.storage = storage`)
6. **No other code changes required** (routes/services already use the interface)

---

## References

- **ADR-0002:** Pattern vocabulary (seams vs. inheritance)
- **ADR-0006:** Seam interfaces (contract now, impl on first pull)
- **ADR-0010:** Audit logging (parameterized queries, append-only)
- **ADR-0004:** API design (no versioning, additive evolution)
