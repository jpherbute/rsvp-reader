// Tests de bout en bout (Chromium) : `npm test`. Le site est servi tel quel, sans build.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  globalSetup: require.resolve('./tests/fixtures.js'),
  timeout: 60000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    stderr: 'ignore',   // journal des requêtes de http.server
  },
});
