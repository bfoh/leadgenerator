# The Creative Director Engine

This document is the authoritative specification for phase 3 of the Lead-to-Website Studio — the
Creative Direction Brief, the typography research, the design-token system, the three-concept engine,
the motion language and the review that a person signs off — and now records how phase 4 consumes those
decisions. It sits beside [WEBSITE_STUDIO.md](WEBSITE_STUDIO.md), which holds the creative standard and
the six phases; when a rule here changes, the Studio specification and this document change together.

Milestone 3C.3 is implemented and tested locally against migration **014**. Milestone 3C.4 adds the
deterministic blueprint engine, the trusted renderer, the Studio preview and three flagship websites
against migration **015**. Neither migration is **applied** to production. Nothing here authorises a
deployment, a paid model call or a production migration.

## 1. Why a Creative Director, and what it must not become

A brand kit is a set of ingredients. It is not an idea. The failure mode of AI-assisted design is a
page that looks composed — generous spacing, a serif, a muted palette — while saying nothing about the
business and rearranging the same three cards for every client. The Creative Director exists to prevent
that, not to accelerate it.

Four rules decide whether a direction is acceptable:

1. **A concept is an argument, not a theme.** It must be statable in one sentence and the sentence must
   be about this business. "Quiet luxury" is not an argument; "a commission begins with a conversation
   about cloth" is.
2. **Three concepts must be structurally different.** Composition, typography, colour system, imagery,
   motion and conversion path all change. A colourway is not a concept.
3. **Nothing about the business is invented.** Verified facts cite observations; approved kit content
   cites its version; everything else is labelled a suggestion or a question.
4. **A person decides.** Scores are advisory. Approval names the person, the direction version and the
   concept, and a later change request revokes it.

The engine is deterministic and offline by default. It produces the same three concepts for the same
brief and kit, which is what makes review, versioning and evidence possible.

## 2. Architecture

```
approved Brand Kit ─┐
reviewed evidence ──┼─► buildCreativeBrief ─► brief version (immutable) ─► confirmation ─┐
prospect record ────┘                                                                     │
                                                                                          ▼
audited assets ─────────────────────────────────────────────► generateCreativeDirection ─────┐
                                                                                             │
                                    three concepts + comparison + advisory review            │
                                                                                             ▼
                                                        direction version (immutable) ─► human review
                                                                                             │
                                                     feedback / edit as new version / approval
```

| Layer | Code | Responsibility |
| --- | --- | --- |
| Domain | `src/lib/domain/creative-direction.ts` | Brief model, provenance rules, territory library, deterministic generation, edits, review, validation |
| Domain | `src/lib/domain/font-catalogue.ts` | Licensed typeface catalogue, pairing recommendations, fallback stacks, catalogue integrity |
| Domain | `src/lib/domain/design-tokens.ts` | WCAG contrast maths, type scales, spacing, grids, composition families, motion specifications |
| Data | `src/lib/data/creative-direction-services.ts` | Shared service gates for demo and cloud mode; activity log |
| Data | `src/lib/data/store.ts`, `local-store.ts`, `supabase-store.ts` | Append-only persistence contract and both adapters |
| Database | `supabase/migrations/014_studio_creative_direction.sql` | Tables, immutability, provenance and asset triggers, RLS, grants |
| Domain (3C.4) | `src/lib/domain/website-blueprint.ts`, `website-compositions.ts`, `website-editorial.ts`, `bundled-fonts.ts` | Blueprint schema and checks, deterministic build, authored page plans, self-hosted type registry |
| Data (3C.4) | `src/lib/data/website-prototype-services.ts`, `supabase/migrations/015_studio_website_prototypes.sql` | Save gate, immutable versions, database guard and RLS |
| Renderer (3C.4) | `src/components/website/*`, `src/app/showcase/*`, `src/components/studio/website-preview.tsx` | Trusted React renderer, Studio preview, three flagship sites |
| UI | `src/components/studio/creative-*.tsx` | Brief review, typography and colour specimens, comparison, board, feedback, edit, approval |
| Demo generator | `src/lib/domain/creative-demos.ts`, `scripts/generate-creative-demos.mjs` | Three flagship businesses, rendered by the real engine |

