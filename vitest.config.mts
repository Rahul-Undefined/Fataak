import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@engine': resolve(import.meta.dirname, 'src/engine') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
