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
  the same `place-identity/1` evidence and the same acceptance rules. A batch writes nothing — acceptance
  stays one record at a time, and each reading is re-validated against the record as it stands.
- A blocked check (quota, budget, missing key or an unreadable search) halts the whole batch rather than
  spending on the rest, and the response says which one stopped it.
- Duplicate selections in the same run are dropped with a reason instead of searching twice.

Verification: `tests/unit/identity-batch.test.ts` and `tests/unit/identity-batch-preparation.test.ts`
(29 cases) cover eligibility and skip reasons, the 20-record ceiling, chunking and concurrency, the halt on
a blocked check, the ownership re-read, and the absence of any write. `tests/e2e/identity-batch.spec.ts`
names two references in one batch in demo mode and confirms the records are untouched afterwards.

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

## Verification

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