The optional AI enhancement boundary lives in `src/lib/server/providers/creative.ts`. It is disabled by
default, refuses to run without an explicit flag and a configured key, and is not called by any route or
service. It may only return the same `CreativeDirectionContent` structure — never animation code, HTML
or arbitrary CSS. The deterministic engine remains the source of truth.

## 3. The Creative Direction Brief

A brief is a versioned document, not a form. It records fourteen sections:

business identity · audience · personality and positioning · design objectives and conversion ·
emotional atmosphere · visual storytelling · art direction · layout principles · typography research ·
colour strategy · photography and media · motion and interaction · mobile considerations ·
accessibility constraints.

Every assertion in every section carries a **basis** and its **evidence**:

| Basis | Meaning | Evidence required |
| --- | --- | --- |
| `verified_fact` | Read from the business's own page | At least one observation id |
| `business_record` | Recorded in the workspace | The dotted field name, e.g. `business.city` |
| `approved_brand_kit` | Approved by a person in a kit version | The kit version (or an approved asset) |
| `approved_asset` | A file approved in the vault | The asset id |
| `creative_suggestion` | The Studio's proposal | None, by definition; never presented as fact |
| `studio_standard` | A constraint the Studio holds itself to | The standard, e.g. WCAG 2.2 AA |
| `client_confirmation` | The business must answer | The question |

A brief also carries **missing information** (each item marked blocking or not) and **client
confirmations** (required or recommended). A page that never states its prices produces a question, not
a guessed price. No observation is rewritten to fit a design idea.

### 3.1 Versioning and confirmation

- Briefs are immutable and numbered; editing creates version *n+1* with a note.
- Only the latest brief can be confirmed. A confirmation names the person, the time and the reason.
- A new version invalidates direction generation until it is confirmed again.
- Confirmation is refused while a blocking licence or kit gap remains. Open questions about the
  business may remain, because they are explicitly recorded as questions.
- Provenance counts (verified, kit, assets, suggestions, confirmations, standards) are recomputed and
  must match the assertions.

## 4. Three concepts, genuinely different

Each direction set contains exactly three concepts and is immutable. The engine guarantees, and the
database trigger re-checks:

- three distinct concept keys;
- three **composition families** (from six);
- three **motion directions** (from seven);
- three distinct **display/body pairings**, drawn from the licensed catalogue and the business's
  character;
- three distinct **background colours**, with the approved accent respected;
- a recommendation that names one of the three, explicitly advisory;
- a comparison table covering creative idea, typography, colour, composition, imagery, motion,
  conversion and responsive treatment;
- trade-offs, risks and a twelve-dimension review for each concept.

### 4.1 The territory library

Nine argued positions exist. Selection is deterministic: sector affinity and the approved personality
lead, a stable seed rotates ties, and composition and motion must be unique across the set.

| Territory | Composition | Motion | Idea | Trade-off it accepts |
| --- | --- | --- | --- | --- |
| The Working Archive | Editorial columns | Editorial transition | The business as documented work, with material notes | Exposes thin content; slower to scan |
| First Light | Cinematic full bleed | Cinematic sequence | Arrival as the first ten seconds | Depends on excellent photography |
| Off-Axis | Asymmetric offset | Subtle parallax | Deliberate imbalance resolved by an edge | Needs concise copy; harder responsively |
| The Index | Catalogue index | Hover choreography | A complete, numbered range | Needs a genuinely complete catalogue |
| A Quiet Room | Quiet centred | Refined reveal | One idea per screen, restraint as confidence | Fewer promotional slots |
| The Plan | Modular blocks | Responsive navigation | The practice shows its working | Can feel institutional |
| After Hours | Cinematic full bleed | Image mask | The place after dark | Dark palettes are harder to keep accessible |
| Field Notes | Editorial columns | Image mask | Annotated, dated observations | Needs ongoing content |
| Type First | Asymmetric offset | Hover choreography | The argument, set with conviction | Depends entirely on the writing |

