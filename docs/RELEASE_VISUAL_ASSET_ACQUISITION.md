# Release checklist: Visual asset acquisition (the business's own images)

One page to run the release. The detail behind each step is in
[RESOURCE_COLLECTOR](RESOURCE_COLLECTOR.md) (§ Visual asset acquisition, and § Release
preparation), [PRODUCTION_MIGRATION_PREFLIGHT](PRODUCTION_MIGRATION_PREFLIGHT.md) (the read-only
preflight habit) and [DEPLOYMENT](DEPLOYMENT.md) §4–7.

Branch: `feature/google-business-resource-collector`. Migration: `020_visual_asset_acquisition.sql`.
Rollback: `supabase/rollback/020_visual_asset_acquisition_down.sql`.
Production baseline: `b0f4cf97` (the commit `main` and `origin/main` point at).
Reviewed feature SHA: `53362781` (feature) and `a6fa72da` (release preparation: the export-race fix,
the two check files and the `after-migrations.sql` rows). The SHA that ships is the one
`git rev-parse HEAD` reports at deploy (§4); nothing in this release rewrites history.

**Order matters, once.** 020 goes in **before** the code. The old build ignores the two new tables,
so the reverse order is not dangerous — but a new build with 020 absent simply hides the acquisition
panel (`visualAcquisitionAvailable()` probes the table and the service refuses with the prerequisite
name), which would ship this milestone as invisible. Apply, verify, deploy.

Nothing here is authorised by this document. Each numbered block is a separate approval: the backup
window, the apply, the deploy.

## 0. What this release is, and what it is not

| Ships | Does not ship |
| --- | --- |
| Migration 020, the candidate/rights ledger, the discovery + import + approval panel, the kit's `assets/` path, the delivery-time recheck of packed files | Any Adwoa's House creative change, any Studio or Quick Concept work, any redesign of Nsroma Atelier or Bantama Design Office |
| A read-only preflight (`supabase/checks/preflight-020-visual-acquisition.sql`) and verification (`supabase/checks/verify-020-visual-acquisition.sql`) | Live Google Places / website provider calls, image-similarity or reverse-duplicate detection |
| Two new regression tests for the export race, and `after-migrations.sql` rows 46–50 | Any new environment variable, any new bucket, any temporary database role |

## 1. Pre-flight (read-only), immediately before the apply window

- [ ] Working tree clean on the release SHA; local gates green (§9): `npm run typecheck`,
      `npm run lint`, `npx vitest run`, `npm run build`, and the visual-acquisition browser specs.
- [ ] **Backup / recovery readiness confirmed** ([BACKUPS](BACKUPS.md)): a current backup or a
      point-in-time-recovery window that covers the apply, and the restore path known to the operator.
      020 is additive, so recovery is needed for the *window*, not for the migration.
- [ ] Run the preflight, read only:

      PGOPTIONS='-c default_transaction_read_only=on' \
        psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 \
        -f supabase/checks/preflight-020-visual-acquisition.sql

- [ ] Record the output with the change record. Required rows:
      `002 baseline present` = `yes`; `prerequisites complete` = `yes`; `020 target tables` =
      `both absent`; `020 already installed` = `no - apply 020 once`; `019 Studio privileges` =
      `hardened`; `read-only session` = `yes`; `rows rewritten by the apply` = `0`.
- [ ] Keep the same-window copy of the section 4 counts (`businesses`, `studio_assets`,
      `studio_asset_events`, `business_resource_entries`, social sources and observations). These are
      the "existing data" numbers the verification compares against.
- [ ] **An earlier draft of 020 is the one dangerous state.** `020 target tables` = `both present`
      means someone already applied it: do not apply again, run the verification instead.
      `only one present` means an interrupted draft: run the down script (one transaction), re-run the
      preflight, then apply once. Do not "fix" a partial draft by pasting the file over it.
- [ ] Provider and budget drift: no provider key change, no budget change, no outbound-sending change
      is part of this release (§6).


## 2. Apply 020 in the Supabase SQL Editor

One file, one transaction, as a workspace owner:

```sql
begin;
-- Paste the complete contents of supabase/migrations/020_visual_asset_acquisition.sql.
commit;
```

