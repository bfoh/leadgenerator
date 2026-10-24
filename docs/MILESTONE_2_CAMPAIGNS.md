# Milestone 2 — Research campaigns

Status: built and tested on the development branch; **migrations 009 and 010 are not applied to
production**. Baseline preserved in commit `06d4941` (“Harden worker reliability…”). This milestone
adds no paid provider calls, no production data changes and no outbound messaging.

## 1. What a campaign is

A research campaign is a saved **scope, schedule, quota and budget** for the research agents that
already exist. It selects prospects the workspace **already tracks**, adds them to a campaign, and
queues the normal chain:

`business_identity → website_verification → contact_research → contact_validation → digital_audit →
opportunity_scoring → opportunity_report`

A campaign does **not** search for new businesses, does not call Google Places, and does not contact
anyone. Live Places discovery stays manual and user-initiated. Approved-batch discovery is out of
scope and remains disabled.

Each prospect can belong to several campaigns. Membership is a row in `campaign_targets`, not a
column on the prospect, and every change is appended to `campaign_target_events`.

## 2. Provider architecture

`src/lib/domain/discovery-providers.ts` is the single declaration of every discovery source: what it
is, whether an integration exists, which uses it permits, what attribution and retention apply, what
it can return and what it costs. The Campaigns tab renders the same declarations, so what a person
sees is what the code enforces.

A campaign may use a provider only when **all** of these hold:

1. `unattended_discovery` is a permitted use;
2. `crm_processing` is a permitted use;
3. `requiresUserInitiation` is false;
4. `status` is `live`.

| Provider | Integration | Permitted uses | Campaign? |
| --- | --- | --- | --- |
| Prospects already tracked (`tracked_records`) | Live | unattended discovery, CRM processing, outreach | **Yes** |
| Google Places | Live, user-initiated | interactive discovery only | **Never** |
| Licensed business directory | Not integrated | none claimed | No |
| Commercial B2B provider | Not integrated | none claimed | No |
| Business-submitted records | Not integrated | none claimed | No |
| Permitted public dataset | Not integrated | none claimed | No |
| National registry / country integration | Not integrated | none claimed | No |

Two enforcement layers protect the Google Places rule:

- the application (`campaignProviderBlocker`) refuses to create or save a campaign with it;
- the database (`research_campaigns_unattended_provider`) refuses the row even if the application is
  bypassed.

Placeholder providers declare every capability as `false` and no permitted use. A licence review and
a connector are required before that changes (see §10).

## 3. Data model

### Migration 009 — `research_campaigns`

- **`research_campaigns`** — name, purpose, status (`draft`, `active`, `paused`, `completed`,
  `cancelled`), provider key, scope (`regions`, `district_codes`, `towns`, `categories`), batch size,
  daily target limit, optional monthly budget, schedule (frequency, hour, weekday/day, Africa/Accra),
  `next_run_at`, last run status/note, pause reason. Status moves only along documented paths
  (trigger); Google Places is rejected (check); a manual schedule cannot carry a next run.
- **`campaign_targets`** — the many-to-many membership: campaign, prospect, per-campaign state
  (`queued`, `researching`, `researched`, `qualified`, `skipped`, `failed`), match reason, source, the
  first job id, notes and timestamps. `unique (campaign_id, business_id)` prevents duplicates in one
  campaign; the same prospect may be in many campaigns. A trigger enforces the state machine and
  stamps `started_at`/`completed_at`.
- **`campaign_target_events`** — append-only history written by trigger (`added` and every state
  change). Members may read it; nobody may edit or delete it.
- **`campaign_runs`** — one row per background tick: status, targets enqueued/completed, open jobs,
  recorded spend and a note.
- **`automation_jobs.campaign_id` / `campaign_target_id`** — every step of a campaign chain, including
  follow-ups, is attributable. The engine copies both keys from a parent job to each follow-up.