The same trade could still choose different triads because the seed includes the concept and brief
version; the catalogue never reduces to "the fashionable pairing plus a colour swap".

### 4.2 Edits

A person may edit a concept's name, one-sentence idea, display and body typefaces and primary action.
Saving creates a new direction version derived from the old one, re-scores all three concepts and
recomputes the comparison. The original version and any approval on it remain as history. The brief and
asset references are not altered by an edit.

## 5. Typography research and licensing

Typography is treated as the primary material, so the catalogue is a piece of research rather than a
list of Google Fonts. `src/lib/domain/font-catalogue.ts` records, for every family:

- family, classification (old-style / transitional / modern serif, grotesque / humanist / geometric
  sans, monospace, naskh) and foundry;
- the authoritative source and licence URLs;
- the licence (all **SIL Open Font License 1.1**, which permits embedding, self-hosting and
  modification with the Reserved Font Name rule);
- supported scripts and languages, including a flag for documented coverage of Ghanaian orthographies
  (ɛ, ɔ and the extended Latin used by Twi, Ewe, Ga and Dagbani);
- available weights and styles, and whether it is variable;
- display/body/interface/monospace roles;
- personality words, documented pairings and legibility notes;
- loading guidance: WOFF2/WOFF, subsets and an approximate payload.

Rules the Studio enforces:

1. **No commercial font enters the catalogue.** If a client supplies a commercial family, the brief
   records its licence as a confirmation requirement; the Studio will not download, bundle or
   redistribute it.
2. **No font file is downloaded by the Studio.** The UI renders a specimen in the fallback stack and
   says so. Phase 4 self-hosts the files under their licences.
3. **A pairing is argued.** Recommendations score personality overlap, a documented pairing and a
   deliberate serif/sans contrast; ties rotate on a stable seed so the catalogue is explored. Every
   concept records display and body licences and a complete fallback stack.
4. **Language coverage is a gate.** If the site publishes a Ghanaian language, both families must
   document orthography coverage; Andika, Charis SIL, Gentium Book Plus and Noto Sans are the
   catalogue's inclusive choices.
5. **The scale is deliberate.** A modular ratio (1.2–1.618, chosen for the sector and territory), fluid
   between 360px and 1440px, with per-step line height and tracking and a body minimum of 16px.

## 6. Colour, composition and design tokens

`src/lib/domain/design-tokens.ts` turns a direction into values a renderer can consume.

### 6.1 Colour

- Eight roles: ground, surface, ink, secondary ink, accent, text on accent, rule and support.
- WCAG 2.x relative luminance and contrast ratio are computed in code. Ink and secondary ink are moved
  towards black or white until they reach 4.5:1; the support tone is adjusted to 3:1; text on the accent
  is the better of near-black or near-white.
- A palette that fails a measured pair cannot be approved. The accent is the approved kit accent; a
  direction may change the ground, the support tone and the proportion of accent, not the brand accent.
- The system deliberately avoids multiple accents, decorative gradients and coloured cards.

### 6.2 Composition

Six composition families, each with its own grid, navigation, hero idea, image treatment, spacing
rhythm and materials:

| Family | Grid | Character |
| --- | --- | --- |
| Editorial columns | 12 columns, 7/5 split | Printed spread, marginal notes, interrupting images |
| Cinematic full bleed | Six-column overlay | Scenes, full-width media, title-sequence type |
| Asymmetric offset | 12 columns, 7/5 plus offset | Tension resolved by an edge |
| Catalogue index | Dense 12 columns | Numbered entries, tabular metadata |
| Quiet centred | Eight-column centred measure | One idea per screen, generous space |
| Modular blocks | 12 columns sharing 1px rules | Unequal spans, document logic, no card shadows |

