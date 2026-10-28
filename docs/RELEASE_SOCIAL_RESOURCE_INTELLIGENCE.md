# Release checklist: Bulk social intake and social resource intelligence

One page to run the release. The detail behind each step is in
[SOCIAL_RESOURCE_INTELLIGENCE](SOCIAL_RESOURCE_INTELLIGENCE.md) (what shipped, the provider rules and
the focused 017 check), [PRODUCTION_MIGRATION_PREFLIGHT](PRODUCTION_MIGRATION_PREFLIGHT.md) (the
read-only preflight) and [DEPLOYMENT](DEPLOYMENT.md) §4–7.

Branch: `feature/social-resource-intelligence`. Migration: `017_social_research_intelligence.sql`.
Rollback: `supabase/rollback/017_social_research_intelligence_down.sql`.

**Order matters.** The build gates the panel on `socialResearchAvailable()`, so 017 goes in **before**
the code. The reverse is safe: the old build ignores the new tables, and a new build with 017 still
absent simply hides the panel.

## 1. Pre-flight (read-only)

- [ ] Working tree clean; local checks green on the commit to deploy:
      `npm run typecheck && npm run lint && npx vitest run && npm run build`, plus
      `npx playwright test tests/e2e/social-discovery.spec.ts tests/e2e/social-intake-responsive.spec.ts tests/e2e/resource-collector.spec.ts tests/e2e/resource-collector-responsive.spec.ts`.
- [ ] Backup or point-in-time-recovery window confirmed ([BACKUPS](BACKUPS.md)).
- [ ] Preflight clean: `002 baseline present` = `yes`, `gaps in the installed chain` = `none`, no
      installed table showing `RLS OFF`. A gap blocks this migration; apply the missing migration
      first, in order. (On the 25 October audit production was missing **008** and **010**.)
- [ ] 017 is not installed yet:
      `select to_regclass('public.business_social_sources') is null as social_sources_absent;`
- [ ] If the target database holds an **earlier draft** of 017 (`social_sources_absent` = `f` but the
      tables lack the review constraints), run the down script first. `create table if not exists`
      would otherwise skip the tables and every constraint added later in review, leaving the claim
      checks unenforced.

## 2. Apply 017 in the Supabase SQL Editor

One file, one transaction, as a workspace owner:

```sql
begin;
-- Paste the complete contents of supabase/migrations/017_social_research_intelligence.sql.
commit;
```

- If any statement fails: `rollback;`, fix the cause, run the whole file again from the top. Do not
  paste a fragment and do not use `supabase db push` (no CLI history exists to reconcile).
- Re-running the final file over itself converges: the 017 suite re-applies it and asserts rows,
  policies and triggers are unchanged.

## 3. Verify (read-only, no writes)

- [ ] `supabase/checks/after-migrations.sql`: rows **1–23** say `ok`; rows **34–40** flip to `yes`
      (017 tables installed, RLS on both, 6 policies, 4 triggers, members cannot delete or truncate,
      source kind allows social profiles). Rows **24–33** report whichever earlier optional migration is
      installed; `not applied` there is a recorded gap, not a 017 failure.
- [ ] If row **33** (`members can delete resource entries`) reads `true`, 016 has the same
      Supabase-default-privilege gap that 017 now closes for itself. RLS still refuses the delete;
      record it as a follow-up migration rather than re-running 016.
- [ ] Focused 017 check (in SOCIAL_RESOURCE_INTELLIGENCE, "Post-migration check") returns **one row**
      and no data: every boolean true, `policies = 6`, `triggers = 4`, `members_cannot_delete` true.
- [ ] `select count(*) from public.business_social_sources;` and the same for
      `business_research_observations` return `0`: the migration invents no records.

## 4. Fast-forward and deploy

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main                      # stop if this fails: main moved
git merge --ff-only feature/social-resource-intelligence
git push origin main
git rev-parse HEAD                                   # record the SHA
```

`--ff-only` is deliberate: it refuses to create a merge commit, so a moved `main` stops the release
instead of silently rewriting history. Rebase, re-run §1, then try again.

- [ ] Vercel deploys production from `main` (or promote the preview built from the **same** SHA).
- [ ] The deployment's commit SHA equals the one recorded above, and the build log shows
      `check-client-bundle` passing (no server-only secret in the client bundle).

## 5. Post-deploy smoke (no paid calls)

- [ ] `/api/status` returns booleans only, with the expected integrations.
- [ ] Resource Collector on a demo prospect shows **Social sources** and the **Social Resource
      Intelligence** panel; a prospect with no sources explains why.
- [ ] Social discovery with the simulated world: **Select all** → **Add selected to CRM**; results
      without a retention basis come back as **Needs permitted source** and persist nothing.
- [ ] Resource Kit export contains `social-sources.json`, `research-observations.json` and
      `RESEARCH-BRIEF.md`, omits `business.json`, and withholds contact details.
- [ ] Only with an approved budget: run the collector loop against one real public profile and confirm
      the transient/retention-basis gate before any row is written.

## 6. Rollback

1. **Application first:** promote the previous deployment. Every build works with 017 applied, so the
   old build keeps running against the new tables.
2. **Database:** run `supabase/rollback/017_social_research_intelligence_down.sql` in one transaction.
   It keeps captured prospects by relabelling `social_profile` → `manual`, then drops the two social
   tables (their rows are gone, so export first if they matter) and restores the previous
   `businesses_source_kind_check`.
3. **Verify:** `after-migrations.sql` rows 34–40 read `not applied`; the focused check's table booleans
   read false. A new build with 017 rolled back is safe — the panel is gated on
   `socialResearchAvailable()`.

## 7. Known follow-ups (not part of this release)

- 016's `business_resource_entries` grants `delete`/`truncate` to members through Supabase's default
  privileges (016 has no `revoke`). RLS refuses deletes; TRUNCATE would not be refused. Fix in a new
  migration.
- Apply 008 and 010 if the preflight still reports them missing.

