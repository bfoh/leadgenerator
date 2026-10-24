# Migration review — 009 research campaigns and 010 region records

Review date: 24 October 2026. Scope: `supabase/migrations/009_research_campaigns.sql`,
`supabase/migrations/010_region_records.sql` and their rollbacks. Executed on an isolated PGlite
database built from the real migration files (Supabase auth schema and roles stubbed, RLS exercised as
`authenticated`, `anon` and `service_role`). Nothing here was run against production.

## 1. What the migrations change

| Migration | New objects | Changes to existing objects | Backfill |
| --- | --- | --- | --- |
| 009 | `research_campaigns`, `campaign_targets`, `campaign_target_events`, `campaign_runs`; `enqueue_campaign_job`, `campaign_spend`, status/target guards, history trigger | `automation_jobs`: nullable `campaign_id`, `campaign_target_id`, two composite foreign keys, one partial index | None |
| 010 | `ghana_regions` (16 rows), `ghana_districts` (261 rows), district-sync trigger | `businesses`: nullable `district_code` + FK and indexes, `city` nullable, location checks | Seeds reference data; no business row is rewritten |

Both are additive. The only table-rewriting operations are the new indexes and the check-constraint
validation on `businesses` (one scan; every existing row has a town, so all pass). `alter column city
drop not null` is a catalogue change.

## 2. Row Level Security

| Table / operation | `authenticated` policy | Check |
| --- | --- | --- |
| `research_campaigns` select | `is_org_member(organization_id)` | read only own workspace |
| `research_campaigns` insert/update | `has_org_role(organization_id, {owner,admin})` | only owners/admins |
| `research_campaigns` delete | owner/admin **and** status in (`draft`, `cancelled`) | history cannot be deleted while live |
| `campaign_targets` select | `is_org_member` | own workspace |
| `campaign_targets` insert/update | owner, admin, researcher, sales | matches `automation.run` |
| `campaign_targets` delete | no policy, no grant | membership is not deleted by the app |
| `campaign_target_events` | select only | written by a SECURITY DEFINER trigger |
| `campaign_runs` select | `is_org_member` | own workspace |
| `campaign_runs` insert/update | owner, admin, researcher, sales | a manual tick records its run |
| `ghana_regions` / `ghana_districts` | select `true` | reference data, no writes for app users |

Composite foreign keys `(campaign_id, organization_id)`, `(target_id, organization_id)` and
`(business_id, organization_id)` make a cross-workspace link impossible even if a policy were
misconfigured. `automation_jobs` receives the same composite treatment. Tests read and write as an
outsider and are refused or see zero rows.

## 3. SECURITY DEFINER and privileges

| Function | Security | Search path | Execute granted to | Why it is safe |
| --- | --- | --- | --- | --- |
| `enqueue_campaign_job` | definer | `''` | `authenticated`, `service_role` (not `public`/`anon`) | Re-checks `can_automate(p_org)`, business/campaign/target membership **including the prospect**, parent trace and outbound stop; inserts only with the caller's `p_org` |
| `log_campaign_target_event` | definer | `''` | trigger only | Every identifier is schema-qualified; the actor is `auth.uid()`; appends only |
| `campaign_spend` | invoker | `''` | `authenticated`, `service_role` | Runs with the caller's rights, so RLS scopes it to the workspace (a foreign campaign returns 0) |

`authenticated` has no `INSERT`/`UPDATE`/`DELETE` on `campaign_target_events`; `service_role` keeps
select/insert but its update/delete grants are explicitly revoked. The event trigger writes as the
function owner, which is the only writer.

`enqueue_campaign_job` is a privileged path, so it validates every identifier separately rather than
trusting the foreign keys alone: the business, campaign and target must all belong to `p_org`, the
target must belong to the campaign, and (as of this review) the target's business must equal the job's
business. A mismatch is refused with `foreign_key_violation`.

## 4. Injection and dynamic SQL

Neither migration uses `EXECUTE`, `format()`, string interpolation or `%I`/`%L`. Every value is a
function parameter or a literal; all object names are written out and every function pins
`search_path = ''` with schema-qualified references. The application uses PostgREST parameters, not
SQL strings. No finding.