Spacing is a 4px base with a restrained scale and a stated section rhythm. Breakpoints are 360, 480,
768, 1024, 1280 and 1440px; mobile behaviour is written per composition, not left to CSS chance.

### 6.3 Renderer contract

Each concept carries a complete token bundle: palette with contrast checks, type system with steps and
`clamp()` expressions, spacing, grid, motion and radius/border notes. `tokensAsCssVariables` emits the
custom properties the renderer consumes (`--colour-*`, `--type-*`, `--grid-*`, `--motion-*`). The
Studio does not generate arbitrary CSS or animation code; it generates data.

Milestone 3C.4 implemented this contract in `src/components/website/`. The renderer receives a validated
blueprint (not the direction directly), maps the token bundle onto CSS custom properties, chooses the
composition family's layout and switches on each section kind and variant. Type is resolved through the
self-hosted registry in `src/lib/domain/bundled-fonts.ts`: a bundled family uses its WOFF2 file, and an
unbundled catalogue family resolves to a documented fallback stack of the same classification, with both
the requested family and a warning retained in the blueprint. Motion uses CSS transitions and animation
inside the specification's properties and durations, and is removed under
`prefers-reduced-motion: reduce`. See [WEBSITE_STUDIO.md](WEBSITE_STUDIO.md) §3 phase 4 and §5.4.

## 7. Motion language

Motion is a specification, not a script. Seven directions are defined with duration, easing, distance,
stagger, allowed properties, a reduced-motion alternative and performance constraints:

| Direction | Duration | Properties | Reduced-motion alternative |
| --- | --- | --- | --- |
| Refined reveal | 420ms | opacity, transform | Content visible at rest, no scroll listener |
| Editorial transition | 520ms | opacity, transform | Direct swap; focus moves to the new heading |
| Image mask | 640ms | clip-path, opacity | Final crop shown immediately |
| Cinematic sequence | 900ms | opacity, transform | Static stacked gallery with captions |
| Subtle parallax | scroll-linked | transform | Image fixed in its frame |
| Hover choreography | 220ms | opacity, transform | Colour and underline only |
| Responsive navigation | 300ms | opacity, transform | Drawer opens instantly; focus managed |

Every concept names one direction, never several. Only opacity, transform and clip-path may be
animated; no height, width, top or left; no duration beyond 900ms; no scroll hijacking; no autoplay with
sound; no hover-only information. The renderer must implement `prefers-reduced-motion`, visible focus,
Escape-to-close and focus return for the navigation drawer.

## 8. Creative quality review

Twelve dimensions are scored for each concept, each with a note and its evidence:

originality · brand appropriateness · typography · composition · colour sophistication · asset
consistency · cinematic storytelling · motion appropriateness · mobile design · accessibility ·
performance · business relevance.

The scores are deterministic heuristics — distinct compositions, licence completeness, measured
contrast, evidence count, font payload, reduced-motion coverage and so on. They exist to structure a
review. They are **advisory**, are labelled as such everywhere they appear, and never gate approval on
a numeric threshold. The advisory text states plainly that they are not an objective measure and not a
guarantee of awards or commercial results. A named person approves the concept.

## 9. The Studio workflow

Inside a concept, the **Creative direction** tab provides:

1. **Build the brief** once an approved Brand Kit exists. The brief renders every section with basis
   badges, evidence lines, typography and colour specimens, missing questions and client confirmations.
2. **Confirm the brief** with a note. Earlier versions remain selectable from the version picker.
3. **Adjust preferences** — personality, positioning, audience, atmosphere, objectives, things to
   avoid — saved as a new brief version that must be confirmed again.
