# Production migration preflight, 001–016 (read only)

Prepared 26 October 2026 on `feature/google-business-resource-collector`. **Nothing was applied.** No
migration ran against any hosted project, no backup was restored, no `supabase db push` and no CLI
migration was used, and production Supabase was not modified. This is the inspection that must happen
*before* an apply window, and it ends where the apply window begins.

It covers the whole chain, 001 to 016, because the recorded production state stops at 008 and everything
after it rests on prose rather than evidence:

> 001–008 were applied by the owner through the SQL editor on 2026-10-23 and `after-migrations.sql`
> passed 18 of 18. 009–016 appear in no production record; 011 is recorded as *not applied*;
> 012–016 are drafts. There is no CLI history in the repository to confirm any of it
> ([MIGRATION_REVIEW_016](MIGRATION_REVIEW_016.md) §2, [MIGRATION_REVIEW](MIGRATION_REVIEW.md) §1).

So the operator does not know where the chain actually stands, and one inspection is cheaper than four
partial ones. `supabase/checks/preflight.sql` (001–008 era) still works; this file supersedes it for the
full chain and adds the Storage bucket and the 016 ledger.

## 1. What this procedure is, and is not

| Is | Is not |
| --- | --- |
| A read-only inspection of a live project, with one SELECT | An apply, a dry run, or a `db push` |
| A record of what is installed, what the next file is, and where the risk is | A staging rehearsal (that is [STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md)) |
| Evidence for the owner's go/no-go decision | Permission to touch production |

The apply path, once approved, stays [MIGRATION_REVIEW](MIGRATION_REVIEW.md) §3 (back up, apply one file
per transaction, re-run the checks, then deploy). Rollbacks are `supabase/rollback/NNN_…_down.sql`,
newest first. This document adds nothing to that path — it only makes the decision defensible.

## 2. Run it without any possibility of a write

The inspection is one `SELECT` statement: no DDL, no DML, no `set`, no temp table, no writing function.
`tests/db/migrations.test.ts` proves that property twice — it runs the statement inside `begin
transaction read only`, and it asserts that no write keyword appears outside a string literal.

Choose one of these, strongest first:

1. **A read-only database role**, if the project has one. Nothing else in this document then matters
   for safety, because the role cannot write.
2. **psql with the whole session defaulted to read-only** — any accidental write fails instead of
   succeeding:

   ```bash
   PGOPTIONS='-c default_transaction_read_only=on' \
     psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 \
     -f supabase/checks/preflight-001-016.sql
   ```

3. **The SQL editor**, pasting only the file. It is one statement, so the editor shows its result.
   Read the file first: everything above `with chain(` is a comment, and the statement begins there.

Never: `supabase db push`, `supabase migration up`, `psql -f` of a migration file, or restoring a backup
into the production project — none of those are read-only, and none belong in this step.

Keep the connection string in the shell of the machine doing the inspection (or in the dashboard's own
editor). It is not written into the repository, a document or a screenshot.

The paste-ready sequence — guards proven before and after the check runs — is §10.

## 3. What to capture

One evidence bundle per run, so a later reader can tell what the decision was based on:

- the full output of §4 as CSV or the editor's result grid, saved as
  `preflight-001-016_<project-ref>_<UTC date>T<time>Z.txt`;
- the project ref, `pg_database_size()`, and whether `supabase_migrations.schema_migrations` exists;
- the git commit of the code being deployed (`git rev-parse --short HEAD`);
- who ran it, when, and which of the three methods in §2 was used.

Content rules: counts and schema shape only. No keys, no connection strings, no business names,
addresses, phone numbers or photo URLs. `docs/evidence/` holds this kind of record for other reviews.

## 4. Reading the output

The statement returns one table: `section`, `check`, `value` and `meaning`, ordered by section. Work
through the sections in order; a failure in an earlier section makes the later ones meaningless.

| Section | Rows | Pass condition | If it fails |
| --- | --- | --- | --- |
| `chain` | one per migration, 001–016 | `present` for every file already applied, `missing` for every file not yet applied | A `present` you did not expect means someone applied a file outside the documented path: stop and find out when |
| `database` | role, privilege, version, size, extensions, Storage, load | `connected as` names the role (owner for the apply run; ideally a different one for this pass); `Supabase Storage schema` = `present`; `other sessions open` small; `requests or transactions running over 5 minutes` = `0` | `can create objects in public` = `yes` under a role you created for read-only use means the role is wrong. A non-zero long-request row means a busy window: wait. Storage `absent` means 013 will skip the bucket, so uploads cannot work |
| `objects` | one per table the chain owns | every installed table shows `RLS on` with its policy and trigger counts, e.g. `RLS on · 3 policies · 2 triggers`; every table from an unapplied file shows `missing` | `RLS OFF` on an installed table is a security regression: stop and investigate before adding anything |
| `storage` | the bucket and its policies | the bucket row dumps `id, public, file_size_limit, allowed_mime_types` with `public` false and `file_size_limit` `26214400`; four `studio_assets_storage_%` policies | `missing` after 013 was applied, or `public` true, blocks the vault and the ZIP |
| `records` | existing rows, members and proposals by status | counts match what you expect; `approved or sent proposals without an approval time` = `0` is the clean case | A non-zero value is not fatal (008 copes) but must be recorded, because it changes how change requests are judged |
| `impact` | businesses size, five largest tables, files still to apply | recorded, not judged | Use it to pick the window: 003 rewrites every business row once |
| `gates` | three rows | `002 baseline present` = `yes`, `gaps in the installed chain` = `none`, `next file to apply` names the file | A named gap means an object exists whose migration did not run: stop. A `next file` other than the one you planned means the plan is wrong |


