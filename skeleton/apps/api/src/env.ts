/**
 * Environment configuration per ADR-0005.
 * Zod-validated, fail-fast on boot with full list of missing/invalid vars.
 * Generated .env.example never hand-maintained.
 */

import { z } from "zod";

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z
    .string()
    .default("file::memory:")
    .describe("PGlite file path, postgres://, or omit for in-memory"),

  // Tracing / Observability (OTel per ADR-0010)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().describe("OTLP collector endpoint; console default"),
  OTEL_TRACE_ENABLED: z.enum(["true", "false"]).default("false"),

  // Optional: Sentry or other error reporting (ADR-0005)
  SENTRY_DSN: z.string().optional(),
});

export type Environment = z.infer<typeof envSchema>;

let cachedEnv: Environment | null = null;

/**
 * Load and validate env, cache for reuse.
 * Fail-fast: throws with full validation error on first call if config is invalid.
 */
export function loadEnv(): Environment {
  if (cachedEnv) return cachedEnv;

  const raw = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_TRACE_ENABLED: process.env.OTEL_TRACE_ENABLED,
    SENTRY_DSN: process.env.SENTRY_DSN,
  };

  try {
    cachedEnv = envSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error("❌ Environment validation failed:");
      err.issues.forEach((issue) => {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      });
    }
    throw err;
  }

  return cachedEnv;
}

// Export singleton for main.ts
export const env = loadEnv();

/**
 * Generate .env.example from schema.
 * Used by scripts/generate-env-example.ts in CI.
 */
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
