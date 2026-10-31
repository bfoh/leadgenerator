# Google-first Resource Collector

Branch: `feature/google-business-resource-collector`. Extends the existing Asset Vault; no Studio
redesign, Quick Concept, AI generation, production migration, push or deployment is included.

## Repository audit and implementation plan

- Reuse Google Places (New), server-only key, error mapping, quota/budget and paid-request ledger.
- Reuse the DNS-pinned, robots-aware, bounded website reader and structural/contact extractors.
- Reuse per-prospect Studio project identity, private Asset Vault, upload validation, approvals,
  provenance, five permissions and export eligibility. Resource collection needs no Brand Kit,
  creative direction or generated website. A private vault is opened only when first needed.
- Add a prospect resource page, the two entry actions, transient Google listing/photo viewing,
  independent website candidates, a small permissioned factual-resource ledger, and a manual ZIP kit.
- Add migration 016 for independent resource entries only; test locally with PGlite, never apply live.

## Google boundary (reviewed 25 October 2026)

Google details and photo names/URLs exist only in the current viewer, with no-store responses and no
query-cache/local-storage/database persistence. Photos load directly from the official photo service;
no bytes pass through storage, image optimization or ZIP export. Only a Place ID can be retained.
Each paid operation is explicitly initiated; details, search and individual photo requests are bounded,
metered and budget checked. Live collector calls require a server enable switch. Tests use fixtures.

