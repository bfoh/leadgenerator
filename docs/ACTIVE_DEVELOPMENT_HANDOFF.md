# Active development handoff

Last updated: 31 October 2026. Branch: `feature/google-business-resource-collector`.

This note is the entry point for whoever picks this work up next. It records what is committed, what
is deliberately not built, and which external approvals are still missing.

## Where the branch stands

| Commit | What it contains |
| --- | --- |
| `497ba5e` — Google-first Business Resource Collector | Prospect resource page, transient Google listing viewer, independently verified website candidates, migration 016 (drafted, **not applied**), Asset Vault import, standalone Website Resource Kit ZIP, unit/PGlite/browser coverage |
| Branch tip — Google and social business discovery | Unified discovery UI (Google / social / both), transient social profile discovery through a public web index, `POST /api/discover/social`, off-by-default flags, unit and browser coverage |

| `e2e13e7` — Approve several identified references in one reviewed batch | Review table with per-row Approve / Reject / Needs more evidence, Select all eligible and Deselect all; explicit confirmation listing the records that will change; per-record safe writes that re-read the record, re-check its Place ID and duplicates, re-judge the evidence and log the reviewer; idempotent re-approval; phone-width review |
| `6c01631` — Name several Google references in one reviewed batch | Read-only batch identification: 20 records, four checks per request, two in flight, halts on a blocked check |
| `1c57984` — Grade a resource kit before it is downloaded | `kitReadiness()` drives the card, the pre-export review, the ZIP manifest and `visual-references.json` |
| `aeb1c62` — Name a Place-ID-only reference from independent sources | Single-record identification: bounded searches, guarded homepage reads, `place-identity/1` evidence, acceptance, audit and provenance |

All four are local commits. **Nothing has been pushed, deployed or applied to production Supabase.**

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

## What the identity work does

- `src/lib/domain/place-identity.ts` — one reading from bounded searches and guarded homepage reads:
  the site that publishes the name, where on the page it was read, ownership evidence, confidence and
  the concerns a person should see. Google's listing is never a source of record.
- `src/lib/data/identity-services.ts` — `acceptPlaceIdentity` and `approveIdentityBatch`. Each write
  re-reads the record from the caller's own store, refuses a record whose Place ID changed, re-parses
  and re-judges the evidence, and (for a reviewed batch) refuses a rename that would duplicate another
  prospect. Re-approving the same reading returns `unchanged` without a second write or audit entry.
- `src/lib/domain/identity-approval.ts` — the review table: eligibility, verification state, conflicts,
  duplicate notices and the Approve / Reject / Needs more evidence selection.
- `src/components/prospects/bulk-identify-business.tsx` — plan, run, review, confirm, per-record
  results. The dialog keeps the selection it opened with, so renaming a record cannot close it.

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
npx playwright test tests/e2e/identity-batch.spec.ts tests/e2e/responsive.spec.ts
npx playwright test tests/e2e/social-discovery.spec.ts tests/e2e/discover.spec.ts
```

The browser suite runs with Supabase blanked and `SIMULATE_EXTERNAL_TOOLS=true`, so every social
result is the labelled fictional world: no network, no provider account and no cost.

Verified on 31 October 2026: `typecheck` and `lint` clean, **1103 unit/database tests in 69 files**,
**134 browser tests passing**, the production build and client secret scan clean (183 files, no
matches). `tests/e2e/adwoa-experience.spec.ts` flaked twice under full-suite load (a scroll-mask
timing comparison and one axe contrast run) and passes 7/7 when run alone; it is unrelated to this
work and remains under the creative approval gate.

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
