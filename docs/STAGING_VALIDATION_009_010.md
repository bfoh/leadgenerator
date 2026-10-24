# Staging validation — migrations 009 and 010 on a hosted project

The ordered procedure for rehearsing `009_research_campaigns.sql` and `010_region_records.sql` on a
**hosted** staging Supabase project with a **non-production** deployment in front of it. The isolated
PGlite rehearsal is recorded in [STAGING_ACCEPTANCE_009_010](STAGING_ACCEPTANCE_009_010.md); it cannot
prove real roles, extensions, hosting or the scheduled worker — this does. Nothing here is applied to
production, and no step may be run against the production project or its connection string.

Owner sign-off is required before step 4. Do not proceed while step 1 is unproven.

## 1. Prove the environment is actually isolated (gate A)

| # | Check | Pass condition |
| --- | --- | --- |
| 1.1 | Supabase → the staging project exists and is **not** the live project | A second project ref, different from production |
| 1.2 | Vercel → Project → Settings → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` exist with **Preview** scope and the staging values; Production-scoped values are unchanged | Two separate values; no database variable scoped "All Environments" |
| 1.3 | The deployment under test was built with those values | `curl -sI https://<preview-url>/login \| tr ';' '\n' \| grep -i connect-src` prints the **staging** project origin, not production's |
| 1.4 | `https://<preview-url>/api/status` | Booleans only; `supabase: true`; `demoTools: false`; no URLs or keys |
| 1.5 | Sign in to the preview and look at the header badge and Settings → Agency | The staging workspace name, not the live one |
| 1.6 | The database connection string used below | Taken from the staging project (Connect), never from production |

Why 1.3 works: `NEXT_PUBLIC_*` is inlined at build time (`src/lib/supabase/config.ts`) and the CSP
`connect-src` is built from `NEXT_PUBLIC_SUPABASE_URL` (`next.config.ts`), so the response header names
the project that build can talk to. A preview whose CSP lists the production origin is not staging,
however it is labelled. Vercel does not fall back between environments: if no Preview-scoped Supabase
variables exist, the preview builds in demo mode (`supabase: false`) and proves nothing about cloud mode.

Keep `GOOGLE_PLACES_API_KEY`, `BRAVE_SEARCH_API_KEY` and `ANTHROPIC_API_KEY` **unset** on staging for
this validation: the acceptance below makes no paid call, and their absence proves it.

## 2. Back up the staging database (gate B)

1. Supabase → Database → Backups: take a manual backup (or note the PITR timestamp).
2. Take a logical dump you control, encrypted at rest (docs/BACKUPS.md §2):
   ```bash
   pg_dump "$STAGING_DATABASE_URL" --no-owner --no-privileges --format=custom \
     --file="dof-staging-$(date -u +%Y%m%dT%H%MZ).dump"
   ```
3. Record the time `T`: a restore loses every change after it.

## 3. Preflight (gate C)

Run `supabase/checks/preflight.sql` in the staging SQL editor. Read only, changes nothing. Expect:
`002` yes, `003` yes, `009` **no**, `010` **no**, and record the `businesses` table size (it predicts the
lock time in step 4).

## 4. Apply the migrations

Each file in one transaction, so a failure leaves no partial schema:

```bash
psql "$STAGING_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/009_research_campaigns.sql
psql "$STAGING_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/010_region_records.sql
```

Both are additive and re-runnable; 009 also adds `auto_complete` to a database that already applied an
earlier draft of itself. Time step 4 on the staging project and record it.

## 5. Post-migration checks

1. Run `supabase/checks/after-migrations.sql`: **every row must say `ok`** (23 rows). Save the output.
2. Confirm the objects directly (read only):

```sql
select (select count(*) from public.ghana_regions) as regions,      -- 16
       (select count(*) from public.ghana_districts) as districts,  -- 261
       (select count(*) from pg_class where relname in
          ('research_campaigns','campaign_targets','campaign_target_events','campaign_runs')
          and relrowsecurity) as tables_with_rls;                   -- 4
select count(*) as auto_complete_column from information_schema.columns
 where table_name = 'research_campaigns' and column_name = 'auto_complete'; -- 1
```

