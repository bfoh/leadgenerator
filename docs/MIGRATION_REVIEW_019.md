# Migration 019 review — Studio table privileges

Reviewed 30 October 2026 on `security/migration-019-studio-privileges`, branched from `d66e5e1` (the
production commit, which already carries 018).
Files: `supabase/migrations/019_studio_privilege_hardening.sql` (85 lines, sha256
`cb1cebf792e84d779e83a8f5b8771f2a251800a1d16df278fdf1cbd2d0fb24eb`) and
`supabase/rollback/019_studio_privilege_hardening_down.sql` (37 lines, sha256
`ae426370bcf84f46f3d1050b9d670725d56ffe0f8767e418d93d097036b9f127`).
Closes the follow-up recorded with 018: the five Studio tables created by 014 and 015 still carried the
table privileges Supabase grants at creation.

**Not applied.** No production migration was run, nothing was pushed or deployed and no production
record was touched. Every statement below was executed only on local PGlite databases built from
`supabase/migrations/`, with Supabase's creation-time defaults reproduced.

## 1. What it changes — and what it deliberately does not

Three `revoke` statements over the five tables plus one version-guarded fourth, and nothing else:

```sql
revoke delete, truncate on  <the five> from authenticated;
revoke all                on  <the five> from anon;
revoke truncate           on  <the five> from service_role;
-- Postgres 17 only, skipped on 15 and 16 where the privilege does not exist:
revoke maintain           on  <the five> from authenticated, service_role;
```

where `<the five>` is `studio_creative_briefs`, `studio_creative_brief_reviews`,
`studio_creative_directions`, `studio_creative_direction_reviews` and `studio_website_prototypes`.

Which follows from what those tables are. 014 and 015 declare `select, insert` for members and
`select, insert, update, delete` for the worker; the lifecycle is append-only (briefs and directions are
immutable versions, reviews are append-only) and `src/lib/data/supabase-store.ts` reads and inserts and
nothing more. The Studio routes run on the signed-in user's client (`mode: 'cloud'` in
`src/lib/server/context.ts`), so the caller is `authenticated` under RLS — never `anon`, never the service
role. So:

- `authenticated` keeps select and insert — the whole of what the Studio does — and loses delete and
  truncate.
- `anon` keeps nothing. No policy in 014 or 015 is written `to anon`, so nothing was ever readable
  through the grant; it was a capability that should not exist.
- `service_role` keeps delete for retention and erasure work, as 017 and 018 kept it, and loses truncate,
  which it inherited from the same defaults and no job uses.
- Both privileged roles also lose `MAINTAIN` **where the server has it**: Postgres 17 added it to
  `ALL PRIVILEGES`, so the same defaults hand out `vacuum`, `analyze`, `cluster`, `reindex` and `refresh`.
  It reads and writes no row, but CLUSTER and REINDEX take an exclusive lock, so one member of one
  organization could stall every organization's Studio writes. Supabase's 15 and 16 have no such privilege,
  and `revoke maintain` is a syntax error there, so the statement sits inside a `server_version_num >=
  170000` guard and is skipped rather than failing the file.

It does not touch the tables, their ten policies, their five guard triggers, any row, any other table, or
any default privilege.

### The UPDATE question, answered rather than skipped

`authenticated` also holds UPDATE on all five tables from the same defaults, and 014 and 015 never granted
it. It stays, deliberately, for the reason 018 gave on the ledger — and the reason is measured, not
assumed: neither migration defines an update policy, so an authenticated update **matches no row** (0 rows
affected on a fully migrated database, `note` unchanged) and never reaches the guard trigger. A privilege
no path can reach is not a hole; revoking it would change one error message and remove the only place the
guards are exercised in the test suite.

If the declared matrix (`select, insert`) is wanted verbatim later, that is `revoke update` on the same
five tables plus a test that proves the guard triggers still refuse an edit for a role that holds UPDATE
(`service_role`). It is recorded here as a one-word follow-up, not folded into this file.

## 2. The gap, measured

Supabase's default privileges grant every role everything on a table a migration creates, and 014 and 015
only *granted* on top of them. Reproduced on PGlite with those defaults in place (the fixture applies
`alter default privileges in schema public grant all on tables to anon, authenticated` before 014, as
`tests/db/studio-privileges.test.ts` does):

| Measure | Before 019 | After 019 |
| --- | --- | --- |
| `authenticated` on each of the five | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | INSERT, REFERENCES, SELECT, TRIGGER, UPDATE |
| `anon` on each of the five | the same seven | *(no row — no privileges)* |
| `service_role` on each of the five | the same seven | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, UPDATE |
| `anon` grant rows in `public` | 35 (5 tables × 7) | **0** |
| `authenticated` can truncate a Studio table | true | **false** |
| `authenticated` can delete a Studio table | true | **false** |
| policies / triggers on the five | 10 / 5 | 10 / 5 (unchanged) |
| rows in `studio_creative_briefs` | 1 | 1 (unchanged) |

