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

## 10. Applying 008 and 010 — validated plan (26 October 2026)

The owner's read-only SQL Editor pass returned FALSE for all five objects, so the gap is real and
clean: no half-applied state. Both files were then validated against a PGlite database built in
production's exact shape — 001–007 and 009–016 applied, 008 and 010 skipped —
(`tests/db/late-migrations.test.ts`, 8 checks). Nothing was applied, pushed or deployed.

### 10.1 What each file adds, and what it needs

| File | Adds | Needs, already present |
| --- | --- | --- |
| `008_response_conversion.sql` | `reply_classifications` (append-only readings), `proposal_change_requests`, `guard_reply_classification`, `guard_proposal_change_request`, `guard_proposal_acceptance` + trigger on `proposals`, 2 indexes, RLS + 5 policies, its own revokes/grants | 002 (`organizations`, `businesses` `unique (id, organization_id)`, `is_org_member`, `has_org_role`, `touch_updated_at`, `audit_row_change`), 006 (`inbound_messages.opt_out`, `proposals.approved_at` and `unique (id, organization_id)`) |
| `010_region_records.sql` | `ghana_regions` (16), `ghana_districts` (261), `businesses.district_code` + FK, `sync_business_district` + trigger, 3 indexes, RLS + 2 policies, the reworked `city`/`location_known` checks | 002 (`businesses.region`, `businesses.city`) |

Neither file reads anything created by 009 or 011–016, so landing them after those files is safe.
No later migration redefines `guard_proposal_acceptance`, `sync_business_district`, the district FK,
the two `businesses` checks, or the seven index names, so there is nothing to overwrite.

### 10.2 Existing-data impact: none

* **008** only creates tables and one `before update` trigger on `proposals`. It writes no rows. The
  trigger reasons about `status`/`approved_at` on future updates only. `proposal_change_requests`
  has two composite foreign keys, both to parents that already carry `unique (id, organization_id)`.
* **010** adds one nullable column (every existing row gets `district_code = null`), then replaces
  `businesses_city_check` with the same rule plus `or city is null` — 002 defined
  `city text not null check (char_length(btrim(city)) between 1 and 80)`, so every existing row
  already satisfies the new form — and adds `businesses_location_known`
  (`region is not null or city is not null`), which every row satisfies because `city` was `NOT
  NULL` until this file. The district trigger fires only on insert or on updates that touch
  `district_code`/`region`. Row counts and values are unchanged.
* Pre-flight rows 3 and 4 below are the only way either constraint could fail; the replica proves
  the upgrade leaves `businesses`, `proposals`, `inbound_messages` and `proposal_versions` byte-for-byte
  identical (all columns compared as `jsonb`, `district_code` excepted).

### 10.3 Permissions, RLS and triggers the files install

| Object | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `reply_classifications` | none | select, insert (no update/delete: append-only) | select, insert (no update/delete) |
| `proposal_change_requests` | none | select, insert, update (no delete) | select only |
| `ghana_regions`, `ghana_districts` | none | select only | select only is granted; the project's default privileges already allow the service role more, and 010 does not revoke them |

RLS is enabled on all four tables (5 policies on the two conversation tables, 1 read-only policy on
each reference table). The current app matches this exactly: `updateProposal` sends title, content and
totals only (`src/lib/data/services.ts:308`), change requests and corrections are written from a
signed-in session, and no code reads `ghana_regions`/`ghana_districts` (the app uses
`src/lib/domain/districts.ts`; the tables exist for referential integrity). The service role's
leftover write grants on the two reference tables are the same shape as R-4 and want the same
follow-up revoke migration; nothing in the app uses them.

### 10.4 Idempotency

Both files are re-runnable: `create table if not exists`, `add column if not exists`, guarded
`add constraint`, `create index if not exists`, `drop trigger/policy if exists` before `create`,
`create or replace function`, and `insert … on conflict (code) do update` for the 277 reference rows.
Re-running both against the upgraded replica left 16 regions, 261 districts, 7 policies, every
classification, change request and proposal untouched.

### 10.5 Local validation evidence

`npx vitest run tests/db/late-migrations.test.ts` — 8/8 on a 001–016-minus-008/010 database:

1. the replica stands where production stands (four tables and `district_code` absent, 009/011/012/
   013/016 objects present);
2. `008` then `010` apply without changing a single existing record;
3. 16 regions, 261 districts, Guan, `businesses_district_fk`, 7 indexes, 4 triggers, `city` nullable;
4. an opt-out reply cannot be classified as anything else, readings cannot be edited or deleted;
5. acceptance is refused while a change request is open, and again while an approved change is not
   in a re-approved proposal, then succeeds once it is;
6. a district-only business gets its region filled, a contradicting region, an unknown code and a
   record with no location are all refused, and the pre-upgrade record is untouched;
7. grants and RLS are exactly the table in 10.3 (also the contracts `after-migrations.sql` rows
   10, 15 and 16 assert);
8. re-running both files duplicates and loses nothing.

