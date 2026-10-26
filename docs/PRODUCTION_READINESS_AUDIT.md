# Production Readiness Audit — 25 October 2026

Read-only audit of the live deployment, its database and the release candidate. Nothing was pushed,
deployed, migrated or billed. The read-only SQL preflight (`supabase/checks/preflight-001-016.sql`)
could not be executed from this machine (no `psql`, no database URL in `.env.local`); §3 records the
read-only evidence gathered instead and the one statement the owner must run.

## 1. Snapshot

| Item | Value |
| --- | --- |
| Branch | `feature/google-business-resource-collector` |
| Release candidate | `758b789` (21 commits ahead of `origin/main`) |
| Local `main` | `0873bd2` — an ancestor of `758b789`, so integration is a fast-forward |
| `origin/main` | `99b9a30` — the only pushed branch |
| Deployed code | predates the release candidate (see §2) |
| Working tree | clean; `.env.local` gitignored, mode 600, never staged |

`git merge-tree main 758b789` produces a clean tree and `git merge-base --is-ancestor main HEAD`
succeeds: integrating the branch is `git merge --ff-only`, with no conflicts and nothing on `main`
to preserve beyond `0873bd2`, which the branch already contains.

## 2. What production is actually running

`showcase`/app requests redirect (307) without a session, so the deployment was fingerprinted through
public, non-mutating endpoints:

| Probe | Result | Meaning |
| --- | --- | --- |
| `/api/status` | 200, keys `ai, automation, contacts, discovery, mode, quotas, research, serverTools, webSearch` | No `socialDiscovery`, no `autonomousDiscovery` — those fields arrived in `071ce4b` and `66a383f` |
| `/api/resources` | 404 | Resource Collector is not deployed |
| `/api/discover/social` | 404 | Social discovery is not deployed |
| `/api/studio/assets` | 404 | Asset Vault is not deployed |
| `/api/campaigns`, `/api/messaging/status` | 401 | Milestone 2 routes are deployed (auth-gated) |

The field set matches `origin/main` exactly, so production runs the Milestone 2 line (`99b9a30`),
not the release candidate. It also means the new capabilities cannot be smoke-tested before release:
they are not live yet.

Production status values worth recording:

- `mode: cloud`, `serverTools: true` (true whenever Supabase is configured).
- `ai.configured: true`, model `claude-sonnet-5-5`.
- `discovery`: `google_places` configured, `demo` configured.
- `webSearch.configured: false`, `research.search.configured: false` — **`BRAVE_SEARCH_API_KEY` is
  absent or blank in Production**, despite the report that the required API keys were added.
- `automation.backgroundWorker: true` — implies `CRON_SECRET` and a service-role key are present.
  `outboundSending: false`.
- Quotas are the code defaults: discovery 50/day, AI reports 20/day, website checks 300/day, web
  search 100/day.
- CSP `connect-src` names `nshuxeyrcxcnotldvhoh.supabase.co`, the same project as `.env.local`.

## 3. Production database verification (blocking finding)

Method: read-only PostgREST probes with the project's public anon key (`select=*,limit=0`), which
distinguishes "table/column exists" (42501 permission denied) from "does not exist" (404 `PGRST205`
/ 400 `42703`). No rows were read, written or deleted.

- **48 of 52 tables from 001–016 exist**, including `business_resource_entries` (016) with its
  columns, `studio_assets`, `studio_website_prototypes`, `provider_discovery_records`,
  `research_campaigns`, `usage_records.operation`, `usage_records.estimated_cost_usd`.
- **Four tables are absent, and they are exactly the tables of migrations 008 and 010**:

  | Missing object | Migration |
  | --- | --- |
  | `public.reply_classifications` | `008_response_conversion.sql` |
  | `public.proposal_change_requests` | `008_response_conversion.sql` |
  | `public.ghana_regions` | `010_region_records.sql` |
  | `public.ghana_districts` | `010_region_records.sql` |
  | `public.businesses.district_code` (column) | `010_region_records.sql` |

  This is not a stale PostgREST cache: 016's columns *are* visible, so the cache was rebuilt after
  016, and 010's plain `alter table … add column` is missing too. Migrations 008 and 010 were not
  applied (or were applied to another project).

- The check that would have caught this is already in the preflight at rows 8 and 10
  (`supabase/checks/preflight-001-016.sql`), which is why it must be run before release.

**Consequence today, not just after release.** The deployed Milestone 2 code already reads these
objects: `src/lib/server/campaigns/store.ts` selects `district_code` from `businesses`, and
`src/lib/data/supabase-store.ts` queries `reply_classifications` and `proposal_change_requests`.
On this database those calls return `42703` / `PGRST205`. Campaign scoping and reply/conversion are
therefore degraded in production right now — a pre-existing defect, detected here and not caused by
this branch.

**Consequence for the release.** `src/lib/server/discovery/service.ts` selects `district_code` on
the discovery path, so shipping `758b789` without 008 and 010 would break Discover, the Resource
Collector and the campaign filters. Both migrations are additive and idempotent
(`create table if not exists`, `add column if not exists`), so applying them is safe once authorised,
but it is a production schema change and was not performed.

## 4. Vercel environment (names only, no values read)

No Vercel CLI or token is installed here, so the Production/Preview variable lists could not be
enumerated. What the running deployment proves about configuration:

