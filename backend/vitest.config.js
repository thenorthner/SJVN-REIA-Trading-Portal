import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    // Each file gets its own process, so each gets its own database and its own
    // copy of the db singleton. Without this they would share one connection and
    // trip over each other's fixtures.
    pool: 'forks',
    fileParallelism: true,
    testTimeout: 20000,
  },
});
