import { defineConfig } from 'vitest/config';

// Layer-3 integration tests: they spawn a real Homebridge process and pair with
// it over HAP, so they are slower and run sequentially, separate from the fast
// unit suite. Run with `npm run test:integration` (or `make test-integration`).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