4. **Propose three directions**, enabled only when the latest brief is confirmed and the kit is
   approved.
5. **Compare** the three concepts in a structural table, read the advisory recommendation, and open a
   composition board for any concept. The board is explicitly a study, not a website.
6. **Review** a concept with feedback, a change request or a rejection. Change requests and rejections
   revoke an approval; feedback does not.
7. **Edit** a concept into a new immutable direction version, with a note.
8. **Approve** a concept with a note naming the person and version. The latest approval is shown, and
   `approvedCreativeDirection` returns the direction and concept phase 4 consumes.
9. **Open the Website prototype tab** to build the blueprint from the approved concept and current Brand
   Kit, review it at desktop and phone widths, select any page, compare a saved version with the current
   draft, and save an immutable version with a note. Nothing is published.

Directions and briefs are never edited in place. Older versions and their reviews remain readable. A
brief change invalidates approval of directions built from the old brief; approving or editing against
a stale brief is refused.

## 10. Database, security and migration 014

Migration 014 adds four tables:

| Table | Role | Mutability |
| --- | --- | --- |
| `studio_creative_briefs` | Numbered brief content with provenance | Immutable |
| `studio_creative_brief_reviews` | Confirm, reject, note | Append-only |
| `studio_creative_directions` | Three-concept direction sets | Immutable |
| `studio_creative_direction_reviews` | Feedback, change request, approval, rejection | Append-only |

Database guards enforce what the service enforces:

- brief assertions must use a known basis; verified facts must cite an observation; business records
  must name a field; approved kit/asset claims must name their version or file;
- brief and direction versions must be the next number, with no gaps;
- a direction requires a confirmed latest brief and a Brand Kit version that has an approval row;
- the three concepts must have distinct keys, composition families, motion directions, typographic
  pairings and background colours;
- every cited asset must be approved, unexpired and cleared for prototype use in the same concept;
  every cited observation must belong to the same concept;
- a direction needs at least four stated limitations and a recommendation naming one concept;
- an approval requires the latest confirmed brief, is append-only, and refuses an older direction after
  a newer one; a later change request or rejection revokes it, and a concept may be re-approved after
  the requested changes are addressed;
- updates and deletes on history are refused at the trigger and privilege level.

RLS: members read; owners, admins, researchers and sales insert; no client role may update or delete
history. Service-role access is for cascade/administration, and the triggers still apply. Deletion of a
concept cascades to its briefs, directions and reviews.

Security boundaries: the engine never fetches a remote image, never executes generated code, never
downloads a font, and never sends brief or kit content to a model. The optional enhancer is disabled
and uncalled. Migration 014 is **not applied** to production; its rollback is
`supabase/rollback/014_studio_creative_direction_down.sql`.

## 11. Rendered prototypes (milestone 3C.4, migration 015)

Phase 4 turns an approved concept into a website blueprint and a rendered prototype.

- **Deterministic blueprint:** `src/lib/domain/website-blueprint.ts` defines
  `dof-website-blueprint/1`; `buildWebsiteBlueprint` in `website-compositions.ts` produces it from an
  approved direction, concept, Brand Kit version and approved media. The builder has no clock, network or
  model call, and makes no generated-code decision.
- **The document:** identity, Studio project, direction and concept binding, Brand Kit binding, design
  tokens, resolved type bindings, at least three pages with sections and navigation, media plates that
  cite asset ids, mandatory disclosures and a readiness record. `publishReady` is always `false`.
- **Structured actions:** page, in-page anchor or prototype notice only. The renderer cannot follow an
  external URL from a blueprint, submit a form, run analytics or take a payment.
- **Trusted renderer:** `src/components/website/` renders with React and CSS modules, switches on section
  kinds and composition families, honours reduced motion, and implements a focus-trapped, Escape-closing
  navigation drawer with focus return.
