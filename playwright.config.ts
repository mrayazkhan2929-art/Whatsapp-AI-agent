import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  outputDir: 'test-results/playwright',
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'node scripts/phase0-server.mjs frontend', url: 'http://127.0.0.1:3100/login', reuseExistingServer: false, timeout: 60000 },
    { command: 'node scripts/phase0-server.mjs backend', url: 'http://127.0.0.1:3101/healthz', reuseExistingServer: false, timeout: 60000 },
  ],
})