- If any statement fails: `rollback;` and stop. Nothing was committed; the preflight state is
  unchanged. Fix the cause (almost always a missing prerequisite the preflight named), re-run the
  preflight, then apply the whole file from the top. Never paste a fragment, never `supabase db push`
  (no CLI history exists to reconcile), never "just the missing part".
- A full re-run over an installed 020 converges: every object is `if not exists`, or dropped and
  recreated by its own name. The PGlite suite re-applies the file over a populated ledger and asserts
  rows, policies and triggers are unchanged (`tests/db/visual-acquisition.test.ts`).

**Ordering after 001–019.** 020 is the newest file in the repository (nothing sorts after it) and
declares its own prerequisites: it raises an exception if `public.studio_assets` (013) or
`public.audit_row_change()` (002) is absent. The preflight proves the rest of the chain through object
markers, because the repository keeps no CLI history.

**No destructive change.** 020 only creates `visual_asset_candidates` and
`visual_asset_candidate_events`, attaches three triggers and two functions to them, and adds
policies, indexes and grants on those two tables. No existing table, column, policy or row is
altered; `tests/db/migrations.test.ts` asserts that no forward migration contains `drop table`,
`drop column`, `truncate` or an unconditional delete, and the verification compares the pre-apply
counts with the post-apply ones.

## 3. Verify (read-only, no writes)

- [ ] `supabase/checks/verify-020-visual-acquisition.sql` returns 24 rows and all say `ok`: both
      tables, RLS on both, the five policies and their commands, the three triggers with their timing,
      both rights checks, the unique image address, four foreign keys (three cascading), the exact
      member privileges, nothing for `anon` or `PUBLIC`, the worker's powers without `truncate`,
      `references` or `trigger`, the two guard functions not callable, their pinned `search_path`, and
      the three indexes.
- [ ] `supabase/checks/after-migrations.sql` rows 1–23 still say `ok`, and rows 46–50 read
      `3`, `0`, `false`, `true`, `true`. A row that says `not applied` in 46–50 means 020 is not
      installed; a `LOOK AT THIS` means it is installed wrongly.
- [ ] The ledger started empty (expect `0` and `0` on the first run; any other number means something
      wrote during the window):

      select (select count(*) from public.visual_asset_candidates) as candidates,
             (select count(*) from public.visual_asset_candidate_events) as events;