- **`enqueue_campaign_job(...)`** — the campaign-aware enqueue (the 003 function is untouched, so
  re-running 003 or rolling it back cannot create an overload).
- **`campaign_spend(campaign_id)`** — actual agent-run cost plus the estimates of open jobs. Runs with
  the caller's rights, so RLS scopes it.

### Migration 010 — `region_records`

- **`ghana_regions`** — 16 rows, keyed by the ADM1 P-code prefix (`GH01`–`GH16`).
- **`ghana_districts`** — all 261 MMDAs, keyed by COD-AB P-code (Guan has `GH10-GUAN`), with region
  and the source's longer name. Seeded from the same verified source as
  `src/lib/domain/districts.ts`; a database test compares the two exactly.
- **`businesses.city`** is now optional. A record may be known only to district or region level.
- **`businesses.district_code`** references the district list. A trigger fills the region from the
  district, and refuses a district that contradicts a stated region.
- **`businesses_location_known`** requires at least a region or a town. Existing records all have a
  town, so nothing changes for them.
- **The prospect form** now records a district and makes the town optional when a district or region
  is chosen, so district-targeted campaigns can match records entered by people (not only imported
  ones). Region-only and district-only records are stored with `city = NULL`.

## 4. Orchestration

`src/lib/server/campaigns/orchestrator.ts` runs one tick per campaign:

1. **Claim** — a scheduled tick moves `next_run_at` with an optimistic update; only one worker wins.
2. **Reconcile** — for every `researching` membership whose job chain has stopped, decide the outcome
   (`resolveTargetState`): open job → wait; failed → `failed` with the reason; cancelled → `skipped`;
   succeeded → `qualified` at score ≥ 50, otherwise `researched`; no job at all → back to `queued`.
3. **Enqueue** — when due and allowed: check the queue is not paused, the provider is still
   authorized, the campaign budget, the daily target quota; resume memberships left `queued` (a job
   that vanished or an enqueue that failed), then select eligible prospects in scope; exclude
   prospects already in the campaign and those being researched elsewhere; add up to the batch size
   and queue `business_identity` with the campaign keys.
4. **Record** — write the run row and the campaign's last-run fields.

The scheduled worker (`/api/cron/automation`) reconciles every active campaign each minute and runs
the ones that are due, after processing the job queue. The jobs it queues run on the next tick, which
keeps the route inside its 300 s budget.

**Deduplication across campaigns.** A prospect is skipped while another campaign has it in
`researching` or any automation job for it is pending/running. It is picked up by whichever campaign
runs next after the work finishes. Identical campaign jobs also share an idempotency key, so a retry
of the same tick cannot queue a second identity job.

## 5. Scheduling, quotas and budgets

- **Schedules:** manual, daily, weekly (weekday + hour), monthly (day 1–28 + hour), all in
  Africa/Accra. Ghana has no daylight saving, so Accra is UTC all year and the schedule maths is
  plain UTC. The UI states the time as GMT.
- **Quotas:** `batch_size` (1–50) caps one tick; `daily_target_limit` (1–500) caps started targets per
  UTC day. The worker takes the smaller of the remaining quota and the batch size.
- **Budgets:** the optional monthly campaign budget stops **new** prospects once actual run cost plus
  open job estimates reaches it. Global per-provider budgets still apply to every paid call; a
  campaign can never raise them.
- **Pausing:** pausing a campaign stops new prospects; jobs already queued finish. Pausing the whole
  automation queue stops every campaign tick.

## 6. Security and consent

- Campaign work is scoped to one organization at every query (store, API and worker).
- RLS: members read campaigns, memberships, history and runs; only owners/admins create or change
  campaigns; owner/admin/researcher/sales may add or update memberships; history is append-only.
- Prospect eligibility excludes opt-outs, merged records, archived records and records marked
  inactive. The engine also refuses any job for an opted-out prospect.
- The campaign API is cloud-only, origin-checked, role-checked and rate-limited; it never returns
  another workspace's data and never logs record contents.