`MAINTAIN` is absent from that table because the harness runs Postgres 17 while Supabase may run 15 or 16;
where the server has the privilege the file takes it back from both roles (see §1), and the test asserts
that directly on 17+. The seven-privilege matrix above is the one that reads the same on every version.

TRUNCATE is the serious half, because it takes no account of row-level security: with the privilege in
hand, one statement from any signed-in member of any organization would empty every organization's Studio
history at once. DELETE was only ever stopped by the absence of a delete policy — one policy away from
working. Neither is reachable by the application: no route, store method or worker job deletes a Studio row.

`PUBLIC` holds nothing on these tables and never did: `information_schema.role_table_grants` returns no
`PUBLIC` row and `aclexplode` shows no `grantee = 0` entry before or after. There is nothing to revoke
from it, so the file does not pretend to.

## 3. Dependencies

Migrations 002 (`is_org_member()`, `has_org_role()`, `audit_row_change()`), 012 (`studio_projects`), 014 and
015. The file's first statement is a guard that raises
`Migration 019 needs the five Studio tables from migrations 014 and 015.` instead of failing halfway
through a half-built project. The preflight (§8, step 1) reports 014 and 015 as the first missing files anyway.

## 4. Isolation, guards, and what the revoke does not replace

Unchanged, and re-measured after the revoke:

- The ten policies are untouched, so a member still sees only their own organization's Studio history, a
  viewer still reads and cannot write, and a viewer or another organization still reaches no row.
- The five guard triggers are untouched, so briefs and directions stay immutable, reviews stay append-only,
  and the direction/prototype approval rules still hold.
- `anon` now fails at the privilege check rather than at a policy that does not exist, which is the point:
  a future permissive policy would have to be added *and* the grant restored.

One finding worth recording, because it changes what the existing test suite proves.
`tests/db/creative-direction.test.ts` asserts that an authenticated update of a brief is refused, and it
passes — but in the harness (which has no Supabase defaults for `authenticated`) it passes on
`permission denied`, not on the guard's `immutable` message. Under the real defaults the privilege exists
and the statement is filtered by RLS before the trigger. The guard is proven where it actually matters:
`service_role`, which holds UPDATE and bypasses RLS, gets `Creative briefs are immutable…`. The new test
asserts exactly that, and asserts the member path by outcome (the `note` does not change).

## 5. Idempotency and safety on existing data

Privileges only. No data, schema, policy or trigger is created, dropped or rewritten, so a table with
records is as safe to migrate as an empty one, and nothing takes a rewrite lock.

Re-running the file is a no-op: a repeated `revoke` changes nothing and raises no error. Verified by
applying 019 twice to a fully migrated database and comparing the grant matrix before and after the second
run (identical), and the second run is part of the new test. A row written before the rollback is still
there after it, and after a re-apply.

The one thing it cannot restore is a row that was truncated or deleted before it ran: it prevents the next
one, it does not undo the last one. If a Studio table has lost history, that is a separate investigation.


## 6. Default privileges: the half 019 deliberately does not touch

019 revokes on five existing tables. It does **not** run `alter default privileges`, and that is a decision,
not an oversight.

**What the defaults are.** In `public`, the project carries default ACLs that apply to every table a
migration creates: `anon`, `authenticated` and `service_role` each receive the full seven privileges at
`CREATE TABLE` time. That is why 014 and 015 ended up permissive without asking for it.

**Which role they belong to.** A default ACL is recorded against the role that *creates* objects and
against the role that *granted* the default. Both matter, and they are what a `revoke` must match:
`alter default privileges` executed as a different grantor silently changes nothing at all. Measured on the
replica (`tests/db/studio-privileges.test.ts`), with the fixture reproducing Supabase's setup:

```sql
select pg_get_userbyid(d.defaclrole) as object_creating_role,
       case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       pg_get_userbyid(a.grantor) as grantor,
       d.defaclobjtype as object_type,
       string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
 where d.defaclnamespace = 'public'::regnamespace
 group by 1, 2, 3, 4
 order by 2, 4;
```

