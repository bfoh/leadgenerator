import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3107);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    // Demo mode: Supabase variables are blanked so the suite never touches a real project.
    command: `npm run build && npx next start -p ${port}`,
    url: `http://localhost:${port}/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      DEMO_SERVER_TOOLS: 'true',
      // Web search, DNS and website checks use the labelled simulated world: no network, no cost.
      SIMULATE_EXTERNAL_TOOLS: 'true',
      GOOGLE_PLACES_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      BRAVE_SEARCH_API_KEY: '',
      // Messaging is simulated in demo mode; provider credentials are blanked so nothing can be sent.
      RESEND_API_KEY: '',
      WHATSAPP_ACCESS_TOKEN: '',
      MESSAGING_TEST_RECIPIENTS: '',
    },
  },
});