| Capability | Proven by | Status |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `mode: cloud` | configured |
| `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | `automation.backgroundWorker: true` | configured |
| `GOOGLE_PLACES_API_KEY` | `discovery[google_places].configured: true` | configured (billable) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `ai.configured: true` | configured |
| `BRAVE_SEARCH_API_KEY` | `webSearch.configured: false` | **missing** |
| `RESOURCE_GOOGLE_ENABLED` | not reported by this build | unknown — must be confirmed |
| `SOCIAL_DISCOVERY_ENABLED`, `DAILY_SOCIAL_DISCOVERY_QUOTA` | not reported by this build | unknown |
| `DISCOVERY_SYNTHETIC_PROVIDER` | not reported by this build | unknown; leave off |
| `SIMULATE_EXTERNAL_TOOLS`, `DEMO_SERVER_TOOLS` | `mode: cloud`, live providers configured | correctly off |

No private key is exposed to the browser: the only `NEXT_PUBLIC_` variables in `src/` are the
Supabase URL and public key, and `scripts/check-client-bundle.mjs` passes over the build output
(179 files, 5 key formats, service-role tokens, 3 configured secrets).

Because every new flag postdates the running deployment, **any flag change requires a new
deployment to take effect**; the current deployment cannot be reconfigured into these features.

## 5. Gates and cost exposure

- Live discovery is already enabled in production through `GOOGLE_PLACES_API_KEY`; every Discover
  search is billable today, at the app's 50/day discovery quota.
- Resource Collector calls reserve `max(0.05, cost)` per call (search 0.05, details 0.05, photo
  0.01) and are additionally capped at 30 sends per kind per day (120 photos). Four details clicks
  exhaust a 0.20 monthly budget while billing about 0.10.
- `enforceBudget` (`src/lib/server/budget.ts`) **returns without limiting when the workspace has no
  budgets row**: "Budgets are optional for manual use". The per-operation quotas are then the only
  stop. Organisation budgets must be set before `RESOURCE_GOOGLE_ENABLED=true`.
- Brave is not configured, so `research.search` and live social discovery are both off; the only
  social path is the labelled simulated one. No Brave spend is possible in Production today.
- Autonomous discovery runs only when `DISCOVERY_SYNTHETIC_PROVIDER=true` and is synthetic (free).
  There is no `vercel.json`, so no cron is declared in the repository; the background worker being
  "configured" only means its credentials exist.
- Application estimates are not provider caps: Google Cloud quotas/key restrictions and any Brave
  spending limits are account-side settings that this audit cannot read.

## 6. Verification run (all local, demo mode, no paid call)

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (unit + PGlite database) | 58 files, **923 tests passed** |
| `npm run build` (+ client bundle secret check) | pass, 23 static pages |
| Playwright desktop: resource-collector, social-discovery, discover, studio-assets, security | **17 passed** |
| Frozen-clock `sending-policy` test | fixed in `758b789`; 13/13 pass against `messaging_now()` |

The Playwright run rewrites `docs/evidence/resource-collector/desktop-*.jpg`; those regenerated
screenshots were reverted so the release commit contains only reviewed images.

## 7. Remaining risks

1. **R-1 (blocking).** Migrations 008 and 010 absent from production; the release and part of the
   current deployment depend on them.
2. **R-2.** Production runs code that predates the branch; no capability in this release has ever
   executed against the production schema.
3. **R-3.** Brave key missing, so "Google / Social / Both" cannot be previewed truthfully — Social
   will render as disabled.
4. **R-4.** Anon holds table-level grants on the 013–016 tables (`business_resource_entries`,
   `studio_creative_*`, `studio_website_prototypes`) because those migrations never `revoke` from
   `anon`, unlike 001–005. RLS is `to authenticated`, so nothing leaks today, but the defence is
   one policy mistake deep. Recommend a follow-up `revoke all on … from anon;` migration.
5. **R-5.** A Vercel Preview built from this branch would inherit Production Supabase values if the
   Preview scope holds the same variables — it is not isolated, and the Resource Collector writes
   rows. Preview verification must use a second project or demo mode.
6. **R-6.** Budgets are optional for manual paid calls, so the money cap exists only where an
   organisation budget is configured.

## 8. Release checklist (after R-1 is cleared and approved)

1. Run `supabase/checks/preflight-001-016.sql` read-only and confirm every row reports present.
2. With explicit approval, apply `008_response_conversion.sql` then `010_region_records.sql`
   (additive, idempotent; no `after-migrations.sql`, no destructive statement).
3. Re-run the preflight and the same PostgREST probe until 52/52 tables and `district_code` exist.
4. Set organisation budgets in `automation_settings.budgets` before enabling
   `RESOURCE_GOOGLE_ENABLED=true`.
5. Deploy a Preview from `758b789`, confirm which Supabase project and keys it resolves, and keep
   writes synthetic.
6. Promote to Production; smoke-test `/api/status`, `/login`, `/discover`, `/prospects`, `/studio`,
   a prospect's Resources tab — without triggering paid searches.
7. Tag the release commit and record the previous deployment id for rollback.

**Rollback.** Promote the previous Vercel deployment (instant, no rebuild). Do not reverse 008/010:
both are additive and leaving them in place keeps the deployed app working.

## 9. Recommendation

**No-go** until migrations 008 and 010 are confirmed present in production and organisation budgets
are set. Everything in the repository is green; the blocker is database drift, not code.