On the replica the object-creating role and the grantor are both the role that ran the migrations. **On
production they have to be read, not assumed**: if the row shows `supabase_admin` as grantor for defaults
that apply to `postgres`-created objects, then a `revoke` run as `postgres` removes nothing, and the
statement must run as `supabase_admin` (or be made through the dashboard's default-privileges control).
That single row is the first thing to check before touching defaults at all.

**Why it is a separate decision.** The defaults are project-wide: they govern every table any future
migration creates, including tables for features that do not exist yet. Narrowing them is a policy change
with its own review — and the project already has a specified, evidenced statement for it in
[MIGRATION_REVIEW_018](MIGRATION_REVIEW_018.md) §8 and
[PRODUCTION_RELEASE_GATE](PRODUCTION_RELEASE_GATE.md) §5.3:

```sql
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
```

Run as the grantor, that stops the recurrence for `anon`. The test in `tests/db/studio-privileges.test.ts`
shows both halves side by side: after 019 a table created afterwards still grants `anon` select and
`authenticated` truncate; after the §5.3 statement a table created afterwards grants `anon` nothing. So
the residual is measured rather than implied, and nobody can read this review and conclude that creating
the next table is safe by default.

**What is not proposed here.** Revoking defaults for `authenticated` or `service_role`. `authenticated`
receiving `select` on a new table is how every migration in the chain expects to start, and narrowing it
would break the next feature written in the established pattern. `service_role` bypasses RLS by design and
needs its full set for retention work. If either is ever narrowed, it is one project-wide change with its
own review, and every migration from 003 onward would have to grant explicitly.

## 7. Rollback and recovery

`supabase/rollback/019_studio_privilege_hardening_down.sql` puts the five tables back exactly as 014, 015
and the default privileges left them: `authenticated` regains delete and truncate, `anon` regains the full
seven, `service_role` regains truncate. Each table is guarded on its own, so a project where 014 or 015 was
already rolled back restores what still exists and skips the rest, and the `anon` grant is guarded on the
role existing. It is re-runnable, and it is exercised in the full reverse chain by
`tests/db/migrations.test.ts`.

**A rollback is not safe merely because it restores old grants.** Reversing 019 reopens exactly the
vulnerability it closes: any signed-in member of any organization could `truncate` all five Studio tables
in one statement, TRUNCATE ignoring RLS entirely, and `anon` would hold a full table grant on private
client work again. Two honest qualifiers: the delete half would still be filtered by the missing delete
policy, and no policy admits `anon`, so neither is *exploitable* at the moment the rollback runs — they
are one policy away, which is the whole argument for removing them. So the down file exists for the reverse
chain and for restoring a state you are about to replace. It is not a way to "try" the migration, and a
rollback should be followed by a fix, not left in place.

Nothing needs backing up first: nothing but privileges changes, which is also why a rollback cannot lose
data and a re-apply cannot duplicate it.


## 8. Production application steps (not executed)

Run each block in the Supabase SQL editor as `postgres` (or as the role that owns the tables), in one
session, and keep the output with the change record.

1. **Preflight, read only.** The grant matrix, using the catalog rather than
   `information_schema` so the answer does not depend on which roles the operator belongs to:

   ```sql
   select c.relname as table_name,
          case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
          string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
     from pg_class c
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('studio_creative_briefs', 'studio_creative_brief_reviews',
                        'studio_creative_directions', 'studio_creative_direction_reviews',
                        'studio_website_prototypes')
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))
    group by 1, 2
    order by 1, 2;
   ```

   Expect, on each of the five tables: an `anon` row and an `authenticated` row with
   `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`, and a `service_role` row with the same seven.
   No `PUBLIC` row. On Postgres 17 each of those three rows also lists `MAINTAIN`; that is the same
   creation-time grant and it is removed where it exists. **If `authenticated` already lacks delete and
   truncate, the project never carried the defaults or someone ran the release-gate statement — stop,
   record which, and skip to step 3.**

   Then the row-count baseline, so "no data changed" is measured rather than assumed:

   ```sql
   select 'studio_creative_briefs' as table_name, count(*) from public.studio_creative_briefs
   union all select 'studio_creative_brief_reviews', count(*) from public.studio_creative_brief_reviews
   union all select 'studio_creative_directions', count(*) from public.studio_creative_directions
   union all select 'studio_creative_direction_reviews', count(*) from public.studio_creative_direction_reviews
   union all select 'studio_website_prototypes', count(*) from public.studio_website_prototypes;
   ```

   Optionally record §6's `pg_default_acl` query too: it is informational here, and it is the evidence
   needed before anyone touches the defaults.

2. **Apply.** Paste `supabase/migrations/019_studio_privilege_hardening.sql` whole. A fraction of a
   second: three `revoke` statements, no rewrite, no lock worth scheduling around.

3. **Verify, read only.** Re-run the matrix from step 1. Expect no `anon` row on any of the five, and:

   | Role | Privileges after 019 |
   | --- | --- |
   | `authenticated` | `INSERT,REFERENCES,SELECT,TRIGGER,UPDATE` |
   | `service_role` | `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE` |
   | `anon` / `PUBLIC` | no rows |

   On Postgres 17 `MAINTAIN` is gone from both remaining rows too; on 15 and 16 it never appeared.

   Re-run the row counts: identical to step 1. Then run `supabase/checks/after-migrations.sql` (one
   read-only statement, now 45 rows): rows 43 `Studio creative tables closed to anonymous visitors`,
   44 `members can delete or truncate Studio creative rows` and 45 `worker keeps the Studio creative tables
   without truncate` must read `ok`. Rows 43 and 44 are expected to read `LOOK AT THIS` before this file
   is applied, which is what makes them worth having.

4. **Then, and only then, exercise the pages.** Signed in as an owner, open a Studio project with a
   direction and a prototype and save one new brief version, then one prototype version. A
   `permission denied for table studio_creative_…` there would mean a page was relying on a privilege 019
   removes — that is a real finding, not a cleanup: run the rollback file and report it.

### GO / NO-GO

GO only when all of these hold:

- Step 1 returns the before matrix on all five tables and no `PUBLIC` row.
- The row-count baseline is recorded and, after the apply, identical.
- Step 3's after matrix matches the table above exactly, and rows 43–45 of `after-migrations.sql` read
  `ok`.
- `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` and the browser tests pass on the
  release commit, and the client-bundle secret check is clean.
- The reviewer accepts §6: the defaults stay as they are, and the residual is recorded rather than closed.

NO-GO for any of: a `PUBLIC` row before or after; `members can delete or truncate Studio creative rows`
still reading `true`; a row count that moved; a `permission denied` on a Studio page; or 014/015 reported
missing by the preflight (apply those first — 019 refuses to run).

## 9. Residual risks and what is still open

- **`REFERENCES` and `TRIGGER` remain** on `authenticated` and `service_role` (the default set includes
  them; 019 does not revoke them, and `anon` loses them only because it loses everything). They are weaker
  than DELETE or TRUNCATE — TRIGGER still needs an executable function and runs with the caller's rights —
  and every table in the chain carries the same grant, so taking them back is one project-wide decision,
  not this file. Recorded here so the gap is not mistaken for closed.
- **`UPDATE` on `authenticated`** is kept. It is inert (no update policy, measured 0 rows, guard triggers
  untouched), and §1 records the one-word follow-up if the declared matrix is ever wanted verbatim.
- **The default privileges are untouched.** Any future table created by a migration that grants without
  revoking starts permissive again. Only §5.3's `alter default privileges` half addresses that, and §6
  explains why it is a separate change that needs the grantor read from `pg_default_acl` first.
- **`service_role` keeps delete** on the five tables. If retention and erasure are ever proven not to need
  it, that is a separate, smaller revoke.
- **The other tables in `public`** keep whatever the defaults gave them; 019 names five on purpose. The
  release gate's §5.3 statement remains the project-wide alternative, and if it is ever run 019 becomes a
  no-op rather than a conflict.
- **The 012–013 Studio tables** (`studio_projects`, `studio_observations`, `studio_reviews`, `studio_assets`
  and the Brand Kit tables) were out of scope for this milestone and were not re-audited here. 013 revokes
  `anon` explicitly when it creates its tables; 012's three tables should be measured against the same
  matrix in a follow-up review rather than assumed either way.
- **Not verified on production.** The before/after figures are PGlite with Supabase's defaults reproduced,
  not measurements of the production project. Step 1 of §8 is what turns them into a production record.

## 10. Verdict

Low risk, high value: three revokes over five tables, no data or schema change, no rewrite lock, instantly
reversible, no application code path affected, and it removes a privilege that bypasses row-level security
entirely. It closes the `anon`, DELETE and TRUNCATE half of the 014–015 finding. The rest of the
release-gate finding — REFERENCES and TRIGGER, UPDATE, the 012 tables and the default privileges
themselves — stays open and is named above rather than quietly implied to be fixed.

Local evidence: `tests/db/studio-privileges.test.ts` (6 tests: before/after matrix, member and viewer
behaviour, cross-organization access, the worker's set and the guard trigger, default privileges unchanged
plus the §5.3 statement, idempotency and rollback), `tests/db/migrations.test.ts` (21 tests, including the
019 preflight probe, the 45-row post-migration check and the full reverse chain),
`tests/db/creative-direction.test.ts` (11 tests, unchanged), the rest of the unit and database suite,
`npm run typecheck`, `npm run lint`, `npm run build` and the client-bundle secret check. Nothing in this
review authorizes applying it.
