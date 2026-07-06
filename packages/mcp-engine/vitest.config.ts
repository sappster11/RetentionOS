import { defineConfig } from 'vitest/config'

// Same pattern as packages/engine: tests run against a REAL embedded Postgres booted in
// globalSetup. Different fixed port (54331 vs the engine suite's 54329) so the two suites
// can never collide on a shared machine.
const TEST_PG_PORT = 54331

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    env: {
      DATABASE_URL: `postgresql://ros:ros@127.0.0.1:${TEST_PG_PORT}/retentionos`,
    },
    // Real Postgres + a spawned stdio server → keep files serial.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