Two rows deserve to be read twice:

- **`gaps in the installed chain`** is the only row that detects a half-applied project. It reports a
  migration whose object is missing while a later one is present. Anything but `none` is a stop.
- **`next file to apply`** replaces the guesswork about where the chain stands. Apply that file next, no
  other, and re-run the inspection after it.

## 5. Gates per migration

What the preflight must show before each file is worth applying. Everything here is inspection; the
apply itself is unchanged from [MIGRATION_REVIEW](MIGRATION_REVIEW.md) §3.

| File | Precondition the preflight must show | If not |
| --- | --- | --- |
| 001 | `public.leads` present | Leave it alone: on a project that never had it, 001 is not part of the chain |
| 002 | `businesses` present with its policies | Apply 002 first and nothing else; every later file assumes it |
| 003 | `organization_members` has at least one `owner`; `businesses` size recorded | No owner means nobody can approve spend or lift suppressions after the upgrade |
| 004 | `website_verifications` count recorded | Record only; the migration marks existing scores as human-reviewed |
| 005 | `businesses opted out` count recorded | The matching suppressions are created by 005; note the number so the post-apply check can compare |
| 006 | nothing beyond 002 | 006 is additive; keep the messaging pause switch on afterwards until reviewed |
| 007 | `chain` row 007 agrees with `next file to apply` | If 007 is already present, the plan is behind the project: re-read the chain before applying anything |
| 008 | `approved or sent proposals without an approval time` recorded | Non-zero is expected on old data; 008 copes, but the number belongs in the record |
| 009 | `message_policies` present if messaging is in use | 009 does not require 007; it only changes campaign behaviour |
| 010 | `businesses` count recorded | 010 seeds geography; it does not touch prospects |
| 011 | `pg_cron`/`pg_net` presence noted | 011 needs no extension, but the optional worker does; without them, discovery runs stay manual |
| 012 | `studio_projects` missing | If present, someone applied a draft: stop and diff against the committed file |
| 013 | `Supabase Storage schema` = `present` | Without Storage the migration still applies but the bucket is skipped, and uploads cannot work |
| 014 | `studio_projects` present after 012 | 014 binds a direction to a project; ordering matters |
| 015 | `studio_brand_kits` present after 013 | 015 binds a prototype to a Brand Kit version |
| 016 | `businesses` composite key and 013 assets in place | 016 is additive; the ledger refuses Google-origin rows at the constraint level, so a failure here is a bug, not data |

## 6. Stop conditions

Stop before applying anything, and report instead, if any of these holds:

- `002 baseline present` is not `yes`, or `gaps in the installed chain` is not `none`;
- any installed table shows `RLS OFF`, or an installed table has fewer policies than the committed file
  creates (compare with `pg_policies`, which the `objects` rows count);
- the `studio-assets` bucket is `public=true`, or 013 is installed without its four policies;
- more than one person or integration is connected during the window, or a request has been running for
  minutes;
- the captured `businesses` count or table size is wildly out of line with the backup's (a restore or a
  duplicate import would explain that, and neither may go unnoticed);
- `supabase_migrations.schema_migrations` claims a version the `chain` rows do not support: the two
  sources disagreeing means the history is not trustworthy for rollback decisions.

## 7. After the preflight

1. Attach the evidence bundle, the `gates` rows, and the intended file order to the change record.
2. The owner decides. Preflight is evidence, not approval; a green inspection authorises nothing.
3. Rehearse on the throwaway staging project first — [STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md)
   for the collector surface, [MIGRATION_REVIEW](MIGRATION_REVIEW.md) §3 step 3 for a full chain.
4. Only then the apply window, one file per transaction, re-running this inspection after each file and
   `supabase/checks/after-migrations.sql` at the end. Rollbacks exist for 003–016; 001 and 002 are
   restored from the backup.

## 8. Local evidence that already exists

`tests/db/migrations.test.ts` (19 tests, all passing on PGlite — the run is reproduced in §9) covers this
inspection as far as a local database can:

