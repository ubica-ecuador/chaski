import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import baseConfig from './.config/playwright.config';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<PluginOptions>(baseConfig, {
  // Add your own configuration here.
  // See https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations#extend-the-playwright-config for further info.
  use: { baseURL: process.env.GRAFANA_URL ?? 'http://localhost:3005' },
  // Projects merge by name with the base config's.
  projects: [
    { name: 'chromium', testIgnore: /cdn\.spec\.ts/ },
    // grafana-cdn in docker-compose.yaml, which serves the plugin the way
    // Grafana Cloud does. It logs in by itself: its session is not :3005's.
    {
      name: 'cdn',
      testMatch: /cdn\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.GRAFANA_CDN_URL ?? 'http://localhost:3007' },
    },
  ],
});
