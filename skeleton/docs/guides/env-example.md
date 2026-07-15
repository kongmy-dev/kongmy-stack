# Environment Configuration via .env.example

**Status**: Implemented (ADR-0005)  
**Audience**: Platform developers, deployment engineers  
**Scope**: Schema-driven .env generation, reproducible verification flow

---

## Problem

Manual .env.example files drift from the actual schema, leading to:
- Missing variables at boot time (hard to debug)
- Inconsistent documentation vs. implementation
- No single source of truth for env contracts

Per ADR-0005: configuration is zod-validated, fail-fast on boot with the full list of missing/invalid vars.

---

## Solution

**Seam interface**: `apps/api/src/env.ts` exports a `generateEnvExample()` function derived directly from the zod `envSchema`. A build-time script (`scripts/gen-env-example.ts`) calls it and writes `.env.example`, keeping docs and schema in sync.

### How it works

```
┌─────────────────────────┐
│ apps/api/src/env.ts     │
│ (envSchema: z.object)   │
└────────────┬────────────┘
             │
      generateEnvExample()
             │
             ▼
┌─────────────────────────┐
│ scripts/gen-env-example │ ──────┐
│ (extract + write)       │       │
└─────────────────────────┘       │
                                  │
                    ┌─────────────▼─────────────┐
                    │ .env.example (committed)  │
                    │ (in gitpush --git-ignore) │
                    └───────────────────────────┘
```

1. **Schema** (`envSchema`): defined in `apps/api/src/env.ts` using zod
   - Each field **must have** `.describe()` for documentation
   - `.default()` is propagated to the example file
   - `.optional()` fields are marked as optional in the example

2. **Generation** (`scripts/gen-env-example.ts`):
   ```bash
   bun run gen:env
   ```
   - Reads the schema at runtime
   - Iterates over fields, extracting description and default
   - Writes key-value pairs to `.env.example`
   - Reproducible: regen → `git diff --exit-code .env.example` → exit:0

3. **Verification**:
   ```bash
   bun run gen:env && git diff --exit-code .env.example
   ```
   - Non-zero exit if anything changed (CI gate)
   - Ensures schema and .env.example stay synchronized

---

## Implementation Details

### envSchema (apps/api/src/env.ts)

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z
    .string()
    .default("file::memory:")
    .describe("PGlite file path, postgres://, or omit for in-memory"),
  BETTER_AUTH_SECRET: z
    .string()
    .default("dev-secret-key")
    .describe("Session token secret for Bun.password operations"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().describe("OTLP collector endpoint; console default"),
  SENTRY_DSN: z.string().optional(),
});
```

- **`.describe()`**: Becomes a comment in .env.example
- **`.default()`**: Becomes the example value
- **`.optional()`**: Field line includes no value (empty right-hand side)

### generateEnvExample() (in envSchema module)

```typescript
export function generateEnvExample(): string {
  const lines: string[] = [];

  for (const [key, schema] of Object.entries(envSchema.shape)) {
    const zodSchema = schema as z.ZodType;
    const description = (zodSchema as any).description;
    const defaultValue = (zodSchema as any)._def?.defaultValue;

    if (description) {
      lines.push(`# ${description}`);
    }

    if (defaultValue !== undefined) {
      lines.push(`${key}=${defaultValue}`);
    } else {
      lines.push(`${key}=`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
```

### Script (scripts/gen-env-example.ts)

```typescript
#!/usr/bin/env bun
import { generateEnvExample } from "../apps/api/src/env.js";
import { writeFileSync } from "fs";
import { join } from "path";

const content = generateEnvExample();
const path = join(import.meta.dir, "..", ".env.example");

writeFileSync(path, content, "utf-8");
console.log(`✓ Generated .env.example (${content.length} bytes)`);
```

### package.json script

```json
{
  "scripts": {
    "gen:env": "bun scripts/gen-env-example.ts"
  }
}
```

### .env.example output

```
NODE_ENV=development

PORT=3000

# PGlite file path, postgres://, or omit for in-memory
DATABASE_URL=file::memory:

# Session token secret for Bun.password operations
BETTER_AUTH_SECRET=dev-secret-key

# OTLP collector endpoint; console default
OTEL_EXPORTER_OTLP_ENDPOINT=

OTEL_TRACE_ENABLED=false

SENTRY_DSN=
```

---

## Gotchas & Lessons

### Accessing Zod internals
Extracting `.describe()` and default values requires casting to `any` and reading `_def` properties:

```typescript
const description = (zodSchema as any).description;
const defaultValue = (zodSchema as any)._def?.defaultValue;
```

Zod's type definitions do not expose these at the type level; reflection requires unsafe access. Consider this stable within a version range and document the assumption in comments.

### Optional fields
Fields with `.optional()` are included in the example with an empty right-hand side:

```
# OTLP collector endpoint; console default
OTEL_EXPORTER_OTLP_ENDPOINT=
```

When loading, the env schema's default behavior (if any) or `undefined` takes precedence. Operators should copy and uncomment lines they need.

### Regeneration & CI gate
Add to your CI pipeline:

```bash
bun run gen:env && git diff --exit-code .env.example
```

This ensures that whenever `apps/api/src/env.ts` is changed, the example is regenerated. Failing the gate prevents commits with stale .env.example.

### No .env.example in .gitignore
The `.env.example` is **committed to git**. It's the canonical reference for deployments and developer onboarding.

The actual `.env` file (per developer/deployment) is `.gitignore`'d.

---

## Workflow

### Adding a new env variable

1. Edit `apps/api/src/env.ts`:
   ```typescript
   NEW_VAR: z.string().describe("Short description of what this does")
   ```

2. Run:
   ```bash
   bun run gen:env
   ```

3. Review changes:
   ```bash
   git diff .env.example
   ```

4. Commit both files:
   ```bash
   git add apps/api/src/env.ts .env.example
   git commit -m "feat(config): add NEW_VAR for..."
   ```

### In CI/CD

```yaml
- name: Verify .env.example is up-to-date
  run: bun run gen:env && git diff --exit-code .env.example
```

---

## Benefits

✅ **Single source of truth**: envSchema → .env.example (no drift)  
✅ **Type-safe**: zod schema is the contract; defaults are validated at runtime  
✅ **Self-documenting**: `.describe()` in the schema becomes comments in the example  
✅ **Reproducible**: regeneration produces identical output (deterministic)  
✅ **Fail-fast**: missing/invalid env fails at boot with full error list (ADR-0005)

---

## Related

- **ADR-0005**: Platform baseline (env fail-fast)
- **apps/api/src/env.ts**: The schema and generator
- **scripts/gen-env-example.ts**: The build-time script
- **Zod**: Official reference for schema reflection (note: internal APIs used)
