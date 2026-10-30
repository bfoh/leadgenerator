# Migration 018 review — resource ledger privileges

Reviewed 30 October 2026 on `security/migration-018-resource-privileges`, branched from `2d63780`
(released to production on 30 October 2026).
Files: `supabase/migrations/018_business_resource_privileges.sql` (19 lines) and
`supabase/rollback/018_business_resource_privileges_down.sql`.
Closes the follow-up recorded with the release: 016's `business_resource_entries` still carried the
table privileges Supabase grants at creation.

**Not applied.** No production migration was run, nothing was pushed or deployed and no production
record was touched. Every statement below was executed only on local PGlite databases built from
`supabase/migrations/`.

## 1. What it changes — and what it deliberately does not

Three `revoke` statements and nothing else:

```sql
revoke delete, truncate on public.business_resource_entries from authenticated;
revoke all                on public.business_resource_entries from anon;
revoke truncate           on public.business_resource_entries from service_role;
```

Which follows from what the ledger actually is. A resource entry is revoked, never deleted: the
`business_resource_guard` trigger confines every update to `revoked_at`, and the data store only
reads, inserts and stamps that column (`src/lib/data/supabase-store.ts`). No code path deletes or
truncates a resource entry, and no job needs to. So:

- `authenticated` keeps select, insert and update — everything the collector page does — and loses
  delete and truncate.
- `anon` keeps nothing. No policy in the chain is written `to anon`, so nothing was readable through
  the grant; it was a capability that should not exist.
- `service_role` keeps delete for retention and erasure work, as 017 kept it for its two tables, and
  loses truncate, which it inherited from the same defaults and never used.

It does not touch the table, its three policies, its two triggers, any row, or any other table.

## 2. The gap, measured

Supabase's default privileges grant every role everything on a table a migration creates. 016 only
*granted* on top of them, so on a real project the ledger ended up with the full set for
`authenticated` and `anon`. Reproduced on PGlite with those defaults in place (the fixture applies
`alter default privileges in schema public grant all on tables to anon, authenticated` before 016, as
`tests/db/business-resources.test.ts` now does):

| Measure | Before 018 | After 018 |
| --- | --- | --- |
| `authenticated` privileges | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | INSERT, REFERENCES, SELECT, TRIGGER, UPDATE |
| `anon` privileges | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | *(no row — no privileges)* |
| `members_can_delete` | true | **false** |
| `members_can_truncate` | true | **false** |
| `worker_keeps_delete` | true | true |
| `open_grants` (`anon` + `PUBLIC`) | 7 | **0** |

TRUNCATE is the serious one, because it takes no account of row-level security: with the privilege in
hand, one statement from any signed-in member of any organization would empty the resource ledger for
every organization on the project. DELETE was only ever stopped by the absence of a delete policy —
one policy away from working.

`PUBLIC` holds nothing on this table and never did: `information_schema.role_table_grants` returns no
`PUBLIC` row before or after. There is nothing to revoke from it.

## 3. Dependencies

Migration 002 (`organizations`, `businesses`, `audit_events`, `is_org_member()`, `has_org_role()`)
and migration 016, which creates the table this file names. Applying it before 016 fails with
`relation "public.business_resource_entries" does not exist`; the preflight below reports 016 as
missing first.

## 4. Organization isolation and the revocation rules

Unchanged, and re-measured after the revoke:

- `business_resource_read`, `business_resource_insert` and `business_resource_revoke` are untouched,
  so a member still sees only their own organization's entries and a viewer still cannot create or
  revoke one.
- `business_resource_guard` and `business_resource_audit` are untouched, so facts stay immutable and
  a revocation is still one-way and audited.
- Revoking a privilege cannot widen a policy. The five tests in
  `tests/db/business-resources.test.ts` pass unchanged, including the isolation, provenance-denylist,
  viewer and immutability cases, plus one new test for the privileges themselves.

## 5. Idempotency and safety on existing data

Privileges only. No data, schema, policy or trigger is created, dropped or rewritten, so a table with
records is as safe to migrate as an empty one and nothing takes a rewrite lock.

Re-running the file is a no-op: a repeated `revoke` changes nothing and raises no error. Verified by
applying 018 twice to a fully migrated database and comparing the grant matrix before and after the
second run (identical), and the second run is part of the new test.

The one thing it cannot restore is a deleted row: it prevents the deletion, it does not undo one. If
the ledger has lost rows, that is a separate investigation.

## 6. Rollback and recovery

`supabase/rollback/018_business_resource_privileges_down.sql` puts the table back exactly as 016 and
the default privileges left it — `authenticated` regains delete and truncate, `anon` regains the full
set, `service_role` regains truncate. It is guarded for a database where 016 is already rolled back or
where the Supabase roles do not exist, and it is re-runnable.

Reversing it reopens the gap, so it exists for the reverse chain (newest first) and for restoring a
state you are about to replace — not for "trying" the migration. Nothing needs backing up first
because nothing but privileges changes; that is also why a rollback here cannot lose data and a
re-apply cannot duplicate it.

## 7. Production application steps (not executed)

