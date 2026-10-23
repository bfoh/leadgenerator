import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts'],
    // Blocks real network requests, so a missing fake can never reach a paid API.
    setupFiles: ['tests/setup/no-network.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Each database suite builds a PGlite database from every migration; in parallel that takes a while.
    hookTimeout: 60000,
  },
});
