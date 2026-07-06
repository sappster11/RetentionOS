import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Pure-unit suite: converter, agent loop (mocked Anthropic client), and the route's
// keyless / validation paths. No database and no network — anything needing Postgres
// lives in the engine / mcp-engine suites.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