Full suite after the addition: 931/931 tests in 59 files; `tsc --noEmit` and `next lint` clean.
The pre-flight and verification blocks in 10.7–10.8 were run against the same replica and returned
exactly the five-FALSE row, the empty object list, `0 / 0 / 0`, the `16 / 261 / 1 / 261` reference
counts, `4 / 7 / 7 / 4 / 1` for guards, indexes, policies, RLS and the key, the twelve-row privilege
matrix in 10.3, and unchanged record counts.

### 10.6 Apply order

1. `supabase/migrations/008_response_conversion.sql` (production SQL Editor, entire file)
2. verification block A–B below
3. `supabase/migrations/010_region_records.sql` (entire file)
4. verification block A–E below

008 first because it is the lower number and carries the `proposals` trigger; the two files touch
disjoint objects, so the order is otherwise free. Use the files at commit `3629795`, not an edited
copy.

### 10.7 Pre-flight (read-only, optional — the owner's FALSE pass already covered the first block)

```sql
-- 1. The gap itself: five FALSE.
select to_regclass('public.reply_classifications')    is not null as has_reply_classifications,
       to_regclass('public.proposal_change_requests') is not null as has_proposal_change_requests,
       to_regclass('public.ghana_regions')            is not null as has_ghana_regions,
       to_regclass('public.ghana_districts')          is not null as has_ghana_districts,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'businesses'
                  and column_name = 'district_code')  as has_district_code;

-- 2. No half-written object or taken name: expect 0 rows. (`businesses_city_check` is deliberately
--    absent from this list; 002 created it and 010 replaces it in place.)
select 'table' as kind, c.relname as name
  from pg_class c where c.relnamespace = 'public'::regnamespace
   and c.relname in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')
union all
select 'index', i.indexname from pg_indexes i where i.schemaname = 'public'
   and i.indexname in ('businesses_org_district_idx', 'businesses_org_region_idx', 'ghana_districts_region_idx',
                       'reply_classifications_message_idx', 'reply_classifications_org_idx',
                       'proposal_change_requests_proposal_idx', 'proposal_change_requests_org_idx')
union all
select 'function', p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('guard_reply_classification', 'guard_proposal_change_request',
                     'guard_proposal_acceptance', 'sync_business_district')
union all
select 'constraint', k.conname from pg_constraint k where k.conrelid = 'public.businesses'::regclass
   and k.conname in ('businesses_district_fk', 'businesses_location_known')
union all
select 'trigger', t.tgname from pg_trigger t where t.tgrelid = 'public.businesses'::regclass
   and not t.tgisinternal and t.tgname = 'businesses_district_sync';

-- 3. Rows that could stop 010's checks validating: expect 0, 0, 0.
select count(*) filter (where city is null) as city_null,
       count(*) filter (where city is not null
                          and char_length(btrim(city)) not between 1 and 80) as city_out_of_bounds,
       count(*) filter (where region is null and city is null) as no_location
  from public.businesses;

-- 4. Proposals the acceptance guard will reason about (informational, blocks nothing).
select status, count(*) as proposals, count(*) filter (where approved_at is null) as without_approved_at
  from public.proposals where status in ('approved', 'sent') group by status;
```

If block 2 returns any row, stop: something was written outside the migrations and 010's guarded
`add constraint` would be skipped silently (it checks the constraint name only). Block 4 is worth
keeping with the change record: a proposal approved before 008 has no approval time unless the app
set one, and the guard compares a change decision against it.

### 10.8 Post-migration verification (read-only)

