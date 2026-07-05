import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Engine tests hit a real Postgres serially (shared connection pool + fixtures).
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
