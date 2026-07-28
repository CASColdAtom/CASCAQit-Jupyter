import { defineConfig } from '@playwright/test';

const serverUrl = 'http://127.0.0.1:8899';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/playwright',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'lab-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'lab-narrow', use: { viewport: { width: 640, height: 900 } } },
    { name: 'notebook-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'notebook-narrow', use: { viewport: { width: 640, height: 900 } } }
  ],
  webServer: {
    command: 'sh tests/e2e/start-server.sh',
    url: serverUrl,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
