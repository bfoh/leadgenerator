# Social resource intelligence

Bulk social intake, automatic profile linking and the Social Resource Intelligence panel inside the
existing Resource Collector. This is engineering work on top of the existing Discover → CRM →
Resource Collector → Website Resource Kit flow; it does not rebuild Studio, the Creative Director or
the website renderer.

## What changed

| Step | Before | Now |
| --- | --- | --- |
| Social discovery | One profile at a time through **Review & add** | Checkboxes, **Select all / Deselect all** and **Add selected to CRM** for up to 20 results in one action |
| Retention | Nothing could be saved from a profile | A profile link is retained only with a stated lawful basis; otherwise the result stays transient and is reported as **Needs permitted source** |
| Prospect creation | A full form with an independent source | Eligible results become **Unverified research candidates** with a linked social source; the individual **Review & add** flow is unchanged |
| Resource Collector | Google preview, website analysis, independent entries, assets | A **Social sources** section and a **Social Resource Intelligence** panel with source and status for every item |
| Resource Kit | Independent entries and approved assets | Adds `social-sources.json`, `research-observations.json` and `RESEARCH-BRIEF.md` |

## Provider compliance

Social discovery reads a public web index (Brave) for profile links. The search title, snippet,
ranking and query are **transient review material**. They are held in the browser for the session and
are never written to the CRM, the Resource Collector or the kit.

Before a candidate can be saved, the batch checks for a retention basis that is independent of the
search response:

- **First-party observation** — a person opened the public profile and confirmed it belongs to the
  business. The canonical profile URL and handle are retained; the profile content still is not.
- **Owner supplied** — the business gave the link. Recorded as owner confirmation of the account.
- **Licensed directory** — a directory licence permits storing the link. The licence reference goes in
  the evidence field.
- **Official website** — the link appears on the business's own site, recorded with where it was found.

No basis means no save. The result is returned as **Needs permitted source** with an explanation, and
nothing about it is persisted. Simulated (clearly fictional) practice profiles are exempt because no
provider was involved. Simulated searches also bypass the per-minute provider rate limit for that
reason; the live path keeps its 10-per-minute limit.

The implementation never scrapes Instagram, Facebook or TikTok, never bypasses a login, and never uses
a private or unauthorised API. Images are never downloaded, rehosted, stored or exported: only links
and permitted metadata are kept. Reusable originals must still go through the existing Asset Vault
permission and approval workflow.

## Duplicate protection

The batch compares each selected result against:

- active rows in `business_social_sources` (platform + normalized handle);
- every profile already on a prospect's `social_profiles` list;
- normalized names and cities/regions already in the CRM (a possible duplicate becomes **Needs review**,
  never an automatic merge);
- other results in the same batch (`possible_duplicate` / `duplicateOf`).

Retrying a batch is safe: a recorded profile is reported as **Already exists** before anything is
written. Existing prospects are never updated or merged by this path.

Each row ends in one of five states, summarised after the run:

```
3 added
0 existing
0 need permitted source
0 need manual review
```

or, on a retry, `0 added · 3 existing`. A row marked **Needs permitted source** stays visible so the
person can choose a basis and run the same selection again.

## Progressive verification

Bulk capture creates a prospect at `research_candidate` and does not advance its stage, confidence
logic or verification history. Website verification still runs through the existing verification
flow. A social profile on its own never establishes:

- business ownership;
- operating status;
- a verified address (search region and profile location are hints only);
- contact consent.

The Resource Collector's panel distinguishes three states for every item: **Observed**,
**Independently verified** and **Owner confirmed**. A discovered profile starts as **Observed**;
advancing it requires evidence and is forward-only (a correction is a new record, not an edit).

## Data model (migration 017)

`supabase/migrations/017_social_research_intelligence.sql` adds:

1. `business_social_sources` — canonical profile URL, normalized handle, provenance, retention basis,
   verification status/evidence, capture time and one-way revocation. One active link per
   `(organization, platform, handle)`, so the same profile cannot be attached to two prospects in
   one workspace. The insert trigger derives the starting status from the retention basis and
   refuses a status beyond it; an observed profile cannot arrive with verification evidence.
