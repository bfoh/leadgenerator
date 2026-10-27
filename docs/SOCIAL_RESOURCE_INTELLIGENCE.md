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
   `(organization, platform, handle)`.
2. `business_research_observations` — category, statement, source kind/URL, status, evidence and
   one-way revocation. A `missing_information` entry must be a `research_gap` and cannot be verified.
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

## Website Resource Kit

The kit now includes, for the one prospect:

- `social-sources.json` — active permitted references with provenance, basis and status;
- `research-observations.json` — active observations with their source and status;
- `RESEARCH-BRIEF.md` — the grouped research view and the missing-resource checklist;
- `manifest.json` — counts, the excluded (revoked) counts and the policy statement;
- the existing independent resource entries, approved assets and briefs.

It still excludes Google listing content, previews, website candidates that are not approved files,
revoked entries, search titles/snippets/rankings, social images and expired or revoked assets. CRM
contact details and contact-channel observations are withheld unless an export-permitted independent
resource entry covers them; the manifest reports them as `withheldContactObservations`. The kit does
not require a Brand Kit, Creative Direction or generated website.

## Tests

- `tests/unit/social-intake.test.ts` — naming from handles, no live save without a basis, existing
  profile/name protection, retries, simulated profiles, source linking, forward-only verification,
  the 20-result cap, and absence of search copy in browser storage.
- `tests/unit/social-research.test.ts` — schema canonicalisation, honest statuses, panel groups and
  missing checklist, kit inclusion and revocation exclusion.
- `tests/db/social-sources.test.ts` — RLS and organization isolation, canonical URL constraints,
  unique active links, immutable identity, forward-only verification, evidence rules, one-way
  revocation and audit rows.
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