## 5. Append-only audit integrity

- `campaign_target_events` has no update/delete policy and no grant to `authenticated`; the rollback
  drops the table deliberately, but no runtime path edits it.
- The trigger records `added` on insert and every distinct `state` change, with actor type and id.
- A database test attempts both an update and a delete as an owner and is refused, then compares the
  rows before and after.
- `campaign_runs` is intentionally writable by the roles that may run a campaign; it is an operational
  log, not an audit ledger. The audit ledger remains `audit_events` (002), unchanged by these
  migrations.

## 6. Rollback behaviour

| Script | What it does | Safety behaviour |
| --- | --- | --- |
| `010_region_records_down.sql` | drops trigger, indexes, FK and `district_code`, drops the reference tables, makes `city` required again | Refuses first, with a count, if any prospect has no town; deletes nothing |
| `009_research_campaigns_down.sql` | drops the two functions and index, removes the job columns and constraints, drops the four tables | Jobs and research stay; 003 queue functions untouched; run as one transaction |

Both were executed on a disposable PGlite database. 010's refusal path was exercised (a district-only
record blocks it), then the record was given a town, the rollback succeeded, 009 rolled back, the
properties were asserted (tables/columns/functions absent, `city NOT NULL`) and both migrations were
re-applied. The 003 `enqueue_automation_job` remained present with its original 11 arguments.

## 7. Existing data and idempotency

- Applied to a database built through 008 with a business and an automation job already present: the
  business keeps its town, `district_code` is null, the job keeps working and gains null campaign keys,
  and a new campaign/target/job can be created afterwards.
- Re-applied 009 and 010 to a populated database (campaign, target, history): no duplicate rows, no
  lost events, 261 districts, state unchanged.
- Every table uses `if not exists`; columns use `add column if not exists`; constraints are guarded by
  `pg_constraint`; policies are dropped and recreated; functions use `create or replace`; seeds use
  `on conflict … do update`. The `auto_complete` column added after the first draft of 009 has its own
  `add column if not exists`, so an earlier copy upgrades in place.

## 8. Findings and fixes from this review

| Finding | Severity | Resolution |
| --- | --- | --- |
| `enqueue_campaign_job` accepted a target whose business differed from `p_business` | Medium (data integrity) | Fixed: the target lookup now also matches `business_id`; DB test refuses the mismatch |
| Campaign could only be closed by hand even when its scope was exhausted | Usability | Added `auto_complete` (default true) and a guarded completion step; no run row is removed |
| Concurrent manual ticks could double-count `enqueued` | Low (reporting) | Fixed: only a newly created job (`created = true`) counts; an existing job still re-attaches a stranded queued membership |
| Two manual ticks can each start a batch because only scheduled runs are claimed | Low | Unique `(campaign_id, business_id)` and idempotency keys prevent duplicate work; the daily quota is re-read on the next tick. Documented as a residual risk |
| `campaign_runs` is not append-only | Info | By design: the role that may run a campaign records the run; `audit_events` remains the immutable ledger |
| Reference data can only change through a migration | Info | Intended: `ghana_regions`/`ghana_districts` are read-only to app users |

## 9. Residual risks

- RLS and privileges are verified on PGlite with stubbed Supabase roles; a staging run on real Supabase
  is still required before production (docs/RUNBOOK.md §16).
- The 010 check-constraint validation scans `businesses`; on a very large table, apply during a quiet
  period.
- Rollback files must be run with `--single-transaction` (documented) so a refusal cannot leave a
  partial schema.
- Guan (`GH10-GUAN`) is a local code because the source predates the district; it is excluded from the
  260-record source comparison by design.

## 10. Evidence

`tests/db/campaigns.test.ts` (20 tests): district/region seed equality, region-only records, state
machine, append-only history, RLS, lifecycle, provider refusal, job attribution, spend isolation,
migration idempotency on populated and pre-009 databases, auto-complete column, cross-workspace
isolation, SECURITY DEFINER/search-path metadata, target/business mismatch refusal, and both rollbacks.

