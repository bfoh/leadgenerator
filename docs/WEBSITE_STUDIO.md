# The Lead-to-Website Studio

The Studio turns one researched prospect into one bespoke website: not a template with their logo in
the header, but an original piece of design built from evidence about the business, its assets and its
customers. This document is the authoritative specification for that work: the creative standard every
phase must meet, the six phases from brand intelligence to a secure client presentation, the permission
model for other people's property, the data that carries each phase into the next, and the limits the
Studio will not cross.

Milestone status is recorded in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md). Phase 1 is
implemented (milestone 3C.1, migration 012); phase 2 is implemented by milestone 3C.2 (migration 013);
phase 3 is implemented by milestone 3C.3 (migration 014), with its architecture, typography licensing,
token system, motion language and review framework specified in
[CREATIVE_DIRECTION.md](CREATIVE_DIRECTION.md); and phase 4 is implemented by milestone 3C.4
(migration 015) as a deterministic blueprint engine and trusted React renderer with a Studio preview and
three flagship demonstrations. Phases 5–6 are specified here and not built. Nothing in this document
authorises a deployment, a paid provider call or a production migration.

## 1. The creative standard

The output of this Studio is a piece of design a business is proud to publish and a designer is proud
to sign. That is a higher bar than "a website was produced", and it is the bar every phase is judged
against.

**Bespoke.** Every layout decision answers something specific about this business: its trade, its
street, its customers, the way it already speaks. If the same structure would serve a bakery in Accra
and a law firm in Kumasi, it is not bespoke yet.

**Premium and elegant.** Restraint over decoration. Generous space, deliberate hierarchy, one strong
idea carried through, typography treated as the primary material rather than a wrapper around
photographs. Nothing looks assembled from a theme.

**Cinematic.** Composition, pacing and motion are designed: a first frame that earns attention, a
sequence that guides a visitor to the next step, transitions that clarify rather than perform. Motion
is purposeful, respects `prefers-reduced-motion`, and never delays the content.

**Original.** Copy, art direction, illustration, iconography and interaction are made for this business
or licensed for it. The Studio does not imitate a named living designer's work, reproduce a competitor's
site, or generate a logo in the style of a real brand. Reference is research, not a stencil.

**Awwwards-caliber craft.** The standard is the work that wins design awards, not the average agency
deliverable: a clear concept, confident type, considered colour, real photography, correct spacing,
accessible contrast, fast pages, no broken state at any breakpoint. "It works" is the floor.

**Professionally researched typography and art direction.** Type is chosen from licensed families with
a documented pairing rationale — display and text roles, weights, optical sizes, language coverage for
the languages the site will publish in, and the licence that permits web embedding. Art direction is
written down before screens are drawn: a concept statement, a moodboard of *permitted* references, a
colour logic, a photography treatment and a motion language. Typography and imagery are never left to a
default UI library.

**Honest about what is ours.** Evidence about the business, the team's creative decisions and the
business's own property stay distinguishable everywhere, including in the file names and manifests the
client receives.


## 2. Operating principles

1. **Evidence before invention.** What the business's current site shows is recorded as evidence; what
   the site leaves out becomes a question for the business, never an assumption. The same rule applies
   to assets: a file exists in the Studio only because someone uploaded it or the business supplied it,
   with a recorded origin.
2. **Permission before use.** Storing a file, inspecting it, placing it in a private prototype, exporting
   it and publishing it are five separate permissions (section 4). The narrowest one governs.
3. **One concept per prospect.** A live concept is the working design for that business; an archived
   concept is history. A second concept starts only after the first is archived, so "which version did
   the client approve?" always has one answer.
4. **History is append-only.** Analysis runs, reviews, asset events, brand-kit versions, creative briefs,
   direction sets and their reviews are added, not edited. A correction is a new record. The approved
   brand kit and the approved concept are pointers, so the content a person signed off can always be
   reconstructed.
5. **Private by default.** Every file, reference and presentation lives behind the organization's
   membership and role checks. Nothing about a prospect is public until the business approves a
   presentation and, later, a publication.
6. **Human judgement is the gate.** No asset reaches a concept, and no concept reaches a client, without
   a named person approving it. Automation may prepare, never approve.
