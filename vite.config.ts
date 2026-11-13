import { realpathSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { fakeCloud } from './tools/fakeCloudPlugin.ts'
import { serviceWorker } from './tools/serviceWorkerPlugin.ts'

// Each developer (or agent) can run its own dev server: WHISPERUS_PORT=5180 npm run dev
const port = Number(process.env.WHISPERUS_PORT ?? 5173)

// The app is served from https://<user>.github.io/WhisperUs/ in production: the
// repository's name, spelled as GitHub spells it.
export default defineConfig(({ command, mode, isPreview }) => ({
  base: command === 'build' || isPreview ? (process.env.WHISPERUS_BASE ?? '/WhisperUs/') : '/',
  // The service worker is built for builds only; the dev server runs without one.
  plugins: [react(), tailwindcss(), serviceWorker(), ...(mode === 'production' ? [] : [fakeCloud()])],
  build: { target: 'es2022', sourcemap: true },
  // node_modules may be a symlink (git worktrees); allow its real location so fonts load.
  server: { port, strictPort: true, fs: { allow: ['.', realpathSync('node_modules')] } },
  preview: { port: port - 1000, strictPort: true },
  test: {
    environment: 'node',
    env: { VITE_BACKEND: 'fake' },
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
}))
