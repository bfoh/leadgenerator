# Database Migration Review (Phase 10)

Status on 2026-10-23: migrations **001–008 are on the production project.** The owner applied 003–008 on 2026-10-23, and `supabase/checks/after-migrations.sql` passed on production (all 18 checks ok). Before that they were tested on PGlite only.

## 1. What each migration does to existing data

| Migration | Changes to existing tables | Data written | Locks and rewrite | Rollback |
| --- | --- | --- | --- | --- |
| 001 private leads | Creates `leads` (v6). Never edited. | — | — | None (legacy) |
| 002 workspace model | Creates the organization model, RLS and functions. | Copies each owner's `leads` into `businesses` on first sign-in; `leads` is kept. | — | Not needed: additive; a v6 build still works |
| 003 automation | `businesses`: four workflow columns (constant defaults, no rewrite), check constraints, workflow triggers. | **One UPDATE of every business** to derive its workflow state from the CRM stage, with the touch and audit triggers paused (so `updated_at` and the audit log are untouched). An `automation_settings` row per workspace. | ALTER takes a brief exclusive lock; the backfill rewrites each business row once; the constraint checks scan `businesses` | `003_…_down.sql` (deletes the job queue, run log, workflow history and settings) |
| 004 research | `website_verifications` and `businesses`: new nullable or constant-default columns, constraints, foreign keys (all new columns start empty, so they validate trivially), update guards. | Existing verifications are marked as made by people. | Brief locks; scans for the constraint checks | `004_…_down.sql` (undo merges first) |
| 005 contacts | New tables only; consent records and suppressions are append-only. | **A suppression for every business already opted out.** No consent record is created from profile permission. | — | `005_…_down.sql` (export consent and suppressions first) |
| 006 messaging | `suppressions`: source constraint replaced (existing rows checked). | — | Scan of `suppressions` | `006_…_down.sql` |
| 007 sending policy | `automation_settings`: policy columns and constraints; `eligibility_decisions`: outcome constraint replaced. | Default sending policy per workspace. | Scans of small tables | `007_…_down.sql` |
| 008 replies | `proposals`: a before-update guard (sets the approval time on approval; blocks acceptance while a change request is open). | — | Trigger creation only | `008_…_down.sql` |

Every forward migration is additive and re-runnable (`if not exists`, `create or replace`, guarded backfills). Rollbacks run newest first: **008 → 007 → 006 → 005 → 004 → 003**; each refuses to run while a later one is installed.

## 2. Evidence

- `tests/db/migrations.test.ts`:
  - static checks: RLS on every table, a pinned `search_path` on every security-definer function, no `drop table`, `truncate`, `drop column` or unconditional `delete` in a forward migration, and a rollback for every migration from 003;
  - the production path: a 002 database with a v6 lead, five prospects (opted out, permission recorded, outreach stage, won) and an issued proposal is upgraded to 008. Records are unchanged column for column; workflow states are derived correctly; the opted-out business is suppressed; no consent is invented; the old issued proposal can still be decided. The chain is then rolled back to **exactly** the 002 schema (tables, triggers, policies) with records intact, re-applied and run again.
- Per-migration suites in `tests/db/` (guards, RLS, re-running, rollback order).
- `supabase/checks/preflight.sql` runs read-only at 002 and at 008 (tested).
- `supabase/checks/after-migrations.sql` passes after the upgrade and flags a missing safety trigger (tested).

**Limits of PGlite.** The auth schema and roles are stubbed. pg_cron, pg_net and Supabase's own extensions are absent. Default privileges are approximated. Performance on large tables is not measured. A staging run on real Supabase (§3 step 3) covers these.

## 3. Applying 003–008 to production

1. **Back up** (docs/BACKUPS.md §2) and note the point-in-time recovery timestamp.
2. **Inspect:** run `supabase/checks/preflight.sql` in the SQL editor and save the output. It is a single read-only SELECT. Look at:
   - opted-out businesses (they will be suppressed);
   - businesses with permission on the profile (no consent record is created; people record consent before any message);
   - the businesses table size (003 rewrites each row once).
3. **Staging:** restore the backup into a separate Supabase project (or branch), apply 003→008 there, point a preview deployment at it, and run the smoke test (docs/DEPLOYMENT.md §6).
4. **Approval:** the owner approves with the preflight output and the staging result. Production migrations are never run without it.
5. **Apply** each file in order, as a single transaction, at a quiet time:
   ```bash
   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/003_automation_infrastructure.sql
   ```
   (or paste one whole file per run in the SQL editor). Re-run the preflight after each file; the matching `installed` row turns to `yes`. After 008, run `supabase/checks/after-migrations.sql`: every row should say `ok` (tested on PGlite after a 002→008 upgrade with existing records).
6. **Deploy** the application. It works with any prefix of the migrations; features whose tables are missing say "database update required".
7. **If a step fails:** the transaction leaves nothing behind. Fix the cause and re-run the same file. To undo a completed migration, use its rollback (newest first), or restore the backup (docs/BACKUPS.md §4).