2. `business_research_observations` — category, statement, source kind/URL, status, evidence and
   one-way revocation. A `missing_information` entry must be a `research_gap` and cannot be verified.
   Google host checks include an optional trailing dot and reject userinfo in a source URL, so
   `google.com.` or `fictional.example@evil.example` cannot pass as an independent source.
3. A `social_profile` value on the businesses source-kind check.

Both tables are organization-scoped, RLS-protected, audited through the existing
`audit_row_change()` trigger, and granted to authenticated roles. Readers can read; owner, admin,
researcher and sales can insert and revoke/verify. Profile identity is immutable; verification moves
forward only with evidence; revocation cannot be undone.

The migration is prepared and tested on local PGlite. **It has not been applied to production.**
`supabase/rollback/017_social_research_intelligence_down.sql` restores the previous source-kind list
and keeps captured prospects by relabelling them `manual` rather than deleting them.

Until the migration is applied in a cloud workspace, the new panel shows a migration notice and the
rest of the Resource Collector keeps working. In demo mode the tables are part of the browser store.

The read-only preflight `supabase/checks/preflight-001-016.sql` now inspects 017 as well; its filename
is kept so existing runbooks and audit notes still point at it.

## Applying 017 in production (owner-run, not performed)

The step-by-step release run — pre-flight, apply, verify, fast-forward, Vercel, rollback — is
[RELEASE_SOCIAL_RESOURCE_INTELLIGENCE](RELEASE_SOCIAL_RESOURCE_INTELLIGENCE.md). This section records
the reasoning behind it.

**Nothing in this section has been applied.** It is the reviewed sequence for the owner to run after
approval; it is not an instruction to run it now. Migration 017 is additive except for the
`businesses_source_kind_check` replacement, which keeps every existing source kind and only adds
`social_profile`.

Prerequisites, all recorded in the change record:

1. A current production backup or point-in-time-recovery window, and a quiet request window.
2. The preflight output above, with `002 baseline present` = `yes`, `gaps in the installed chain` =
   `none`, and no installed table showing `RLS OFF`. On the 25 October audit, production was missing
   **008** and **010**; those two must be applied, in order, before 017. A gap blocks this migration.
3. A successful rehearsal of the same three files — 008, 010 and 017 — on the throwaway staging
   project ([STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md)).

In the Supabase SQL editor, as a workspace owner, one file per transaction:

```sql
begin;
-- Paste the complete contents of supabase/migrations/017_social_research_intelligence.sql here.
commit;
```

The file is guarded and re-runnable: `if not exists`, `drop policy if exists`, and `create or replace
function`. If any statement fails, run `rollback;`, fix the cause, and start the file again from the
top. Re-running the final file over itself converges, but a database that already holds an *earlier
draft* of 017 does not: `create table if not exists` skips the table, and with it every constraint
added later in review (the verification, evidence and source-kind checks). For that case run
`supabase/rollback/017_social_research_intelligence_down.sql` first — it keeps captured prospects by
relabelling them `manual` — then apply this file. Do not use `supabase db push`; this project's
history is recorded through the SQL editor and has no CLI history to reconcile. Do not run the down
script for a code rollback: it drops the two social tables.

After the commit, run `supabase/checks/after-migrations.sql` read-only. Rows 1–23 must say `ok`, and
rows 34–40 must read their expected value (`yes`, `6`, `4`, `false`, `true`). Rows 24–33 report
whichever earlier optional migrations are installed; `not applied` there is a recorded gap, not a 017
failure. The focused check below returns one row and no data. Expected after 017: all booleans true,
`policies = 6`, `triggers = 4`, and the authenticated delete and truncate privileges false.