## 4. Deploy the reviewed code

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main                      # stop if this fails: main moved
git merge --ff-only feature/google-business-resource-collector
git push origin main
git rev-parse HEAD                                   # record the SHA
```

`--ff-only` refuses to create a merge commit, so a moved `main` stops the release instead of
rewriting history: rebase, re-run §1, try again.

- [ ] Vercel deploys production from `main`, or the preview built from the **same** SHA is promoted.
- [ ] The deployment's commit SHA equals the one recorded above, and the build log shows
      `check-client-bundle` passing (no server-only secret in the client bundle).
- [ ] Deployment health: the build finished, and `/api/status` answers 200 with booleans only.

## 5. Post-deploy smoke (read-only, no paid calls)

- [ ] Resource Collector on a demo prospect shows **Visual assets**; a prospect whose website is not
      verified explains why, and **Find visual assets** refuses with that reason rather than failing.
- [ ] With `SIMULATE_EXTERNAL_TOOLS=true` (demo mode, credentials blanked) discovery lists the fixture
      images as `reference_only` and fetches nothing; no thumbnail is requested for a third-party
      reference.
- [ ] Approving with a missing rights basis is refused in the panel with the vault's own wording.
- [ ] A kit exported from a prospect with no approved files still grades incomplete and contains no
      `assets/` folder; an existing kit with approved files is unchanged.
- [ ] Sign out of the smoke session; do not import from a real business website as part of the
      release (that is a separate, budgeted decision).

## 6. Coordination: no new variable, no temporary permission

- The feature needs **no new environment variable**. `visualAcquisitionAvailable()` probes
  `visual_asset_candidates` through the existing browser client, so 020's presence *is* the switch;
  there is nothing to set, and nothing to unset if the release stops halfway.
- No temporary role or grant is needed. The migration is applied by the existing owner account in the
  SQL editor; the browser uses the existing publishable key and RLS; the worker keeps only the powers
  it already had, stated row by row in the migration.
- No new bucket or storage policy. Authorized copies use the existing private `studio-assets` bucket

## 7. Rollback and recovery

**Application first.** Promote the previous deployment. It works with 020 applied: the old build never
reads the new tables, and the vault and kit keep their established behaviour.

**Database.** One transaction, by the same owner account:

```sql
begin;
-- Paste supabase/rollback/020_visual_asset_acquisition_down.sql.
commit;
```

It drops `visual_asset_candidate_events`, `visual_asset_candidates` and the two guard functions. No
other table is touched, and `studio_assets` and its files are untouched, because 020 never owned a
file. **Rows in the two tables are lost** — export or copy them first if a rights decision matters.

**After rollback:** the preflight reads `020 target tables` = `both absent`, `after-migrations.sql`
rows 46–50 read `not applied`, and the panel disappears on the next load. The existing vault, kits,
Studio, resource ledger and social sources are unaffected.

**If the apply fails mid-file:** the transaction never committed, so there is nothing to roll back;
`rollback;`, fix the named prerequisite, re-run the preflight, apply the whole file again.

**If verification fails after a committed apply:** do not deploy. Run the down script, re-apply the
whole file once, and re-verify. If it fails the same way twice, leave the ledger rolled back and hand
the verification output to the reviewer — a half-installed ledger is worse than none.

## 8. Safety while 020 is absent

- `SupabaseStore.visualAcquisitionAvailable()` selects one row from `visual_asset_candidates` and
  treats a missing-table error as `false`, caching the answer per store instance. Lists return `[]`;
  writes raise `StoreError(..., 'unavailable')` with the prerequisite name.
- Every acquisition service starts with `requireVisualAcquisition()`, so no panel state, crafted
  request or demo-mode call reaches a missing schema. The panel is hidden when the probe is false.
- The existing vault, kits, resource ledger, Studio and social sources never touch the new tables, so
  the deployed build behaves exactly as the previous one until 020 is applied.
- `LocalStore` (demo mode) implements the same ledger in memory; nothing in demo mode depends on the
  migration.

## 9. Local gates for this release

```bash
npm run typecheck
npm run lint
npx vitest run
npm run build
npx playwright test tests/e2e/visual-acquisition.spec.ts tests/e2e/visual-acquisition-responsive.spec.ts \
  tests/e2e/resource-collector.spec.ts tests/e2e/resource-collector-responsive.spec.ts
```

The export-race fix is covered twice: `tests/unit/studio-asset-services.test.ts` (a revoke that lands
between the row selection and the pack's own recheck) and `tests/unit/visual-acquisition.test.ts` (a
revoke that lands after the pack's recheck but before the archive is sealed, caught at the kit's
delivery point).

## 10. Known residuals (recorded, not fixed here)

- A revoke that commits between the final read and the browser writing the ZIP to disk is still
  possible in principle. The window is now the synchronous archive write plus the save, and the export
  fails closed if it is detected; closing it completely would need a server-side signed download,
  which is an architecture change this release does not make.
- Rate limits on the discovery, original and preview routes are per-instance memory, not shared.
- The unique image address is exact-string; canonicalisation happens in the service, so a differently
  written address is a new candidate, not a duplicate.
- `officialWebsite` is only written through the verification path; 020 adds no way to set it.
- No image-similarity or reverse-duplicate detection; duplicate bytes are caught by SHA-256 only.

  from 013; 020 stores addresses and decisions, never files.
- No budget, provider key or sending configuration changes. After deploy, re-check that
  `SIMULATE_EXTERNAL_TOOLS` and `DEMO_SERVER_TOOLS` remain unset in production, the Google Places key
  is still restricted to Places API (New), and no monthly budget was raised.

- [ ] The section 4 counts from the preflight are unchanged. 020 writes nothing outside its two
      tables, so a difference means the window, not the migration, needs explaining.
- [ ] Only then proceed to the deploy. A `LOOK AT THIS` row stops the release; see §7.
