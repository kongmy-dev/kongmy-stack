/**
 * Playwright config for acceptance smoke tests.
 *
 * Boots two dev servers:
 * - API on PORT (default 3100) with PGlite in-memory adapter
 * - Web Vite dev server on a free port, /api proxy pointed at API_PORT
 */

import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API_PORT = process.env.API_PORT || "3100";
const WEB_PORT = process.env.WEB_PORT || "5174";
// webServer commands run relative to this config's dir (acceptance/); anchor them at skeleton root
const skeletonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },

  webServer: [
    {
      command: `bun run --cwd apps/api dev`,
      cwd: skeletonRoot,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: API_PORT,
      },
    },
    {
      command: `bun run --cwd apps/web dev -- --port ${WEB_PORT} --strictPort`,
      cwd: skeletonRoot,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_PORT: API_PORT,
      },
    },
  ],

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
