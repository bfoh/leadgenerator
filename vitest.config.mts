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
    // Each database suite builds a PGlite database from every migration; with eleven migrations
    // (including 011's audit triggers) that is slower under parallel load than the original suite.
    testTimeout: 90000,
    hookTimeout: 120000,
  },
});
