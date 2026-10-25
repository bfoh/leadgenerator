# Active development handoff

Last updated: 25 October 2026. Branch: `feature/google-business-resource-collector`.

This note is the entry point for whoever picks this work up next. It records what is committed, what
is deliberately not built, and which external approvals are still missing.

## Where the branch stands

| Commit | What it contains |
| --- | --- |
| `497ba5e` — Google-first Business Resource Collector | Prospect resource page, transient Google listing viewer, independently verified website candidates, migration 016 (drafted, **not applied**), Asset Vault import, standalone Website Resource Kit ZIP, unit/PGlite/browser coverage |
| Branch tip — Google and social business discovery | Unified discovery UI (Google / social / both), transient social profile discovery through a public web index, `POST /api/discover/social`, off-by-default flags, unit and browser coverage |

Both are local commits. **Nothing has been pushed, deployed or applied to production Supabase.**

## What the discovery work does

- `src/lib/domain/social-discovery.ts` — builds one `site:`-scoped query per platform from the
  category phrase and the chosen place, parses profile URLs, scores each hit, collapses duplicate
  profiles and produces the labelled simulated world.
- `src/lib/server/providers/social-discovery.ts` — server adapter over the existing Brave web-search
  provider. Simulated when `SIMULATE_EXTERNAL_TOOLS=true` (demo and browser tests); otherwise live,
  metered per query and gated by `SOCIAL_DISCOVERY_ENABLED`.
- `src/app/api/discover/social/route.ts` — `POST /api/discover/social`. Validates input, enforces the
  quota and the Brave budget, records one usage row per answered query, and returns `no-store`
  results with `retained: false`.
- `src/components/discover/discover-view.tsx` — source selector (Google / Social / Both), platform
  toggles, a social results list with confidence, evidence, duplicate flags and an explicit
  "Review & add" path into the existing candidate form.

## Deliberate boundaries

- **No platform API is called.** Instagram, Facebook and TikTok do not license keyword lead search,
  and their page content may not be harvested. Discovery reads a public web index for profile links
  only. No profile page is fetched, parsed or mirrored.
- **Nothing is stored.** Titles, snippets, links and confidence live in component memory for the
  session. The route sets `Cache-Control: no-store`; there is no table, cache or local storage for
  social results.
- **A profile is not a CRM record.** Saving still goes through the existing candidate form, which
  requires an independent source of record. The dialog says plainly that a social profile is not
  independent evidence and that the search itself was not saved.
- **Confidence is advice, not a decision.** A candidate reaches "Likely official" only with a
  category match *and* town/region evidence. Country-level evidence alone ("Ghana") is never enough.
  A profile that plainly names another town is marked "Looks like another business" and cannot be
  reviewed at all.
- **Compliance is inherited.** The existing Google attribution, Place-ID-only retention, budget,
  quota and `no-store` rules are unchanged by this work.

## Running and verifying

```bash
npm run typecheck
npm run lint
npm test                       # unit + PGlite database suites
npx playwright test tests/e2e/social-discovery.spec.ts tests/e2e/discover.spec.ts
```

The browser suite runs with Supabase blanked and `SIMULATE_EXTERNAL_TOOLS=true`, so every social
result is the labelled fictional world: no network, no provider account and no cost.

Verified on 25 October 2026: `typecheck` and `lint` clean, 903 unit/database tests passing,
`tests/e2e/social-discovery.spec.ts` (3 tests), `tests/e2e/discover.spec.ts` (2 tests) and the
`/discover` phone-layout test passing.

## Still required before live social discovery

1. **A commercial decision.** `SOCIAL_DISCOVERY_ENABLED` stays `false` until the owner accepts a paid
   Brave search per platform per query. `DAILY_SOCIAL_DISCOVERY_QUOTA` (default 20) is the cap.
2. **A terms review.** Confirm the current Brave Search terms permit this use, and that no platform
   term is breached by storing a profile URL in a human-authored note. The code stores nothing; the
   reviewer decides what a person may type afterwards.
3. **A key.** `BRAVE_SEARCH_API_KEY` on the server, plus a Brave budget in Automation Center →
   Controls if spending is capped. Without both, the UI explains exactly what is missing and the
   route answers `503`.
4. **A live, budget-capped check** through `npm run test:live` only, with an explicit spend limit.

No paid call, production migration, push, deployment or prospect contact is authorised by this work.
