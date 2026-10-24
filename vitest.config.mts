import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@engine': resolve(import.meta.dirname, 'src/engine') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // the metamorphic and generated suites run thousands of evaluations per test; CI runners are several times slower than a laptop
    testTimeout: 120000,
  },
});