Run each block in the Supabase SQL editor as `postgres`, in one session, and keep the output with the
change record.

1. **Preflight, read only.** Record the current grant state and the row counts, so the "no data
   changed" claim is measured rather than assumed:

   ```sql
   select
     has_table_privilege('authenticated', 'public.business_resource_entries', 'select')     as members_can_read,
     has_table_privilege('authenticated', 'public.business_resource_entries', 'insert')     as members_can_add,
     has_table_privilege('authenticated', 'public.business_resource_entries', 'update')     as members_can_revoke,
     has_table_privilege('authenticated', 'public.business_resource_entries', 'delete')     as members_can_delete,
     has_table_privilege('authenticated', 'public.business_resource_entries', 'truncate')   as members_can_truncate,
     has_table_privilege('service_role',    'public.business_resource_entries', 'delete')   as worker_keeps_delete,
     has_table_privilege('service_role',    'public.business_resource_entries', 'truncate') as worker_can_truncate,
     (select count(*)::int from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'business_resource_entries'
         and grantee in ('anon', 'PUBLIC'))                                               as open_grants;

   select count(*) as entries, count(revoked_at) as revoked
     from public.business_resource_entries;
   ```

   Expect `members_can_read/add/revoke = true`, `members_can_delete = true`,
   `members_can_truncate = true`, `worker_keeps_delete = true`, `worker_can_truncate = true` and
   `open_grants = 7`. If `members_can_delete` is already `false`, 018 is applied or this project never
   carried the defaults — stop and check before running anything.

   `supabase/checks/preflight-001-016.sql` (read only, one statement) additionally reports
   `018 resource ledger privileges` as `missing` and names it as the next file to apply.

2. **Apply.** Paste `supabase/migrations/018_business_resource_privileges.sql` whole. It takes a
   fraction of a second: no rewrite, no table lock worth scheduling around.

3. **Verify, read only.** Re-run the preflight query: `members_can_delete = false`,
   `members_can_truncate = false`, `worker_can_truncate = false`, `open_grants = 0`, with
   `members_can_read/add/revoke` and `worker_keeps_delete` still `true`. The grant matrix should show
   no `anon` row:

   ```sql
   select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'business_resource_entries'
      and grantee in ('anon', 'authenticated', 'service_role')
    group by grantee order by grantee;
   ```

   Then re-run the row counts from step 1: identical `entries` and `revoked`.

4. **Run the post-migration check** `supabase/checks/after-migrations.sql` (one read-only statement,
   now 42 rows). Row 33 `members can delete or truncate resource entries`, row 41 `resource ledger
   closed to anonymous visitors` and row 42 `worker keeps the resource ledger without truncate` must
   all read `ok`. Row 33 is expected to read `true` on production before this file.

5. **Then, and only then, exercise the page.** Signed in as an owner, open a prospect's resources, save
   one independent entry and revoke it. A `permission denied for table business_resource_entries` there
   would mean the page was relying on a privilege 018 removes — that is a real finding, not a cleanup:
   run the rollback file and report it.

## 8. Residual risks and what is still open

- **REFERENCES and TRIGGER remain** on `authenticated` and `service_role` (the default set includes
  them; 018 does not revoke them). They are weaker than DELETE or TRUNCATE — TRIGGER still needs an
  executable function and runs with the caller's rights — and every table in the chain carries the same
  grant, so taking them back belongs in one project-wide decision, not in this file. Recorded here so
  the gap is not mistaken for closed.
- **The other five tables from 014–016 still have the `anon` gap**: `studio_creative_briefs`,
  `studio_creative_brief_reviews`, `studio_creative_directions`, `studio_creative_direction_reviews`
  and `studio_website_prototypes`. 018 fixes only the ledger. The release-window statement in
  `docs/PRODUCTION_RELEASE_GATE.md` §5.3 covers every table in one run and remains the recommended way
  to close them; §5.4's verification query should then report five tables, not six.
- **The default privileges that created the gap are untouched.** Any future table created by a
  migration that grants without revoking starts permissive again. Only the `alter default privileges`
  half of §5.3 addresses that.
- **`service_role` keeps delete.** If retention and erasure are ever proven not to need it, that is a
  separate, smaller revoke.
- **Not verified on production.** The before/after figures above are PGlite with Supabase's defaults
  reproduced, not measurements of the production project. Step 1 is what turns them into a production
  record.

## 9. Verdict

Low risk, high value: three revokes, no data or schema change, no rewrite lock, instantly reversible,
and it removes a privilege that bypasses row-level security entirely. It closes the DELETE/TRUNCATE
half of the 016 gap and the `anon` half for this table. The rest of the release-gate finding —
REFERENCES and TRIGGER, the other five tables, and the default privileges themselves — stays open and
is named above rather than quietly implied to be fixed.

Local evidence: `tests/db/business-resources.test.ts` (5 tests, including the new privilege test that
fails if any revoke is removed), `tests/db/migrations.test.ts` (20 tests, including the preflight probe
and the 42-row post-migration check), the full unit and database suite, and `npm run build`. Nothing in
this review authorizes applying it.