- **Self-hosted type:** `src/lib/domain/bundled-fonts.ts` registers six SIL OFL 1.1 families with their
  exact WOFF2 files and licence text under `public/showcase/fonts/`. A catalogue family without a file is
  not silently substituted: the blueprint records the requested family and the documented fallback.
- **Save gate:** `saveWebsitePrototype` requires a current approval for the exact direction and concept,
  the approved current Brand Kit version, an unarchived project, the same brief version, only approved,
  unexpired prototype media, a valid and preview-ready blueprint, and no existing schema mismatch. It
  writes the next immutable version and a timeline entry.
- **Database:** migration 015 adds `studio_website_prototypes`. The guard refuses update and delete,
  requires the next version number, requires the latest project review to be an approval for the same
  direction and concept, and checks the direction, concept and project bindings in the JSON. The content
  check requires the format, at least three pages, assets, disclosures and `publishReady: false`. RLS:
  members read; owners, admins, researchers and sales insert.
- **Studio preview:** the **Website prototype** tab generates the draft from the current approved
  direction, offers page selection, desktop and mobile framing, readiness and warnings, saved versions
  and a draft-versus-version comparison. It is internal and creates no public link.
- **Migration status:** 015 is **not applied** to production. Its rollback is
  `supabase/rollback/015_studio_website_prototypes_down.sql`; it is tested on PGlite only.

The three flagship demonstrations are now rendered websites built by this same engine:
[Nsroma Atelier](creative-demos/nsroma-atelier.md) in editorial columns,
[Adwoa's House](creative-demos/adwoas-house.md) in cinematic full bleed, and
[Bantama Design Office](creative-demos/bantama-design-office.md) in asymmetric offset. They are reached
at `/showcase`, not through a separate renderer.

## 12. Flagship demonstrations and the next phase

Three fictional businesses demonstrate the engine end to end, with synthetic evidence, synthetic
approved assets and an approved Brand Kit. Since 3C.4 each also renders a complete, navigable concept
website at `/showcase`, built by the same blueprint engine and renderer as the Studio:

| Business | Sector | Concepts |
| --- | --- | --- |
| [Nsroma Atelier](creative-demos/nsroma-atelier.md) | Fashion and tailoring, Accra | The Cutting Archive · The Pattern Index · The Evening Cut |
| [Adwoa's House](creative-demos/adwoas-house.md) | Boutique hotel and resort, Cape Coast | A Quiet Room · First Light · Notes from the House |
| [Bantama Design Office](creative-demos/bantama-design-office.md) | Architecture and interior design, Kumasi | The Index · Drawn Off-Axis · Working Drawings |

Each document contains the full brief, the comparison, three concepts with typography, palette,
contrast, composition, imagery, motion, conversion, trade-offs and the advisory review, plus the JSON
payload. Regenerate with:

```bash
npm run demo:creative
```

The generator loads the real domain module and writes `docs/creative-demos/`. No photograph, font or
page is fetched. See [CREATIVE_DEMOS.md](CREATIVE_DEMOS.md) for the index.

### From 3C.4 to phase 5

Delivered in 3C.4:

1. A confirmed brief and an approved concept from `approvedCreativeDirection` for the project.
2. The approved Brand Kit version and its prototype-cleared assets, still approved and unexpired at build
   time.
3. Self-hosted WOFF2 files for six OFL families, with licence text; no file is downloaded at build time.
4. A renderer that consumes `DesignTokens` / `tokensAsCssVariables` and implements the motion
   specification, including reduced motion.
5. An immutable blueprint version, a Studio preview and three flagship rendered demonstrations.

Still open before a client-facing presentation (milestone 3C.5):

1. Photography commissioned or supplied for any concept whose `imagery.missing` is non-empty; the
   prototype currently shows a labelled image-pending plate.
2. A separate publish-permission check for every asset; prototype approval is not publication.
3. A private, expiring presentation link with its own audience, view log and decision record.





