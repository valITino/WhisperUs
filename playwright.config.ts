import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run two Android-sized browsers against the dev server and its
// pretend cloud. They never touch the real Supabase project.
const port = Number(process.env.WHISPERUS_PORT ?? 5173)
const url = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: url,
    ...devices['Pixel 7'],
    // A pretend microphone that hums, and no question about using it: the booth records.
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
