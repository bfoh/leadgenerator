# Migration 016 review — independent business resources

Reviewed 25 October 2026 on `feature/google-business-resource-collector`.
File: `supabase/migrations/016_business_resources.sql` (40 lines).
Rollback: `supabase/rollback/016_business_resources_down.sql`.

**Not applied.** No production migration was run and no production Supabase object was touched. The
only executions of this file are the PGlite suites `tests/db/business-resources.test.ts` and
`tests/db/migrations.test.ts`, which build a database from every migration locally.

## 1. What it creates

One table, one guard trigger, one audit trigger and three policies. It adds no column to an existing
table and backfills nothing, so no existing row is rewritten.

`public.business_resource_entries` holds one independent, permissioned fact about one prospect:

- `id` uuid primary key, `gen_random_uuid()`
- `organization_id` uuid not null, references `organizations(id)` on delete cascade
- `business_id` uuid not null, bound by a composite foreign key
- `category` one of identity, contact, location, social, product, service, color, typography, brief
- `label` trimmed length 2-120
- `value` trimmed length 1-2000
- `source_kind` business_owner, official_website or licensed_original; there is deliberately no
  Google or social-platform kind
- `source_url` at most 2000 characters, must start with http(s) and must not match the Google/social
  host denylist in the check
- `evidence` trimmed length 15-1000, recording how the researcher verified it
- `export_permission` granted or denied
- `independently_verified` boolean not null, constrained to true
- `created_by` references `auth.users(id)` on delete set null, default `auth.uid()`
- `created_at` timestamptz default now()
- `revoked_at` timestamptz, the only column an update may change
- index on (organization_id, business_id), and a composite foreign key
  (business_id, organization_id) to businesses(id, organization_id) on delete cascade
- `business_resource_guard` before update, `business_resource_audit` after insert/update/delete

The denylist rejects Google and social hosts at the database boundary: google.*, googleapis.com,
googleusercontent.com, gstatic.com, goo.gl and its subdomains, ggpht.com, facebook.com, fbcdn.net,
instagram.com, cdninstagram.com, tiktok.com, linkedin.com, x.com and twitter.com. It matches Google
content arriving as a "source", which is the leak this table exists to prevent. `business.site` is not
listed; the retired Google Business Profile host would still be accepted, so a hardening pass should
add it to both this check and `restrictedResourceUrl` in `src/lib/domain/business-resources.ts`.

## 2. Dependencies

- Migration 002: `organizations`, `businesses` with `unique (id, organization_id)`, `audit_events`,
  `audit_row_change()`, `is_org_member()` and `has_org_role()`. Production has 001-008 since
  2026-10-23, so this is present.
- The Supabase `auth` schema: the `auth.uid()` default and the `auth.users` foreign key.
- PostgreSQL 13 or later for `gen_random_uuid()` in core; Supabase runs 15 and later.

No dependency on 003-015. The file references no automation, campaign, discovery or Studio object and
no storage bucket, so it can be applied at 002 without breaking earlier features.

Runtime dependencies are wider than migration dependencies. The prospect page's vault, uploads and
manual ZIP need 012-015 (`studio_projects`, `studio_assets`, and the private `studio-assets` bucket
from 013); the Studio concept entry needs 012. Without them the page still renders: the vault section
falls back to "Add authorized files" and `resourceCollectorAvailable()` reports the ledger missing.
Keeping the retained Place ID needs only 002's `businesses.places_place_id`.

The runbook records 011 as not applied and does not record 012-015, so 016 is the last link of a chain
whose earlier Studio links have not been reviewed for production here. Applying 016 alone is safe for
the database but would ship a collector whose vault cannot store files.

## 3. RLS and organization isolation

- RLS enabled. Only `authenticated` and `service_role` hold grants, so `anon` can read nothing.
- Read: `business_resource_read`, select to authenticated, `is_org_member(organization_id)`.
- Insert: `business_resource_insert`, requiring `has_org_role(organization_id, {owner, admin,
  researcher, sales})`. A viewer can read but not create; covered by "allows a member to read but a
  viewer cannot create or revoke resource entries".
- Revoke: `business_resource_revoke` allows update for those same four roles.
- Delete: no policy and no authenticated delete grant, so the app can never remove a fact. Only
  `service_role` may delete, and the audit trigger records it.
- Cross-organization: the composite foreign key makes a mismatched (business, organization) pair
  impossible even if a caller forges one side, and each policy scopes statements to the caller's own
  membership. Covered by "isolates independent resources by organization and enforces the business
  binding".
- Immutability: `guard_business_resource_entry()` allows exactly one transition, `revoked_at` null to
  a timestamp. Every other update raises 42501, including clearing a revocation, so a correction is a
  new row. Covered by "keeps facts immutable while allowing audited one-way revocation".
