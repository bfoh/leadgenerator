import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';

// Live provider checks: `LIVE_INTEGRATION=1 npm run test:live`. Never part of `npm test` or CI. Keys
// come from .env.local, which wins over the shell (a stray shell variable must not pick the account
// that pays). The network guard is not loaded here; each check reserves its cost against
// LIVE_BUDGET_USD first (tests/live/budget.ts).

function envLocal() {
  if (!existsSync('.env.local')) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Replaces (not merges) the base test settings, so the normal suite and its network guard are left out.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/live/**/*.live.test.ts'],
    setupFiles: [],
    env: envLocal(),
    testTimeout: 120_000,
    // One check at a time, so the budget is reserved in order.
    fileParallelism: false,
    // The checks print provider evidence (counts, costs); passing tests must not hide it.
    silent: false,
  },
});
