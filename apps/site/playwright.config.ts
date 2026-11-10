import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    ...devices["Desktop Chrome"],
    // Tall enough for the whole 30-account board without scrolling.
    viewport: { width: 1280, height: 1100 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
  },
  webServer: {
    // A profiling build, so the perf tests can read React commit times.
    command: "pnpm exec vite build && pnpm exec vite preview --outDir dist-profile",
    env: { ENTRYPAD_PROFILE: "1" },
    url: "http://localhost:4173/spike/",
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