3. If the scheduled worker is configured, run `supabase/checks/worker-health.sql`.

## 6. Scheduling (only if the worker is being validated)

1. Supabase Vault holds the preview URL and `CRON_SECRET`; `pg_cron` and `pg_net` are enabled
   (docs/RUNBOOK.md §7).
2. `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are set on the **preview** deployment (Preview scope only).
3. `curl -s -o /dev/null -w '%{http_code}' https://<preview-url>/api/cron/automation` → `401`;
   with `-H "Authorization: Bearer $CRON_SECRET"` → `200`.
4. One tick is visible within a minute (Automation Center → Overview, *last job*, labelled
   *Background worker*), and `worker-health.sql` shows no overdue job.

## 7. Browser acceptance (owner, about twenty minutes, no paid keys)

| # | Action | Pass condition |
| --- | --- | --- |
| 7.1 | Automation Center → Campaigns → New | A draft campaign for one region and one industry saves |
| 7.2 | **Preview the audience** | Counts the tracked prospects in scope; nothing is written |
| 7.3 | Activate, then **Run now** | A run appears in the run log; targets move `queued` → `researching` |
| 7.4 | Automation Center → Jobs | The campaign's `business_identity` job carries the campaign and target ids |
| 7.5 | Edit the name and budget while researching | Saved; the card updates |
| 7.6 | Try to change the scope or schedule while researching | Refused (409) with the "research is still running" message |
| 7.7 | Add a district-only prospect (town blank, district set) | Region filled by the trigger; it matches a district campaign |
| 7.8 | Let the batch finish with *Complete automatically* on | The campaign closes itself; target, run and history rows stay readable |
| 7.9 | Pause and resume | New work stops and restarts; queued jobs finish |
| 7.10 | Delete a draft or cancelled campaign | Refused for an active one; a cancelled campaign is deletable |
| 7.11 | Analytics → *Estimated API cost*, and campaign spend | `$0`: no paid provider was called |
| 7.12 | Contacts and Outreach spot check | No consent was created and no message was queued by any of the above |

## 8. Rollback rehearsal

On a disposable copy — a second scratch project, or staging itself once §7 has passed and the step 2
dump exists — run newest first, each in one transaction:

```bash
psql "$SCRATCH_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/rollback/010_region_records_down.sql
psql "$SCRATCH_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/rollback/009_research_campaigns_down.sql
```

Then assert and re-apply:

1. `research_campaigns`, `campaign_targets`, `campaign_target_events`, `campaign_runs`, `ghana_districts`
   and `ghana_regions` are absent; `businesses.city` is `NOT NULL` again; `automation_jobs` no longer has
   `campaign_id` or `campaign_target_id`.
2. The 003 queue function `enqueue_automation_job` still has its original eleven arguments.
3. The **refusal path**: set one prospect's `city` to null, run the 010 rollback, and confirm it stops with
   a message naming the count and changes nothing; give the prospect a town and run it again.
4. Re-apply 009 and 010 and confirm §5 passes again.

## 9. Sign-off

| Item | Evidence to keep | Owner |
| --- | --- | --- |
| Isolation proven (§1) | The CSP line from 1.3 and the `/api/status` output | |
| Backup and restore point (§2) | Backup timestamp `T`, dump file name | |
| Preflight and post-migration output (§3, §5) | Saved query results | |
| Migration timings (§4) | Seconds per file, `businesses` size | |
| Scheduled worker (§6) | The 401/200 responses and one tick | |
| Browser acceptance (§7) | A note or recording per row | |
| Rollback rehearsal (§8) | The refusal message and post-rollback assertions | |

**Abort and roll back** (staging only) if any post-migration row says `LOOK AT THIS`, if a campaign that
uses Google Places can be created, if any §7 row writes a consent record or queues a message, or if §8
cannot restore the schema.

## 10. After sign-off

Production follows [RUNBOOK §16](RUNBOOK.md): backup → preflight → 009 → 010 → `after-migrations.sql` →
deploy → smoke test (docs/DEPLOYMENT.md §6). Until every row in §9 is signed, 009/010 stay unapplied in
production.
