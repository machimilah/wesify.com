import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // E2E_PROD=1 tests the production build (`npm run build` first); otherwise a dev server.
    command: process.env.E2E_PROD ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/me`,
    reuseExistingServer: true,
    // E2E runs against its own data directory, never the dev data in .data/.
    env: {
      WESIFY_DATA_DIR: process.env.WESIFY_DATA_DIR ?? ".data-e2e",
      WESIFY_BACKUPS: "0",
      TIKTOK_OEMBED: "0",
      // Test-only secrets so the production build boots locally. Never use these values anywhere real.
      APP_ENV: "development",
      ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "dev-admin",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-only-session-secret-0123456789abcdef",
      TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? "ZTJlLW9ubHktdG9rZW4ta2V5LTAxMjM0NTY3ODlhYmM=",
    },
    timeout: 120_000,
  },
});
