import 'server-only';

import { isSupabaseConfigured } from '@/lib/supabase/config';

// Server-only configuration. Read at call time so tests and deployments can change it.

function num(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const serverEnv = {
  placesKey: () => process.env.GOOGLE_PLACES_API_KEY || '',
  braveKey: () => process.env.BRAVE_SEARCH_API_KEY || '',
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  /** Shared secret the scheduler sends as `Authorization: Bearer …` to /api/cron/automation. */
  cronSecret: () => process.env.CRON_SECRET || '',
  /** Server tools without sign-in: only in `next dev` or when explicitly enabled. */
  demoServerTools: () => process.env.DEMO_SERVER_TOOLS === 'true' || process.env.NODE_ENV === 'development',
  /**
   * Test-only: web search, domain probes, website inspection, contact pages and MX lookups return a
   * labelled simulated world instead of touching the network. Ignored whenever Supabase is
   * configured, so it can never feed a real workspace.
   */
  simulateExternalTools: () => process.env.SIMULATE_EXTERNAL_TOOLS === 'true' && !isSupabaseConfigured(),
  /**
   * The only autonomous discovery connector in this version. It generates synthetic records and
   * never calls a real provider. Off unless explicitly enabled; enabling it is a development or
   * acceptance decision, never a production data-acquisition switch.
   */
  discovery: {
    synthetic: () => process.env.DISCOVERY_SYNTHETIC_PROVIDER === 'true',
  },
  quota: {
    discovery: () => num('DAILY_DISCOVERY_QUOTA', 50),
    aiReports: () => num('DAILY_AI_REPORT_QUOTA', 20),
    aiNotes: () => num('DAILY_AI_NOTE_QUOTA', 40),
    aiClassifications: () => num('DAILY_AI_CLASSIFY_QUOTA', 100),
    websiteChecks: () => num('DAILY_WEBSITE_CHECK_QUOTA', 300),
    webSearch: () => num('DAILY_WEB_SEARCH_QUOTA', 100),
    mxLookups: () => num('DAILY_MX_LOOKUP_QUOTA', 300),
  },
  cost: {
    placesSearch: () => num('PLACES_COST_PER_SEARCH_USD', 0.035),
    placesDetails: () => num('PLACES_COST_PER_DETAILS_USD', 0.02),
    placesPhoto: () => num('PLACES_COST_PER_PHOTO_USD', 0.01),
    braveSearch: () => num('BRAVE_COST_PER_SEARCH_USD', 0.005),
  },
};