7. **Reversible where possible, audited always.** Archiving beats deleting; deleting requires the owner
   or admin role; every material change is written to the prospect timeline and the audit trail.

## 3. The six phases

Each phase has an input, an output and a gate. A phase may not start on unapproved material from the
phase before it, and the gate is a person, not a score.

### Phase 1 — Brand Intelligence (milestone 3C.1, implemented)

*Input:* one prospect and the address of the site it has today.

*What happens:* the homepage is read once through the guarded fetch (robots.txt respected, private
addresses refused, size and time limited). The reading becomes structure only: business name, contact
and selling routes, palette and font declarations, navigation, logo and photograph *references*,
platform signals, stale or placeholder content. Nothing is downloaded and no page text is reused.

*What is produced:* numbered analysis runs. Every entry is a **verified fact** (read from the page, with
its address), an **unknown** (the page is silent — ask the business), a **placeholder** (template,
parked or stale content), a **creative suggestion** (ours, never attributed to the page) or a
**restricted reference** (someone else's logo, photograph or copy). People confirm, reject with a reason,
or note entries. A page that cannot be read is recorded as unavailable, with the reason.

*Gate:* a person has reviewed the run and the open questions are known. The concept's brief has been
written. Evidence is never edited to fit a design idea.


### Phase 2 — Business Asset Vault and Brand Kit (milestone 3C.2, implemented)

*Input:* the reviewed intelligence, the business's own files, and whatever the client is entitled to
supply or license.

*What happens:* files enter a private per-concept vault with their provenance, licence and five
permissions. Candidates are inspected, annotated, approved, rejected, replaced or revoked. A separate
ledger records remote references (a Google Maps listing, an Instagram post, a competitor's photograph)
as *references only*: they are never fetched, imported or rendered. Approved assets are then selected
into a structured, versioned Brand Kit: logo variants, colour palette, typographic system with licence
information, photography collection, personality, visual direction and tone of voice.

*What is produced:* an approved asset set, an append-only approval history, a Brand Kit version approved
for creative work, and an exportable Asset Pack containing only export-authorized, unexpired, approved
files with a licensing manifest.

*Gate:* every asset used by later phases is approved and carries permission for the intended use. The
approved Brand Kit names its typography licences. No restricted reference has been promoted silently.

### Phase 3 — Creative Direction (milestone 3C.3, implemented)

*Input:* the approved Brand Kit, the reviewed evidence and the concept brief.

*What happens:* the Studio builds a versioned **Creative Direction Brief** and then proposes **exactly
three structurally different territories** — not one template with colour options. Every brief
assertion is labelled as a verified fact, business record, approved kit claim, approved file, creative
suggestion, Studio standard or client confirmation, with its evidence; gaps become questions. The
engine is deterministic and offline by default. Each territory is an argued position: a one-sentence
idea, narrative, audience and business rationale, typography with roles and licences, colour logic with
measured contrast, composition family, photography direction, a single motion direction with a
reduced-motion alternative, conversion path, responsive behaviour, trade-offs, risks and an advisory
twelve-dimension review. The three concepts must differ in composition, motion, typographic pairing and
colour ground. Typefaces come from an OFL catalogue; no font is downloaded or redistributed, and a
client's commercial licence is a confirmation requirement rather than an assumption.

*What is produced:* a brief a person confirms with a note, and an immutable direction version a senior
designer can defend in a client meeting, including the research behind each choice. The team can compare
the three concepts, record feedback, request changes, edit into a new version and approve one concept by
name. Approval is a human decision; scores are advisory.

*Gate:* a design lead signs one concept off against the creative standard. Typography licences are
confirmed for web embedding, including the languages the site will use. No direction relies on an
unlicensed image or an unapproved asset, and the latest brief must be confirmed before a direction is
generated or approved.

*Specification:* [CREATIVE_DIRECTION.md](CREATIVE_DIRECTION.md). The three flagship demonstrations are
indexed in [CREATIVE_DEMOS.md](CREATIVE_DEMOS.md).

### Phase 4 — Bespoke Design and Build (milestone 3C.4, implemented)

*Input:* one approved direction and concept, the approved Brand Kit version, and the files in the vault
that are cleared for **prototype** use.

*What happens:* a deterministic **website blueprint** is built from the direction. It binds the approved
concept to a page plan, navigation, sections, media plates, type bindings and the direction's design
tokens. The blueprint carries editorial content authored for this business, real content where it exists
and visibly marked unknowns or placeholders where the business still owes an answer. It is data, not
generated code: a trusted React renderer switches on the blueprint schema and renders the site. No HTML,
CSS, JavaScript or animation code is generated or evaluated.

The type layer resolves the recommended families against the self-hosted WOFF2 registry. A family with no
bundled file falls back to a documented stack of the same classification, and the blueprint keeps both the
requested family and the fallback warning visible. Media comes only from approved, unexpired assets with
prototype permission; an unresolved image becomes a labelled image-pending plate rather than a broken or
substituted photograph. Every action is structured as a page, an in-page anchor or a prototype notice, so
an external link, form submission or tracking request cannot be expressed.

*What is produced:* a live **Website prototype** tab inside the Studio with desktop and mobile framing, a
page selector, the exact blueprint's warnings and readiness, and immutable saved versions with a note.
The same engine renders three flagship demonstration sites at `/showcase`, from the same Creative
Direction demonstrations indexed in [CREATIVE_DEMOS.md](CREATIVE_DEMOS.md). The three sites are not a
separate template: they are three authored editorial plans over one builder and one renderer.

*Gate:* a current approval for the exact concept, a blueprint bound to that direction and Brand Kit, a
complete page plan with working internal navigation, prototype-cleared media, a visible concept-website
disclosure, and no serious accessibility violation at desktop and phone widths. The blueprint always
reports `publishReady: false`; prototype approval is not publication. The publish-permission gate remains
phase 6.

### Phase 5 — Review and Secure Client Presentation (milestone 3C.5, specified)

*Input:* a build ready for the client, and the client's named reviewers.

*What happens:* the concept is presented through a private, expiring link scoped to that client and that
concept. The presentation carries the direction rationale and the work itself, not the internal evidence
or the vault. Reviewers can comment on a page or a region and approve or request changes; every response
is attached to the version it was about. New rounds create new presentation versions, so feedback is
never orphaned by a rebuild.

*What is produced:* a presentation record with its audience, expiry, view log, comments and decisions,
and an approval that names a person and a version.

*Gate:* the business has approved a specific version. Approval expires with the link, and a later
change reopens review. No presentation is indexed by search engines, and no link survives revocation.


### Phase 6 — Handover, Publication and Stewardship (milestone 3C.6, specified)

*Input:* an approved build, an approved Asset Pack and the client's publication decision.

*What happens:* the approved build is exported or published to the client's domain (or managed hosting),
with the Asset Pack, the Brand Kit, a licence and attribution schedule, and a short operating guide.
Analytics and consent are configured according to the client's jurisdiction and wishes. Post-launch work
is tracked as care: checks, content updates, licence renewals and asset expiry.

*What is produced:* a published site, a handover pack, a publication record naming who approved what, and
a renewal calendar for expiring licences and assets.

*Gate:* publication is a distinct, explicit action by an owner or admin, after checking every asset's
publish permission, licence expiry and attribution requirement. A revoked or expired asset blocks
publication until it is replaced.

## 4. The asset permission model

### 4.1 Five permissions, one file

A single "approved" flag is not enough. An image may be fine to look at, fine to keep as research, and
not fine to publish. Every asset therefore carries five independent permissions, each `unknown`,
`granted`, `denied` or `not_required` (the last reserved for our own work and commissioned work whose
rights we hold outright):

| Permission | Question it answers | Honoured by |
| --- | --- | --- |
| `inspect` | May we open and study the file? | The vault preview and any future analysis |
| `store` | May we keep a copy in the vault? | Upload acceptance and retention |
| `prototype` | May we place it in a private, unapproved design? | Phase 4 builds |
| `export` | May we include it in an Asset Pack ZIP or handover? | Phase 2 export, phase 6 handover |
| `publish` | May it appear on the live site? | Phase 6 publication |

Rules the database enforces:

- `prototype`, `export` and `publish` cannot be `granted` while `store` is `denied`.
- An asset can be `approved` only with `approved_at` set (and the service requires a named reason and
  permission evidence). Approval requires `store` to be `granted` or `not_required`.
- `rejected` and `revoked` require a written reason; `revoked` also records when.
- A licence expiry date in the past blocks approval, and the export and publication filters re-check it
  at the moment of use. An approval does not outlive the licence.
- Attribution text is carried with the file into the pack manifest and the publication schedule.

### 4.2 What never enters the vault

Images found on Google Maps, a company website, a social profile or another agency's portfolio are
**not** assets. They are recorded in the separate reference ledger with their address, what they showed
and why they matter. The Studio does not fetch them, does not cache them, does not display them inline,
and does not offer "use this image" from them. Using one requires the business (or the rights holder) to
supply the file and record the permission — then it enters the vault as a new, provenance-bearing asset.

The application contains no crawler, scraper, harvester or "import from URL" path. Upload is the only
way bytes enter storage, and the upload route refuses anything that is not an allowed, validated file
type at an allowed size.

### 4.3 Provenance and licensing

Every asset records its origin (`our_work`, `client_supplied`, `licensed`, `commissioned`,
`third_party`), the rights holder, who supplied it, any source address, the licence name and reference,
the expiry date, attribution text, and the evidence behind the permission (an email reference, a signed
agreement, a marketplace order number). Replacing an asset creates a new row linked to the one it
supersedes; the old file and its history remain until a person deletes it. Revoking permission marks
the asset rather than erasing it, so anything that used it can be found and corrected.

Remote references have their own lifecycle: `recorded` or `declined`. They can never be approved,
exported or published, by construction.


## 5. Data and storage architecture

### 5.1 Tables (migrations 012–015, not applied to production)

| Table | Role | Mutability |
| --- | --- | --- |
| `studio_projects` | One live website concept per prospect; brief and last analysis outcome | Editable, audited |
| `studio_observations` | Evidence from one numbered analysis run, classified and with provenance | Append-only |
| `studio_reviews` | A person's confirm, reject or note about evidence | Append-only |
| `studio_assets` | One stored file: kind, status, provenance, licence, five permissions, checksum, private path | Editable, audited |
| `studio_asset_events` | Upload, annotation, approval, rejection, revocation, replacement | Append-only |
| `studio_asset_references` | Someone else's remote material, recorded but never imported | Editable status, never exportable |
| `studio_brand_kits` | One kit identity per concept | Editable, audited |
| `studio_brand_kit_versions` | Structured, immutable Brand Kit content (palette, type, assets, voice) | Append-only |
| `studio_brand_kit_approvals` | Names the version a person approved, and why | Append-only |
| `studio_creative_briefs` | Numbered Creative Direction Brief with provenance and open questions | Immutable |
| `studio_creative_brief_reviews` | A person's confirm, reject or note about a brief | Append-only |
| `studio_creative_directions` | Immutable sets of three structurally different concepts | Immutable |
| `studio_creative_direction_reviews` | Feedback, change request, approval and rejection, naming the concept | Append-only |
| `studio_website_prototypes` | A numbered website blueprint rendered from one approved concept; the exact document the renderer reads | Immutable |

The Brand Kit version content is validated in the database as well as in the service: it must be a JSON
object with the expected sections, and every asset id it references must belong to the same concept and
be approved. A version cannot be edited; an approval is a separate append-only row, so the content a
person approved can always be reconstructed, and an older version cannot be approved after a newer one.

Creative direction is held to the same standard. A brief's assertions must carry a known basis and the
evidence that basis requires; a direction must cite a confirmed latest brief, an approved Brand Kit
version, approved prototype-cleared assets of the same concept and observations of the same concept,
and its three concepts must have distinct keys, compositions, motions, pairings and colour grounds. An
approval is append-only and requires the latest confirmed brief; a later change request or rejection
revokes it, and a concept may be re-approved after the changes are addressed; an older direction cannot
be approved after a newer one.

Rendered prototypes are immutable and versioned within their project. The database refuses an update or
delete (except the cascade from deleting the concept), requires the next version number, requires the
latest review of the project to be an approval for the same direction and concept, and checks that the
blueprint names that direction, version, concept and project. The content constraint requires format
`dof-website-blueprint/1`, at least three pages, an asset list and disclosures, and
`publishReady: false`. RLS lets members read and the four Studio roles insert; nobody may rewrite history.

### 5.2 Private storage

Cloud mode uses one private Supabase Storage bucket, `studio-assets`, created by migration 013 with a
size limit and a MIME allowlist. Objects live under
`{organization_id}/{project_id}/{asset_id}/{name-hash}.{ext}`: the first path segment is the tenant, so
a storage policy can authorise every read, write and delete against the same membership and role rules
as the tables. The bucket is not public; the browser receives short-lived signed URLs for previews and
uses its authenticated session to read bytes for an approved export.

Demo mode uses a browser storage adapter with the same interface (IndexedDB, falling back to memory
when unavailable). Files never leave the browser, the metadata rules are identical, and the UI says
plainly that demo files are local to that browser.

Every upload is validated before it is stored: byte length, declared type against sniffed magic bytes,
a MIME allowlist (PNG, JPEG, WebP, GIF, PDF, plain text, MP4, WOFF/WOFF2/TTF/OTF), image dimension
limits, a SHA-256 checksum and a generated private path. SVG and HTML are refused: they can carry script.
A file whose name says `.png` but whose bytes say something else is refused, and the mismatch is
reported in words.

### 5.3 What is logged

Uploading, annotating, approving, rejecting, revoking, replacing and deleting an asset each write a row
in `studio_asset_events` and an entry on the prospect's timeline. The asset table also participates in
the workspace audit trail, so a changed permission or licence can be traced to a person and a time.
Exports are logged with the number of files and the manifest hash, never with the file contents.
Creative direction logs each brief version, confirmation, proposed direction, revision and review on the
prospect timeline, with version and concept ids rather than the full document. Saving a rendered prototype
logs its version, direction version and concept key — never the blueprint body.

Prototype previews are internal and author-less: opening a page is a read of the blueprint held in the
Studio tab, not a client presentation, so it creates no shareable link and no view log. Presentation and
its audit trail belong to phase 5.

### 5.4 The blueprint and the renderer

`dof-website-blueprint/1` is the whole document. It contains the business identity, the Studio project,
the exact direction version and concept, the Brand Kit version, the design tokens, the resolved type
bindings, at least three pages with sections and navigation, the media plates that cite approved asset
ids, the mandatory disclosures and a readiness record. The same inputs always produce the same
blueprint; the builder has no clock, network or model call.

`blueprintProblems` re-checks the document before it is previewed or saved: unique page slugs, a home
page, working internal navigation and anchors, no duplicate or missing asset, every referenced plate
traceable to an approved, unexpired prototype asset, a visible “Concept Website — Not an Official
Business Website” disclosure, a documented fallback for any unbundled face, and `publishReady` strictly
false. A saved version is parsed through the same Zod schema when it is opened.

The renderer is a small set of React components in `src/components/website/`. It chooses a layout from the
composition family, then switches on each section kind and variant. It never uses
`dangerouslySetInnerHTML`, never accepts a URL from the blueprint, and never fetches a remote resource.
Actions resolve to an internal page, an in-page anchor or a prototype notice; the enquiry, booking and
brief buttons open a labelled `<dialog>` instead of a form. Images are passed separately from the
blueprint as file sources, so a saved version never stores a signed URL. Motion is CSS keyed to the
direction's specification and disabled under `prefers-reduced-motion`; the header menu traps focus, closes
on Escape and returns focus to its button.


## 6. Quality gates

A concept may not move to the next phase until the gate for the current one is met and recorded.

| Phase | Gate | Evidence |
| --- | --- | --- |
| 1 Brand intelligence | Evidence reviewed; unknowns listed for the business | Reviews on the run; brief written |
| 2 Vault and Brand Kit | Every usable asset approved with permission and licence; kit version approved | Asset events; approved kit version |
| 3 Creative direction | Direction signed off against the creative standard; type licences confirmed | Confirmed brief; approved concept with rationale; licence and contrast evidence |
| 4 Design and build | Approved concept; preview-ready blueprint; accessibility; prototype-only media | Approved direction; saved prototype version; axe results; asset audit |
| 5 Client presentation | Client approved a named version through a private link | Presentation decision record |
| 6 Handover and publication | Every asset publishable or replaced; attribution and expiry scheduled | Publication record; manifest |

The design review in phase 4 asks, in this order:

1. **Concept** — can the idea be stated in one sentence, and does every page serve it?
2. **Originality** — is anything here a copy of a named designer's or competitor's work?
3. **Typography** — is the pairing argued, licensed for web and complete for the languages used?
4. **Composition** — hierarchy, rhythm and spacing at 360 px, 768 px and 1440 px.
5. **Art direction** — are the images approved, art-directed and credited as required?
6. **Motion** — does it clarify, and does the site still work with motion reduced?
7. **Accessibility** — contrast, focus, keyboard order, labels, headings, alt text, no serious axe
   violations.
8. **Performance** — image weight, fonts, layout stability and interaction latency within budget.
9. **Content honesty** — placeholders visibly marked, no invented claim about the business.
10. **Handover** — could the client's team run this site without us?

## 7. Roles

| Role | Studio rights |
| --- | --- |
| Owner, admin | Everything, including deleting concepts, assets and references |
| Researcher, sales | Create and analyse concepts, upload and review assets, build and approve Brand Kit versions, record references, export approved packs, preview and save rendered prototype versions |
| Developer | Reads the Studio and every rendered prototype; cannot save a prototype version in this milestone |
| Viewer | Reads concepts, evidence, assets and kits; cannot change or export |

RLS in the database is authoritative. The UI mirrors it with `studio.write`, `records.delete` and
`data.export` capabilities and hides controls the role cannot use.

## 8. Limits the Studio keeps

- No downloading or re-hosting of third-party images, including from Google Maps, company websites or
  social media. No scraping, crawling or harvesting beyond the single guarded homepage reading in
  phase 1.
- No proprietary or commercially licensed font is downloaded, bundled or redistributed. Six SIL OFL 1.1
  families ship with their licence text for the renderer; a catalogue family without a bundled file
  resolves to a documented same-classification fallback, and the blueprint records the gap. A client's
  own commercial licence remains a confirmation requirement, not an assumption.
- No AI-generated imitation of a living designer's work or a real brand's identity, and no generated
  logo presented as the client's existing mark.
- No arbitrary generated CSS, HTML or animation code. The engine produces a validated blueprint, design
  tokens and a motion specification; one trusted renderer implements them, with reduced motion.
- No paid model call in creative direction by default. The optional enhancement boundary is disabled
  until explicitly configured and authorised, and remains uncalled.
- No publishing, exporting or presenting an asset without the specific permission for that use, a
  current licence and an approval by a named person.
- No silent promotion of a reference into an asset; the only route is a new upload with provenance.
- No public client link that outlives its review, and no presentation that exposes internal evidence,
  notes or other prospects.
- No production migration, deployment or paid provider call as part of building these phases.

## 9. Where each phase lives

| Phase | Code | Migration |
| --- | --- | --- |
| 1 | `src/lib/domain/studio.ts`, `src/lib/data/studio-services.ts`, `src/components/studio/*` | 012 |
| 2 | `src/lib/domain/studio-assets.ts`, `src/lib/data/studio-asset-services.ts`, `src/lib/data/asset-storage.ts`, `src/components/studio/asset-vault.tsx`, `brand-kit.tsx` | 013 |
| 3 | `src/lib/domain/creative-direction.ts`, `font-catalogue.ts`, `design-tokens.ts`, `src/lib/data/creative-direction-services.ts`, `src/components/studio/creative-*.tsx` | 014 |
| 4 | `src/lib/domain/website-blueprint.ts`, `website-compositions.ts`, `website-editorial.ts`, `showcase-sites.ts`, `bundled-fonts.ts`, `src/lib/data/website-prototype-services.ts`, `src/components/website/*`, `src/components/studio/website-preview.tsx`, `src/app/showcase/*` | 015 |
| 5–6 | Not built | — |

The roadmap entry for each milestone records what was built, what was tested and what remains. When a
later phase changes a rule in this document, the document changes with it: this is the specification the
implementation is measured against, not a description written after the fact.

