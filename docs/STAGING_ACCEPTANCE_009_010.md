# Staging acceptance — migrations 009 and 010

Date: 24 October 2026. Status: **automated acceptance passed on an isolated staging database.**
Production was not touched, no remote Supabase project was contacted, and no paid provider or
messaging credential was present.

## 1. Environment

| Item | Value |
| --- | --- |
| Database | PGlite 0.5.8 (PostgreSQL compiled to WASM), file-backed in a temporary directory |
| Schema | The real `supabase/migrations/001`–`010` files, in order |
| Supabase stubs | `auth.users`, `auth.uid()`, `auth.jwt()`, `anon`, `authenticated`, `service_role` and Supabase default grants (`tests/db/harness.ts`) |
| Network | None. The test runner's no-network setup blocks every host except this machine |
| Credentials | No Supabase URL/key, no `GOOGLE_PLACES_API_KEY`, no `ANTHROPIC_API_KEY`, no messaging keys |
| Evidence | `tests/db/staging-acceptance.test.ts` — one ordered test, 240 s budget, passed in 6.9 s |

Why PGlite rather than a hosted staging project: no Supabase CLI is installed in this environment,
no staging project reference exists in the repository, and the brief forbids touching production or
incurring external cost without explicit authorization. The test still runs the real migration and
rollback SQL, the real check scripts, RLS as each role, and real triggers.

## 2. Steps and results

| # | Step | Result |
| --- | --- | --- |
| 1 | Build a baseline database through 008 with one existing prospect | Passed: owner, workspace and `Kumasi Pharmacy` created |
| 2 | Back up the staging database | Passed: directory copied; `PG_VERSION` present; reopening the backup shows no `research_campaigns` table |
| 3 | Run `supabase/checks/preflight.sql` | Passed: 002 `yes`; 009 `no`; 010 `no`; `businesses = 1` |
| 4 | Apply 009 | Passed |
| 5 | Apply 010 | Passed |
| 6 | Run `supabase/checks/after-migrations.sql` | **23 of 23 rows `ok`** (including no Google Places campaign, 261 districts, 16 regions, history not editable/deletable) |
| 7 | Create an active campaign (Ashanti, Pharmacy, manual) | Passed |
| 8 | Attach two prospects: one with a town, one district-only (`GH0202`, `city = NULL`) | Passed; the district trigger filled the region |
| 9 | Queue background research through `enqueue_campaign_job` | Passed: 2 jobs with campaign and target ids; targets moved to `researching` |
| 10 | Close the database (“close the browser”), reopen, finish the jobs as the worker | Passed: 2 jobs `succeeded`; 2 targets `researched`; run log `succeeded`, 2 completed |
| 11 | Confirm progress and history | Passed: two `added`, two `researching`, two `researched` events; campaign last run `succeeded` |
| 12 | Confirm no paid or outbound side effects | Passed: `usage_records = 0`, `outreach_messages = 0`, `agent_runs = 0`, campaign spend `$0` |
| 13 | Roll back a disposable copy | Passed: 010 then 009; campaign tables and district reference gone; `businesses.city` `NOT NULL` again; the original backup untouched |

The disposable copy contained a district-only prospect, so 010's refusal path was exercised first in
the dedicated rollback suite (`db/campaigns`), which asserts the refusal message names the count. In
the acceptance copy that prospect was given a town deliberately, matching the runbook's instruction,
before the rollback ran.

## 3. What this proves

- 009 and 010 apply cleanly to a database that already has prospects and automation jobs.
- The post-migration safety checks used for production pass against these migrations.
- A campaign can be created, populated with a town-level and a district-only prospect, and have
  research queued without any provider call.
- Closing the client does not affect progress: jobs and memberships live in the database, and a
  reopened process sees the completed work and the run log.
- No paid API call, outbound message or agent run occurred; campaign spend is zero.
- Rollback restores the previous schema and refuses to lose town-less records silently.

## 4. What still needs a real Supabase staging project

| Item | Why PGlite cannot prove it | Owner action |
| --- | --- | --- |
| Real role/extension behaviour | `auth`, `pg_cron`, `pg_net` and Supabase's default privileges are stubbed | Create/link a staging project, run preflight → 009 → 010 → after-migrations |
| Browser UI against cloud mode | Playwright runs in demo mode; campaigns require Supabase | Sign in to staging, create a campaign, edit it, press **Run now**, watch the run log |
| Scheduled worker end to end | The cron route needs `CRON_SECRET`, a service-role key and a real queue | Enable the worker on staging for one tick; confirm the queued job is claimed and finished |
| Backup/restore tooling | PGlite directory copy is not a Supabase/PITR backup | Take a dashboard backup and record the restore point (docs/BACKUPS.md) |
| Load and lock timing | PGlite data is tiny | Time the `businesses` constraint validation and index creation on a production-sized copy |

Until those five rows are signed off, 009/010 remain **unapplied to production**.