Sources: [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies),
[Place Photos](https://developers.google.com/maps/documentation/places/web-service/place-photos),
[EEA adjustments](https://developers.google.com/maps/comms/eea/places),
[EEA permitted uses](https://cloud.google.com/terms/maps-platform/eea-places-api-permitted-uses).
The intended EEA use is managing a sales team's named opportunities (permitted use 3). No embedded map
is shown; only the API-provided source links are attached to Google content. Account-specific terms
still govern. Independent website data and owner-authorized materials never inherit Google's rights.

Google's required Google Maps logo and the returned author/provider credits accompany results: the
viewer footer carries the official, unmodified logo next to Terms and Privacy, and each photo shows its
author's avatar, name and profile link plus a direct link to the source photo on Google Maps. Public
terms and privacy links explain Google's terms. A missing website field is not proof that the business
has no website. Website ownership and export rights must be independently confirmed; a discovered URL
grants neither.

## Identifying a Place-ID-only reference

A prospect created from a Place ID carries only a reference label (`Unverified place …`). **Identify this
business** on the Google Places card asks for the name a person is looking for, runs at most three bounded
searches and reads at most three candidate homepages with the existing guarded reader, then shows the name
each site publishes, the ownership evidence behind it and what acceptance would change. The record is
untouched until someone accepts the reading.

- Searches use the typed name, never the reference label, and each one is metered with an `identity_*`
  purpose in the usage ledger.
- A proposal stands only when one independent site names the business (name match ≥ 0.75) *and* shows
  ownership evidence (≥ 50, verdict owned or probable). Two plausible sites, another town, another
  country, a conflicting name, or a page that appears to echo the reference label all come back as *needs
  a person*, and nothing is written.
- Google-hosted and encyclopaedia hits are excluded from the evidence, and no search title, snippet or
  ranking is stored: the evidence keeps hosts, scores and the name a site publishes.
- Acceptance re-parses the evidence, re-derives the reading and rebuilds the patch against the record as
  it stands, so a profile edited after the check, or a check older than seven days, is refused. Only the
  name, website, category and town a site supports are written; the Place ID is retained; the activity log
  records the site as the source.
- No migration is required. Provenance rides on the existing research-observation table and degrades to
  the activity entry when that table is absent.

Verification: `tests/unit/place-identity.test.ts` (19 tests) covers query planning, placeholder refusal,
conflicting/multi-site/other-town/empty readings, fill-versus-overwrite, staleness, drift, Google and
encyclopaedia exclusion, and acceptance (rename with the Place ID kept, activity, observation, repeat
acceptance, unreadable evidence and cross-record isolation). The search and the page reader are mocked
throughout; no live provider was called.

## Naming several references at once

Twenty references meant twenty dialogs, and a person could not see what a run would search for before it
spent anything. Selecting rows on the prospect list now offers **Identify N references**, which plans the
run first: which references are eligible, the name each check will search for, and whether the batch may
start at all. A reference label is not a business name, so a check without a typed name stays out.

- At most 20 records per batch, sent 4 per request with two requests in flight, and the browser drives the
  chunks: no single request carries a whole batch, and stopping leaves later chunks unstarted.
- Eligibility is re-derived on the server from the caller's own store in cloud mode (the reference must
  still be a Place-ID-only record owned by the caller's organization). The browser's copy of the profile is
  used only in demo mode, where there is no store to read.
- Every check runs the single-record path unchanged: the same bounded searches, the same guarded reader,
  the same `place-identity/1` evidence and the same acceptance rules. The run itself writes nothing; the
  readings it returns are approved together only through the reviewed batch described below.
- A blocked check (quota, budget, missing key or an unreadable search) halts the whole batch rather than
  spending on the rest, and the response says which one stopped it.
- Duplicate selections in the same run are dropped with a reason instead of searching twice.

Verification: `tests/unit/identity-batch.test.ts` and `tests/unit/identity-batch-preparation.test.ts`
(29 cases) cover eligibility and skip reasons, the 20-record ceiling, chunking and concurrency, the halt on
a blocked check, the ownership re-read, and the absence of any write. `tests/e2e/identity-batch.spec.ts`
names two references in one batch in demo mode and confirms the records are untouched afterwards.

## Approving several identities together

A finished batch used to end in twenty separate accept buttons. It now ends in a review table: the existing
prospect and Place ID, the proposed name, the independent site that publishes it, where on the page the name
was read, the verification state and confidence, the conflicts worth reading, and any prospect already using
the name. Each row carries three decisions — **Approve**, **Reject**, **Needs more evidence** — plus
**Select all N eligible** and **Deselect all**. Pressing a decision twice clears it, so nothing is approved by
a stray click.

Only an independently supported identity is eligible. A row is held back, with the reason shown in place of
a usable decision, when:

- the reading is ambiguous (more than one site could be the business, a foreign page, or another branch);
- the only source is Google or a social platform, which are references, not sources of record;
- the check is more than a week old (`identityIsStale`);
- renaming would duplicate another prospect (an `exact` or `likely` `findDuplicates` match);
- the record already carries the proposed details.

**Approve N identities** opens a confirmation step that lists exactly the records that will change, each with
its current name, its Place ID tail and the proposed name. Nothing is written before that confirmation, and
the batch never runs as a background job.

Each confirmed record then goes through the single-record acceptance path again, in order, through
`approveIdentityBatch` → `acceptPlaceIdentity`:

1. the record is re-read from the caller's own store, so a record from another organization is simply not
   found (and RLS applies in cloud mode);
2. its Place ID must still equal the one the person reviewed, or the update is refused as stale;
3. the evidence is re-parsed and re-judged (`acceptanceFor`), so staleness, a changed profile and an
   unreadable check are refused at write time, not only on screen;
4. duplicates are re-checked against the workspace as the previous approvals left it — a conflict blocks the
   record and never merges anything;
5. an approval that would change nothing returns **Already applied**: no second write, no second audit entry,
   so repeat approvals are idempotent;
6. the audit entry records the reviewer (`id` and label), `approvedVia: 'batch'`, `approvedAt`, the Place ID,
   the previous and new identity, the source site and URL, the published name, its evidence type, the
   confidence and the ownership score. Prospect ID, Place ID, research history and permissions are untouched.

A failure stops that record only: results are per record (**Approved**, **Already applied**, **Not applied**
with the reason), each with a link to the updated prospect, so a partial batch never loses the approvals that
landed.

Verification: `tests/unit/identity-approval.test.ts` (18 cases) covers the 20-row review, Google-only
rejection, conflicting evidence, stale checks, duplicate blocking (and a `possible` near-name not blocking),
the already-applied row, selection and deselection, a two-record approval with the full audit trail, the
Place ID guard, cross-workspace refusal, partial failure, idempotent re-approval and the 20-record ceiling.
`tests/e2e/identity-batch.spec.ts` approves two simulated references in demo mode through the review,
confirmation and per-record results, then opens the renamed prospect and finds its Place ID intact.

## Kit readiness, visual references and the pre-export review

A kit can always be downloaded, but an empty collection that looks like a finished pack wastes a
designer's time. **Resource kit readiness** at the top of the collector grades the evidence behind the
download and states what it would and would not contain:

- Four states, computed from export-eligible material only: *empty*, *research pending*, *partial* and
  *ready*. `ready` needs a verified identity, a readable observation and both an export-permitted logo
  and photograph, because that is the point at which a designer can work without inventing facts or
  images. A Place-ID-only reference stays at *research pending* however confident a Google match looked.
- Identity standing is *independently supported* (a source of record or a verified identity
  observation), *recorded, unconfirmed* or *reference only*; the last one links to **Identify this
  business** rather than implying the name is settled.
- Five visual groups are counted separately: Google Places previews (0 exportable by construction),
  social references (links only, none carrying contact details), independently licensed imagery,
  business-owned photographs and branding, and original concept imagery (always labelled illustrative).
  Withheld files are counted, not quietly dropped.
- The same `kitReadiness()` drives the screen, the pre-export dialog and `manifest.json` (`ready`,
  `readiness`, `visualReferences`, `documents`), so the card cannot promise a complete kit the file does
  not deliver. `DEVELOPMENT-BRIEF.md` gains a `Kit status:` and a `Carried material:` line, and the
  download button reads **Download incomplete kit** whenever the review is not complete.
- Every ZIP carries `visual-references.json` (`dof-visual-references/1`): permitted groups with their
  reuse rule, social profile links, the files actually carried, and an explicit
  `excluded: { googlePreviews: true, socialImages: true }` refusal. Only a Place ID is ever retained from
  Google; no preview, author credit or byte of Places content enters the sheet or the ZIP.

Verification on 31 October 2026, with Supabase and provider credentials blanked and no live call:

| Check | Result |
| --- | --- |
| TypeScript, ESLint | Passed; zero warnings |
| Complete unit/database suite | **1055 passed**, 66 files; PGlite only |
| `tests/unit/resource-readiness.test.ts` | 15 tests: identity standing (placeholder, restricted source, verified observation, revocation), inventory (withheld/unapproved/Google-origin files, licence gaps, link-only social references), all four readiness states, Studio handoff and the sheet's Google/social exclusion |
| Collector browser flows | Both website/no-website cases through the readiness card and the pre-export dialog; the review says *This download is incomplete* and the ZIP carries `visual-references.json` and `Kit status:` |
| Production build / client secret scan | Passed; 182 client files, five key formats, service-role tokens and three configured values, zero matches |

Evidence screenshots were regenerated from that run: [desktop without
website](evidence/resource-collector/desktop-no-website.jpg), [desktop
redesign](evidence/resource-collector/desktop-redesign.jpg). The phone evidence predates this card and
still shows the previous collector header.

## Visual Resource Intelligence audit (31 October 2026)

Read against the code and the tests, not the plan. Nothing below was rebuilt for this audit; no new media
store, provider or image pipeline was added.

| Requirement | Status | Where it lives |
| --- | --- | --- |
| Google photo previews, maximum six | Implemented | `providers/google-places.ts` maps `photos.slice(0, 6)`; each preview is a separate authorized `/api/resources` call with a validated provider photo name, rendered straight from `googleusercontent` with no Next image optimisation, no rehosting and no database row |
| Social-media visual references | Implemented, links only | `BusinessSocialSource` stores the canonical profile URL, platform, status and retention basis; `visualResourceInventory` counts them as `links` with `exportable: 0`, and no platform image is fetched or stored anywhere |
| Independent licensed imagery | Implemented | Vault kind `licensed_image` with licence name, reference, expiry, rights holder and attribution; excluded unless approved, export-permitted, unexpired and attributed |
| Business-owned photographs | Implemented | `product_photo`, `venue_photo`, `logo` and `brand_mark`, with the same export rules; supplying a file never implies publication or contact permission |
| Existing Asset Vault permissions | Implemented | Five separate permissions (inspect/store/prototype/export/publish) with `assetPermits`, `assetExportProblems` and `assetUsableInPrototype`; the collector uses the same vault component with `allowAuthorizedImport` |
| Approved exportable assets | Implemented | `assetExports` = no export problems; the kit carries only those, de-duplicated by SHA-256, and counts the rest as `excludedAssets`/`withheldFiles` |
| Visual-reference manifests | Implemented | `visual-references.json` (`dof-visual-references/1`) + `manifest.visualReferences` with `googlePreviewsExported: 0`, `socialImagesExported: 0`, per-group reuse rules and `withheld` counts |
| Resource Kit readiness indicators | Implemented | `kitReadiness()` drives the card, the pre-export review and `manifest.readiness`; `empty`, `research_pending`, `partial`, `ready` |
| Website Studio asset handoff | Implemented, one-way | The kit exports the project's authorized asset pack through `exportStudioAssetPack` and states `readiness.studio.ready`; Studio reads the vault, never the kit's research documents |

Known gaps, deliberately left for a separate milestone: no illustration or image-generation pipeline; no
visual similarity or duplicate-image detection; Studio does not import `visual-references.json` as a design
input (it reads the vault directly); and social imagery is never archived, by policy.

## Resource kit acceptance

| Question | Answer today |
| --- | --- |
| Is an empty kit identified? | Yes: `empty` (no export-permitted evidence), the card says so and the download button reads **Download incomplete kit** |
| Do partial kits explain what is missing? | Yes: `missing[]` (identity, logo, photography, services, website, phone, address, town) and `permissionGaps[]` (unapproved files, withheld entries, contact-bearing social references, missing licences, no vault) |
| Do ready kits hold approved, export-permitted material only? | Yes: `ready` requires a verified identity, an observation and both a logo and a photograph that pass `assetExportProblems` |
| Do manifests separate reference-only imagery from reusable assets? | Yes: `visual-references.json` carries each group's `reuse` (`preview_only`, `link_only`, `permitted`, `illustrative`), plus `excluded.googlePreviews` and `excluded.socialImages` |
| Are contact details without export permission excluded? | Yes: contact-channel observations, notes containing a number or email, and social sources whose handle or evidence is contact material are withheld, and the counts are in the manifest |
| Can Google listing content or unauthorized images enter an export? | No: Google previews are never export inputs, Google/social origins are rejected by `assetExportProblems` and `restrictedResourceUrl`, and only Place IDs are retained |

Implemented:

- **Collect Business Resources** on a prospect and inside its existing Studio concept opens
  `/prospects/:id/resources`. It does not require or run website generation.
- Google lookup starts from the retained Place ID, or one explicit three-choice search. Details
  request only the displayed fields; at most six photo references are offered. Each photo has its own
  explicit request, author credit (avatar, name, profile link) and Google Maps source link
  (`googleMapsUri`), and the viewer footer shows Google's official Google Maps logo. No map is embedded.
- The independently verified official homepage is read once, respecting robots.txt, socket-time
  public-address checks, redirects, time and size limits. It yields logo/favicon/image references,
  palette/type declarations, structured product/service candidates, contact and linked-social
  candidates. Candidates are deduplicated. Phone conflicts are flagged without overwriting data.
- Independent facts require a source, verification/permission evidence and explicit export rights.
  They can be revoked; corrections are new immutable entries. Migration 016 adds their org-scoped,
  audited ledger. **The migration is drafted and locally tested, not applied to Supabase.** Older
  databases can still view Google and use the existing vault; the ledger displays its prerequisite.
- Authorized files use the existing upload, private storage, validation, review and permission UI.
  The collector also offers a rights-attested original URL import: public PNG/JPEG/WebP/GIF only,
  8 MB maximum, with every redirect and robots response checked. Files stay candidates until a
  person approves them; imported files start with export/prototype permission unconfirmed.
- The **Website Resource Kit** reuses current Asset Pack eligibility and storage reads. It contains
  approved export-cleared files, independently verified/export-permitted entries in
  `business-resources.json`, a source/permission manifest, attribution, missing-resource checklist
  and `DEVELOPMENT-BRIEF.md`. Identical files are deduplicated by SHA-256. A kit with no eligible
  files still supplies the brief/checklist; it never invents missing materials. All five file
  permissions and their evidence are preserved. Revoked, expired, unapproved, export-denied and
  known Google/social-platform-origin files are excluded before file reads.

Live activation is intentionally off by default. Reuses `GOOGLE_PLACES_API_KEY`; set
`RESOURCE_GOOGLE_ENABLED=true` only in an authenticated cloud workspace after reviewing the account's
terms, billing and Cloud quotas. App quotas are 30 searches, 30 detail requests and 120
photo requests per workspace/24 hours, with the existing rate limits and optional workspace monetary
budgets. The paid-request ledger reserves each request before it is sent. Conservative default budget
estimates are $0.05/search, $0.05/detail and $0.01/photo; they are estimates, not a price quote or an
invoice. Configure current contracted costs and Google Cloud quotas; application checks do not replace
provider-side quotas. No automatic retry or polling. Five minutes is the viewer's cleanup deadline,
not a claimed Google caching allowance. Photo references are only used from the current response.

The local preview uses `SIMULATE_EXTERNAL_TOOLS=true`, blank Supabase/provider credentials and labelled
fictional fixtures. This simulation flag is ignored in cloud mode. Open
`http://127.0.0.1:3113/prospects`, select a prospect, then **Collect Business Resources**. Mock Place IDs
`fictional_place_no_website` and `fictional_place_with_website` exercise both listing states. No live
Google or owner website was called during implementation/testing.

Limits: the analyzer reads a homepage, not an entire site or authenticated platform. A website or
profile link is a candidate until independently checked; discoverability does not grant reuse rights.
Original URL import does not perform OAuth or bypass authentication. Owner-authorized integration
exports may be supplied through the existing upload path with their provenance/rights evidence.
Typography references do not grant font licences. Google content never becomes generation material
or a downloadable asset. Export permission does not grant publication or marketing consent.

Verification completed locally with no live provider calls:

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed; zero lint warnings |
| Complete unit/database suite | **880 passed**, 56 files; network blocked, PGlite only |
| Complete Playwright suite | **122 passed**, 94 desktop / 28 mobile; isolated output directory |
| Collector browser flows | Both website/no-website cases; uploads, authorized URL import, approval, ZIP contents, attribution, CSP, five-minute expiry and persistent-data exclusion |
| Responsive/accessibility | 360/390/768px overflow checks and axe WCAG 2/2.1 A/AA checks; no serious/critical findings at tested states |
| Production build / client secret scan | Passed; 178 client files, five key formats, service-role tokens and two configured values, zero matches |
| Policy/security | Independent-source DB constraints/RLS, immutability/revocation, source/redirect/robots/size guards, pre-storage platform refusal, fresh export eligibility and ZIP exclusions |

The full suite passed before two scoped review corrections: preserving logo/favicon roles during
deduplication, and making the no-website fixture genuinely omit its website field. The 16-test unit
file verifies both. The reviewed production build and focused five-case browser run also passed
after these corrections. Passing axe is not a
complete screen-reader audit or WCAG certification. Cloud RLS was exercised on local PGlite, not on the
production Supabase project. The live Google provider was exercised once at module level on 25 October
2026 (one Place Details request, HTTP 200, counts and attribution parsed, no listing content retained —
see [LIVE_GOOGLE_RESOURCE_TEST](LIVE_GOOGLE_RESOURCE_TEST.md)); the listing has **not** yet been shown
through the product's own UI, which needs cloud mode, and no authenticated owner integrations have been
exercised. [STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md) is the remaining step.


Evidence contains **mocked responses and original test assets**, not real Google listing photos:
[desktop without website](evidence/resource-collector/desktop-no-website.jpg),
[desktop redesign](evidence/resource-collector/desktop-redesign.jpg),
[phone without website](evidence/resource-collector/phone-no-website.jpg),
[phone redesign](evidence/resource-collector/phone-redesign.jpg).
The one-pixel PNG used to validate uploads/imports is a test file, not a business logo.
Machine-readable verification: [verification.json](evidence/resource-collector/verification.json).

The implementation commit is recorded after the final focused review. Nothing has been pushed,
deployed, applied to production or sent to customers. The original Adwoa creative gate remains pending;
no Quick Concept or other showcase redesign was started.

## Verification on 31 October 2026 (bulk identity approval and the visual audit)

Supabase and provider credentials blanked, `SIMULATE_EXTERNAL_TOOLS=true`, PGlite only, no paid call.

| Check | Result |
| --- | --- |
| TypeScript / ESLint | `TSC_EXIT=0`, `LINT_EXIT=0`; zero warnings |
| Complete unit/database suite | **1103 passed**, 69 files |
| `tests/unit/identity-approval.test.ts` | 18 tests: 20-row review, Google-only rejection, conflicting evidence, stale check, duplicate blocking (a `possible` near-name does not block), already-applied row, select/deselect, two-record approval, audit trail contents, Place ID guard, cross-workspace refusal, partial failure, idempotent re-approval, 20-record ceiling |
| `tests/unit/resource-readiness.test.ts` | 16 tests, including a new one: an original concept illustration is not counted as a photograph of the business |
| Production build / client secret scan | `BUILD_EXIT=0`; 183 client files, five key formats, service-role tokens, three configured values, zero matches |
| Complete Playwright suite | **134 passed, 2 flaky** in `adwoa-experience.spec.ts` (showcase scroll-mask timing and an axe contrast run under full-suite load); that spec passes **7/7** when run alone |
| `tests/e2e/identity-batch.spec.ts` | 2 passed: the read-only batch, and the review → confirmation → per-record results → renamed prospect with its Place ID intact |
| `tests/e2e/responsive.spec.ts` | Phone-width review: no horizontal overflow, labelled fields per row, decision buttons expose `aria-pressed`, Select all gates the confirmation and Deselect all disables it |

One small integration defect was found in the audit and fixed: `visualResourceInventory` counted original
concept illustrations towards `photography`, so a kit with a logo and an illustration could grade *ready*
while still listing Photography as missing. Only `product_photo`, `venue_photo` and `licensed_image` count
now, and the missing-resource rule uses the same definition. No media store, provider or image pipeline
was added.

## Visual asset acquisition (31 October 2026)

The previous release could describe image references but never produce an `assets/` folder for a
prospect whose kit was otherwise empty. This milestone adds the missing middle: discovery, a recorded
rights decision, a stored copy in the existing vault, an approval queue, and the same vault-driven ZIP.

Implemented:

- **Discovery is an address, not a copy.** `Find visual assets` records what the verified homepage
  published (label, type, credit line, why the source is relevant) and starts every row at
  `reference_only` / `not_established`. Nothing is fetched at this step. Google and social hosts are
  refused by the domain planner, the API routes and migration 020's check constraint.
- **Two source classes.** A file on the business's own registrable domain is `official_site` and may be
  authorized; a file the page links to on another host is `third_party_reference`, can never be
  downloaded, and can only enter the vault as an uploaded original supplied by its rights holder.
- **Rights are explicit and separate.** A person chooses a basis (own website, written permission,
  licensed stock), records evidence (≥15 characters), and confirms ownership for the website basis.
  Storage, prototype use, export and publication remain distinct: import sets inspect/store/prototype
  and grants export only when the operator says so. `publishPermission` is never granted by collection.
- **Duplicates are refused by SHA-256** against the whole vault and the candidate ledger, and by
  canonical image address against earlier discovery.
- **Approval queue with bulk selection.** Approving requires a stored candidate whose export permission
  is already recorded; anything else is skipped with the vault's own reason. Rejection rejects or
  revokes the stored file too, so it cannot re-enter a kit.
- **Category-aware requirements.** Hotel/guesthouse asks for logo, exterior, interior, room and staff
  photography; restaurants, retail, beauty, health, fitness and creative categories have their own
  lists. They appear in the panel and in `MISSING-RESOURCES.md`.
- **Kit output.** Approved, export-cleared files reach `assets/` through `exportStudioAssetPack` with
  manifest entries (path, kind, licence, attribution, five permissions, checksum). Reference-only
  candidates never appear, kits with only references still grade incomplete, and Studio reads the same
  vault, so nothing becomes a design asset before approval.
- **Transient previews only.** A same-origin `/api/resources/preview` route reads one image with
  `Cache-Control: no-store`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`, robots checks and
  the same 8 MB/type limits. It takes a recorded `candidateId` and reads the address from that row, so
  the browser cannot point it at another host; Google, social and third-party files are refused before
  any fetch. The download route resolves the same record, so the request never chooses what the server
  reads. Third-party references show no thumbnail at all.
- **The table enforces the attestation too.** `imported` requires a stored asset, checksum, origin, a
  real rights basis and ≥15 characters of evidence, so a direct write cannot skip the form; a trigger
  allows only reference-only → stored → rejected (or straight to rejected), freezes the stored file,
  checksum, origin and rights record once set, and refuses an asset from another prospect's vault.
- **Migration 020** (`visual_asset_candidates`, `visual_asset_candidate_events`) is drafted and tested on
  PGlite, **not applied to production**. Older databases keep working: the panel names the prerequisite
  and the existing vault and kit are unaffected.

Verification on 31 October 2026, credentials blanked, `SIMULATE_EXTERNAL_TOOLS=true`, PGlite only:

| Check | Result |
| --- | --- |
| TypeScript / ESLint | `TSC_EXIT=0`, `LINT_EXIT=0` |
| `tests/unit/visual-acquisition.test.ts` | 14 tests: classification, hotel requirements, discovery and duplicate reporting, off-site refusal, rights/ownership refusals, third-party upload path, duplicate bytes, redirect guard, bulk approval with skips, rejected file exclusion, request-without-copy, an orphan file taken back when the ledger write fails, and a kit with exactly the four authorized files in `assets/` |
| `tests/db/visual-acquisition.test.ts` | 10 tests: organization isolation, Google/social refusal, downloaded vs uploaded third-party rule, a direct write that skips the rights record refused, decisions that cannot reopen or swap the stored file, a cross-vault asset refused, no PUBLIC or service-role truncate/references privilege, immutable discovery fields, final rejection, append-only role-gated events, delete/truncate taken back, and a clean re-apply on a populated ledger |
| `tests/unit/visual-acquisition-routes.test.ts` | 10 tests: Google, social, off-site and `javascript:` previews refused, a candidate id and recorded website required, placeholder bytes with `nosniff` and same-origin policy, third-party and off-site downloads refused, rights statement and confirmation required |
| `tests/unit/visual-acquisition-source.test.ts` | 8 tests: the stored candidate decides the address (body and query-string addresses ignored), third-party/Google/off-site candidates refused before any fetch, decided candidates refused, other workspaces and other prospects' vaults refused, off-site redirects refused |
| `tests/e2e/visual-acquisition.spec.ts` | 2 passed: the full hotel fixture (6 candidates → 4 authorized → bulk approve → ZIP contains exactly 4 `assets/` paths and neither reference) and route-boundary refusals |
| `tests/e2e/visual-acquisition-responsive.spec.ts` | Passed at 360/390/768: discovery, one import, no horizontal overflow, no serious axe findings |
| Existing suite | No regressions; the pre-apply inspection script now covers 001–020 |

Known limits: thumbnails exist only for the business's own site (deliberately not for third parties);
there is still no image generation, visual-similarity or reverse-duplicate detection; and the live
Google/website providers were not exercised. Nothing was pushed, deployed, applied to production or
sent to a prospect.