```sql
-- A. All five objects present: five 1s.
select (to_regclass('public.reply_classifications')    is not null)::int as reply_classifications,
       (to_regclass('public.proposal_change_requests') is not null)::int as proposal_change_requests,
       (to_regclass('public.ghana_regions')            is not null)::int as ghana_regions,
       (to_regclass('public.ghana_districts')          is not null)::int as ghana_districts,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'businesses'
           and column_name = 'district_code')::int     as district_code;

-- B. Reference data: 16 regions, 261 districts, Guan present, every district linked to a region.
select (select count(*) from public.ghana_regions) as regions,
       (select count(*) from public.ghana_districts) as districts,
       (select count(*) from public.ghana_districts where code = 'GH10-GUAN') as guan,
       (select count(*) from public.ghana_districts d
          join public.ghana_regions r on r.name = d.region) as districts_with_region;

-- C. Guards, indexes, policies, RLS, the district key: 4, 7, 7, 4, 1.
select c.what, c.value from (
  select 1 as ord, 'triggers' as what, string_agg(tgname, ', ' order by tgname) as value
    from pg_trigger where not tgisinternal
     and tgname in ('reply_classifications_guard', 'proposal_change_requests_guard',
                    'proposals_acceptance_guard', 'businesses_district_sync')
  union all select 2, 'indexes', string_agg(indexname, ', ' order by indexname) from pg_indexes
    where schemaname = 'public' and indexname in
      ('businesses_org_district_idx', 'businesses_org_region_idx', 'ghana_districts_region_idx',
       'reply_classifications_message_idx', 'reply_classifications_org_idx',
       'proposal_change_requests_proposal_idx', 'proposal_change_requests_org_idx')
  union all select 3, 'policies', count(*)::text from pg_policies where schemaname = 'public'
    and tablename in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')
  union all select 4, 'rls enabled', count(*)::text from pg_class
    where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')
  union all select 5, 'district fk', count(*)::text from pg_constraint
    where conrelid = 'public.businesses'::regclass and conname = 'businesses_district_fk'
) c order by c.ord;

-- D. Privileges per role. Expect anon no/no/no/no everywhere; authenticated select on the reference
--    tables only, select+insert on reply_classifications, select+insert+update on
--    proposal_change_requests, never delete; the service role select+insert on
--    reply_classifications and select only on proposal_change_requests.
select r.role, t.tbl,
       has_table_privilege(r.role, 'public.' || t.tbl, 'select') as sel,
       has_table_privilege(r.role, 'public.' || t.tbl, 'insert') as ins,
       has_table_privilege(r.role, 'public.' || t.tbl, 'update') as upd,
       has_table_privilege(r.role, 'public.' || t.tbl, 'delete') as del
  from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
  cross join unnest(array['reply_classifications', 'proposal_change_requests',
                          'ghana_regions', 'ghana_districts']) as t(tbl)
 order by r.role, t.tbl;

-- E. Nothing the upgrade touched: counts as in pre-flight block 3, and no business gained a district.
select (select count(*) from public.businesses) as businesses,
       (select count(*) from public.businesses where district_code is not null) as with_district,
       (select count(*) from public.proposals) as proposals,
       (select count(*) from public.reply_classifications) as readings,
       (select count(*) from public.proposal_change_requests) as change_requests;
```

Then, outside SQL: an anon-key `GET /rest/v1/ghana_districts?select=code&limit=1` should answer 401
(permission denied) rather than 404, which proves the table exists and is closed to signed-out
callers. Re-run `supabase/checks/preflight-001-016.sql`: sections 1 and 7 should read `present` for
every row, `gaps in the installed chain` → `none`, `next file to apply` → `none - chain complete`.
`supabase/checks/after-migrations.sql` row 10 (`safety triggers installed`) should now read 4/4;
rows 2, 3, 4, 5, 8 and 9 describe a fresh upgrade and still differ on a live project by design.

### 10.9 What changes for the code that is already deployed

* **008 turns the reply-conversion screens on by itself.** `supabase-store.ts` probes
  `reply_classifications` once (`conversionSchemaAvailable`) and hides those screens while the table
  is missing; once it exists they appear. No deploy is needed for that switch.
* **The acceptance guard starts applying to the deployed app's proposal updates.** Safe: `updateProposal`
  never sends `approved_at` (`src/lib/data/services.ts:308`), and status changes send only `status`, so
  the database stamps the approval time as 008 intends. Anything that writes `approved_at` by hand
  afterwards — a SQL Editor edit, an import — is refused unless the status is moving to `approved`.
* **010 fixes campaign candidate listing.** `src/lib/server/campaigns/store.ts` already selects
  `businesses.district_code` (lines 479, 490) and raises `42703` while the column is missing, which is
  a hard failure rather than a hidden feature; the collector's district scoping needs it too.
* **Nothing else moves.** No app code reads the two reference tables, and nothing server-side writes
  `reply_classifications` or `proposal_change_requests` with the service-role key.

### 10.10 Mechanics, rollback and the CLI ledger

* The SQL Editor sends the script as one statement batch, so each file applies completely or not at
  all — neither contains `begin`/`commit`, `create index concurrently` or `vacuum`. One file per run,
  in the order above.
* Expect `Success. No rows returned` for each file. On any error nothing was written: send the message
  before retrying.
* Rollback files exist (`supabase/rollback/008_response_conversion_down.sql`,
  `010_region_records_down.sql`) and are tested, but the release rollback stays "promote the previous
  Vercel deployment and keep the schema": both files are additive, and 010's own down file refuses
  while any business has a district and no town.
* SQL Editor edits are not recorded in `supabase_migrations.schema_migrations`, which is how 001–016
  were applied already. Do not run `supabase db push` afterwards without recording what ran
  (`supabase migration repair --status applied 008 010`, run by the owner with the CLI). The
  pre-flight row `Supabase CLI history table` says whether that table exists at all.

### 10.11 Open questions for the owner

1. Why did 008 and 010 not run while 009 and 011–016 did? Selective SQL Editor application is the
   likely explanation; the FALSE checks rule out a dropped or partial state, not the cause.
2. Do the organisation budgets exist in `automation_settings.budgets`? R-2 still blocks
   `RESOURCE_GOOGLE_ENABLED=true` after the migrations land.
3. Is `BRAVE_SEARCH_API_KEY` set on the production project? `/api/status` still reports
   `webSearch.configured: false`.




