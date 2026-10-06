import { defineConfig, devices } from '@playwright/test'

/**
 * Runs against an already running studio (Compose). Base URL must equal SV_STUDIO_URL of the stack,
 * otherwise Better Auth rejects sign-up/sign-in as "Invalid origin".
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // No retries: a flaky test must be fixed at its root cause, never masked (M15-T08).
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.SV_STUDIO_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