- the statement runs inside `begin transaction read only` at 002, on the complete chain, on the gap case
  and with a stubbed Storage schema;
- as pasted, it is exactly one statement (`exec` returns one result), so the SQL editor will show it;
- it reports `present`/`missing` for all sixteen markers, names `003 automation infrastructure` as the
  next file at 002, `0` files still to apply on a complete chain, and `none` for gaps;
- it flags a gap when 010 is skipped but 011–016 are applied;
- it reads the `studio-assets` bucket row and the four storage policies;
- it contains no write keyword outside a string literal.

PGlite cannot prove Supabase's own roles, extensions, Storage service, connection pooling, or the timing
of 003's rewrite on a real `businesses` table. Those are exactly the rows §4 and §6 ask the operator to
read on the project itself.

## 9. Reproducing the local evidence

```bash
npx vitest run tests/db/migrations.test.ts    # 19 passed, ~32 s, network blocked
```

If a future change to the check breaks these tests, the check is wrong, not the expectation: it must stay
one read-only SELECT with no write keyword outside a literal.

## 10. Runbook, one step at a time

Placeholders: `<repo>` is this checkout, `<project-ref>` the production project ref. The connection
string is read into the shell and never typed into a file, a document or a screenshot.

**Before you start**

- A terminal with `psql` (`psql --version`). It is **not installed on the owner's laptop** as of
  26 October 2026; on macOS `brew install libpq && brew link --force libpq`, or use the SQL editor
  fallback at the end.
- Dashboard → Project Settings → Database → **Connection string (URI)**. Prefer the direct connection
  (port 5432). If only the pooler is reachable, use 5b instead of 5a.
- The commit being deployed, from a clean tree. Do not run the check against uncommitted SQL.
- No apply window, nobody else in the project, nothing queued. This is inspection only.

**1 — record the code state**

```bash
cd <repo>
git status --porcelain          # expect empty
git rev-parse --short HEAD      # this commit is what the evidence refers to
```

**2 — read the connection string without leaving it in history**

```bash
read -r -s PRODUCTION_READONLY_URL; export PRODUCTION_READONLY_URL
```

Paste the URI at the prompt and press Return. Nothing is echoed, and it never enters `~/.zsh_history`.

**3 — prove the session is read-only before anything else**

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 -c \
  "select current_user, current_setting('default_transaction_read_only') as read_only, version()"
```

Expect `read_only = on`. If it is `off`, stop: the guard is not in effect. If the pooler rejects the
startup parameter, skip to 5b — that method does not rely on `PGOPTIONS`.

**4 — prove the guard actually bites**

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 -c \
  "create temp table preflight_probe(id int)"
```

Expect `ERROR: cannot execute CREATE TABLE in a read-only transaction`. That error is the proof the run
cannot write, and it creates nothing.

**5a — run the check (direct connection)**

```bash
mkdir -p ~/preflight
PGOPTIONS='-c default_transaction_read_only=on' psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 --csv \
  -f supabase/checks/preflight-001-016.sql \
  | tee ~/preflight/preflight-001-016_<project-ref>_$(date -u +%Y%m%dT%H%M%SZ).csv
```

**5b — run the check behind a transaction pooler**

Session settings do not survive transaction pooling, so wrap the single statement in an explicit
read-only transaction, which holds one backend for its duration:

```bash
{ echo 'begin transaction read only;'; cat supabase/checks/preflight-001-016.sql; echo '; commit;'; } \
  > /tmp/preflight-001-016-wrapped.sql
psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 --csv -f /tmp/preflight-001-016-wrapped.sql \
  | tee ~/preflight/preflight-001-016_<project-ref>_$(date -u +%Y%m%dT%H%M%SZ).csv
```

**6 — capture the three supporting values**

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 --csv -c \
  "select current_database() as database, pg_database_size(current_database()) as bytes, to_regclass('supabase_migrations.schema_migrations') as cli_history"
```

**7 — close the session and confirm nothing is left behind**

```bash
unset PRODUCTION_READONLY_URL
rm -f /tmp/preflight-001-016-wrapped.sql   # only if 5b was used
git status --porcelain                     # still empty
```

No migration ran, no row changed, no object was created; the only artefact is the CSV.

**8 — read the CSV in order**

`chain`, then `gates`, then `database`, then `objects`, `storage`, `records`, `impact`. §4 gives the pass
condition for each section and §5 the gate for each file. Stop at the first condition in §6 that holds,
capture the output, and report.

**If `psql` is not available: the SQL editor**

Paste the file into the SQL editor and run it once. There is no `PGOPTIONS` there, so the read-only
guarantee rests on the file itself: everything above `with chain(` is a comment, and the rest is one
`SELECT` (proved in `tests/db/migrations.test.ts`). Do not edit or "fix" anything in the editor; if a row
surprises you, copy the result and stop.