- Audit: `audit_row_change()` writes `audit_events` rows scoped to the entry's organization, so a
  revocation is attributable to a user and a time.

One application consequence: revoking the same entry twice raises 42501 rather than succeeding
quietly. The UI hides the button once `revokedAt` is set, so this only appears from a stale tab, and
the store surfaces it as an error, which is the correct behaviour but worth knowing.

## 4. Storage and export permissions

- 016 creates no bucket, object path or storage policy. Google listing text and photo bytes never
  reach storage: details stay in the current view with `cache: 'no-store'` and are cleared after five
  minutes, and a photo request returns only a Google-hosted URL that the browser loads directly.
- The feature's only storage is the private `studio-assets` bucket from 013 (26 MB, image/PDF/text/
  video/font MIME allowlist, org-scoped folder policies). 016 does not change it, so applying 016
  grants no new storage permission.
- Export is application-side. `src/lib/data/resource-services.ts` keeps only entries that are not
  revoked, carry `export_permission = 'granted'`, parse against `resourceEntrySchema` and have a source
  URL that passes `restrictedResourceUrl`. The ZIP also needs the `data.export` permission and is
  rebuilt from fresh eligibility at download time, so Google content is excluded twice: the columns
  are constrained and the export filter re-checks the host.
- `service_role` holds delete on the table. Operational cleanup must use a backup and keep the same
  audit trail; normal work has no reason to use the service key here.

## 5. Idempotency and data conflicts

Re-runnable as written: `create table if not exists`, `create index if not exists`, `create or replace
function`, `drop trigger if exists` then create, `drop policy if exists` then create, and repeatable
grants. The migration suite re-applies the whole chain.

Residual risks:

- `create table if not exists` is idempotent but not self-repairing. If a partial or hand-made
  `business_resource_entries` already existed, the columns, checks and foreign key would be skipped
  silently. Confirm the table is absent before applying and treat its presence as a stop-and-inspect
  signal.
- No backfill and no unique constraint on (business_id, category, label), so duplicate facts are
  possible by design: the viewer flags conflicts instead of overwriting, and corrections are new rows.
  Nothing can conflict with existing data, because the table starts empty.
- Check constraints reject whitespace-only values and out-of-range lengths. The app trims before
  insert; a direct insert must trim too.
- `created_by` defaults to `auth.uid()`, so a service-key or seed insert records null rather than a
  false author, which the column allows.
- Creating the foreign key takes a brief lock on `businesses`, but the referencing table is empty, so
  there is no validation scan and no rewrite of existing business rows.

## 6. Rollback and recovery

`016_business_resources_down.sql` drops the table and then the function. Dropping the table removes
its triggers and index with it, and 016 has no dependency on 013-015, so ordering only matters against
later migrations.

- The rollback is destructive for collected facts. Independent entries carry evidence a researcher
  wrote and cannot be regenerated from Google. Take the backup in `docs/BACKUPS.md` and keep a SQL dump
  of the table first.
- `audit_events` rows with `table_name = 'business_resource_entries'` are not removed by the rollback.
  They remain as history in a global table: harmless, but the retention policy should know.
- After a rollback the app degrades cleanly: `resourceCollectorAvailable()` returns false, the page
  shows "Migration 016 is needed to save independent entries", `listResourceEntries` returns an empty
  list and `createResourceEntry` raises a `StoreError`. Google viewing and the vault keep working, and
  no route returns 500.
- Recovery is a re-apply (safe and idempotent) plus reloading the dumped rows under their original
  organization and business keys.

## 7. Pre-apply checklist (not executed)

1. Back up production and record the current migration markers from Section 2.
2. Decide 009-015 first: the collector's vault and ZIP are only usable after 012-015.
3. Run `supabase/checks/preflight.sql` (read only) and keep the output. Its `installed` rows stop at
   010, so extend that list with 011-016 before relying on it for this apply.
4. Apply in staging, run `supabase/checks/after-migrations.sql`, and confirm the four resource tests in
   `tests/db/business-resources.test.ts` still describe the deployed schema.
5. Apply during a quiet period, deploy the application, then open one prospect's resources page and
   confirm the "Migration 016 is needed" notice is gone and an entry can be saved and revoked.

## 8. Verdict

Low risk as a database change: additive, no backfill, no rewrite, org-scoped RLS, immutable with an
audited one-way revocation and a clean rollback. Two items belong beside it rather than inside it: the
`business.site` denylist gap, and the fact that 016 alone does not make the vault or ZIP usable.
Nothing in this review authorizes applying it.
