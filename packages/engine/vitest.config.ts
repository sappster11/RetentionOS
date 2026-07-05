import { defineConfig } from 'vitest/config'

// The engine tests run against a REAL Postgres (working-agreement requirement). globalSetup
// boots an embedded Postgres on this fixed port and applies the shim + engine migrations;
// we set DATABASE_URL here (in `env`) so it reaches the test workers regardless of pool.
const TEST_PG_PORT = 54329

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    env: {
      DATABASE_URL: `postgresql://ros:ros@127.0.0.1:${TEST_PG_PORT}/retentionos`,
    },
    // Engine tests hit a real Postgres serially (shared connection pool + fixtures).
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