- No new outbound path exists. Dispatch and suppression logic are unchanged.

## 7. API and UI

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /api/campaigns` | automation runners | Campaigns with progress counts and spend |
| `POST /api/campaigns` | owners/admins | Create a draft |
| `GET /api/campaigns/:id` | automation runners | Campaign, prospects, runs, jobs, spend |
| `PATCH /api/campaigns/:id` | owners/admins | Edit fields or move status |
| `DELETE /api/campaigns/:id` | owners/admins | Delete a draft or cancelled campaign |
| `POST /api/campaigns/:id/run` | automation runners | Run one tick now |
| `POST /api/campaigns/preview` | automation runners | Count and sample the audience |

Automation Center → **Campaigns** shows totals, the campaign list with progress, a details panel
(prospects, run log, agent jobs), the creation form (nationwide / regions / districts / towns /
industries, schedule, quotas, budget, audience preview) and the provider policy table.

## 8. Tests

- `tests/unit/campaigns.test.ts` — regions/districts, provider declarations, scope matching,
  eligibility, scheduling across month/year boundaries, status rules, progress, reconciliation,
  input schema.
- `tests/unit/campaign-mapping.test.ts` — database row ↔ domain mapping.
- `tests/db/campaigns.test.ts` — district seed vs TypeScript, region-only records, district/region
  consistency, many-to-many membership, history and state machine, append-only history, RLS, campaign
  lifecycle, Google Places refusal, job attribution, spend, and both rollbacks (including the guard
  that protects town-less records).

Full suite at the time of writing: **556 tests passing**, plus typecheck, lint, production build and
the client-bundle scan.

## 9. Production migration plan (requires owner approval)

1. Confirm the baseline commit `06d4941` is the deployed code.
2. Take a database backup (docs/BACKUPS.md) and record the restore point.
3. Run `supabase/checks/preflight.sql` (read only) and keep the output.
4. Apply `009_research_campaigns.sql` in staging, then `010_region_records.sql`; run
   `supabase/checks/after-migrations.sql` and confirm every row says `ok`.
5. Apply in production during a quiet period. 009/010 are additive; the only locks of note are the
   new indexes and the `businesses.city` constraint change.
6. Deploy the application. Open Automation Center → Campaigns; create a draft campaign for one region
   and use **Preview the audience**; activate it and watch one tick in the run log.
7. Keep the first week manual-scheduled (`Only when someone runs it`) if the worker's schedule is
   being observed; then switch to daily.

### Rollback

Run newest first, after a backup:

```sql
-- supabase/rollback/010_region_records_down.sql
-- supabase/rollback/009_research_campaigns_down.sql
```

010 refuses to run while any prospect has no town (it names the count), so district-only records are
never silently deleted; give them a town or delete them deliberately first. 009 deletes campaign
tables and removes the two job columns; jobs and research already done stay. Neither rollback touches
the 003 queue functions.

## 10. Remaining third-party integration requirements

Nothing below is integrated, and none of it is claimed as available:

| Provider type | What is needed before a connector |
| --- | --- |
| Licensed business directory | Signed licence or data-processing agreement; permitted uses, retention and attribution written into the declaration; connector and tests |
| Commercial B2B provider | Contract covering CRM storage and outreach; field-level mapping; suppression feed; cost model |
| Business submission form | Public form, consent wording under Act 843, spam control, provenance fields |
| Public dataset | Licence review (redistribution and commercial use), update cadence, provenance |
| National registry / country integration | Data-sharing agreement, authentication, rate limits, lawful basis for CRM storage |
| Google Places approved batch | An independent, written determination that the use is permitted. Until then the database check and the application both refuse it. |

## 11. Deliberately not built

- Scheduled or bulk Google Places harvesting.
- Automatic acquisition of new businesses (campaigns only re-read tracked prospects).
- Automatic outbound messages; outreach safeguards and human approval are unchanged.
- Auto-completion of a campaign when its scope is exhausted (new prospects may be added later).