```sql
select
  to_regclass('public.business_social_sources') is not null as social_sources_table,
  to_regclass('public.business_research_observations') is not null as observations_table,
  (select bool_and(relrowsecurity) from pg_class
    where oid in (to_regclass('public.business_social_sources'),
                  to_regclass('public.business_research_observations'))) as rls_on_both,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('business_social_sources', 'business_research_observations')) as policies,
  (select count(*) from pg_trigger
    where tgrelid in (to_regclass('public.business_social_sources'),
                      to_regclass('public.business_research_observations'))
      and tgname in ('business_social_source_guard', 'business_social_source_audit',
                     'business_research_observation_guard', 'business_research_observation_audit')) as triggers,
  (select pg_get_constraintdef(oid) like '%social_profile%' from pg_constraint
    where conrelid = 'public.businesses'::regclass
      and conname = 'businesses_source_kind_check') as source_kind_allows_social_profile,
  not has_table_privilege('authenticated', 'public.business_social_sources', 'delete')
    and not has_table_privilege('authenticated', 'public.business_research_observations', 'delete')
    and not has_table_privilege('authenticated', 'public.business_social_sources', 'truncate')
    and not has_table_privilege('authenticated', 'public.business_research_observations', 'truncate')
    as members_cannot_delete_or_truncate;
```

If 017 is applied but the UI is not deployed, the existing application is unaffected: the new
tables are additive and the panel's migration check simply reports them as available. Deploy only
after the post-migration checks pass and the demo/browser smoke test has been repeated against the
authorized staging environment.

## Website Resource Kit

The kit now includes, for the one prospect:

- `social-sources.json` — active permitted references with provenance, basis and status;
- `research-observations.json` — active observations with their source and status;
- `RESEARCH-BRIEF.md` — the grouped research view and the missing-resource checklist;
- `manifest.json` — counts, the excluded (revoked) counts and the policy statement;
- the existing independent resource entries, approved assets and briefs.

It still excludes Google listing content, previews, website candidates that are not approved files,
revoked entries, search titles/snippets/rankings, social images and expired or revoked assets. CRM
contact details, contact-channel observations and any observation whose statement, evidence or source
URL contains a phone number or email are withheld unless an export-permitted independent resource entry
covers them; verification evidence stays readable with those details redacted. A social reference whose
handle or canonical URL is itself a phone number is withheld too. The manifest reports those counts as
`withheldContactSources` and `withheldContactObservations`. The kit does not require a Brand Kit,
Creative Direction or generated website.

## Tests

- `tests/unit/social-intake.test.ts` — naming from handles, no live save without a basis, existing
  profile/name protection, retries, simulated profiles, source linking, forward-only verification,
  the 20-result cap, and absence of search copy in browser storage.
- `tests/unit/social-research.test.ts` — schema canonicalisation, honest statuses, panel groups and
  missing checklist, kit inclusion and revocation exclusion, contact-detail withholding from
  statements, evidence and source links, and evidence redaction.
- `tests/db/social-sources.test.ts` — RLS and organization isolation, canonical URL constraints
  (including trailing-dot and userinfo bypasses), unique active links, immutable identity,
  forward-only verification, evidence rules, one-way revocation and audit rows.
- `tests/e2e/social-discovery.spec.ts` — bulk selection and intake, summary, automatic profile linking,
  kit download, retry without duplicates, and the no-basis live result.
- `tests/e2e/social-intake-responsive.spec.ts` — phone widths 360/390/768 with no horizontal scroll.

Run `npm run typecheck`, `npm run lint`, `npm run test`, `npx playwright test` and `npm run build`.

## Remaining limitations

- There is no automated proof that a profile belongs to a business. That remains a person's
  observation or the owner's confirmation, recorded with evidence.
- Brave's licence still governs the search response. The app discards it; a deployment that needs to
  keep snippets or rankings must obtain a licence that explicitly permits storage.
- No platform API is used. Handle changes and deleted profiles are not detected automatically; a
  revoked link stays in history.
- Social observations are text and links only. A logo or photograph becomes usable only when an
  authorised original is uploaded and approved in the Asset Vault.
- Migration 017 requires the owner to apply it to production after review. No deployment, migration,
  paid provider call or outreach is part of this work.
