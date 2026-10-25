# Active creative handoff — Codex / Cline

Updated 25 October 2026. Branch: `feature/codex-creative-excellence`.

## Current milestone and gate

Milestone 3C.4R — Adwoa’s House creative-excellence rebuild. **Awaiting owner creative approval.**
The owner authorized the redesign, original built-in image generation and local testing/commits.
They have **not** approved this direction, any publication or a redesign of the other showcases.

Implementation and evidence commit: `4179da9` (855 unit/database and 117 browser tests passed).
Baseline was clean `aa6eec0` on `feature/milestone-3c-4`; the dedicated branch was created without
resetting, discarding or stashing work. Preserve the existing Next.js block in root `AGENTS.md`.

## Owner’s rejected aspects

Sparse dark space, unrelated photography, static triptychs, repetitive serif-led layouts,
inconsistent rhythm, explanatory design/evidence prose on public pages, weak visual progression,
underdeveloped interactions and insufficiently composed phone layouts. The older
`ADWOA_REDESIGN_3C4R.md` describes that rejected baseline; it is not a creative approval.

## Current direction and completed work

“A house between garden and sea”: arrival → threshold → garden → material → room → coast → evening
invitation. One original fictional property carries bone plaster, square veranda columns, dark
hardwood shutters/rails, clay paving, coastal stone and frangipani through ten synthetic images.
All source/rendition hashes, dimensions and prototype-only permissions are in `docs/assets/`.
The castle photograph is separately licensed context; it is never presented as a view from the house.

`CODEX_CREATIVE_RESEARCH.md` records 15 browser reference visits, computed type/motion observations,
limits, primary source links and implementation decisions. `CODEX_CREATIVE_AUDIT.md` records the
pre-code architecture/quality audit. Third-party research screenshots were kept in `/tmp`, never
used as assets or committed.

The shared grammar now supports immersive/split covers, editorial image statements, native
scroll-linked image stories, image chapters, editorial galleries and photographic invitations.
Variants are validated data through editorial → builder → schema → trusted renderer. Cinematic
builds opt into paper/ink surfaces; older variants remain supported. There is no business-slug
branch in the renderer. No library was installed.

Cold mobile measurement exposed unused global application-font preloads, a heavy portrait hero
and a schema-runtime import through presentation helpers. Application fonts now load on use;
arrival images offer AVIF with WebP fallback; pure navigation helpers keep the validation runtime
at its existing builder/service boundary. See the review report for before/after lab results.

Motion: CSS entrances, one IO/rAF runtime, direct reversible image masks and a sticky stage at
desktop widths; an explicit skip link; complete inline-image phone, no-JS and reduced-motion
compositions. Room preview controls support keyboard/touch; a native gallery dialog supports
arrow keys, buttons, Escape and focus return. Failed image requests produce a labelled fallback,
including failures before React hydration. Asset sources remain separate from saved blueprints.

Persistent concept disclosure and local qualifications stay visible. Detailed evidence and
commercial unknowns are in the existing notice. No availability, contact form, payment, provider
request, analytics or prospect communication was connected.

## Verification and review evidence

Read `CODEX_ADWOA_REVIEW.md` for final counts, performance samples, accessibility findings,
before/after dimensions, screenshots, actual scroll recordings, exact URLs and remaining weaknesses.
Reproduce evidence with `scripts/review-adwoa.mjs` against a **demo production** server.
The complete Vitest suite includes local PGlite database tests with network disabled.
Playwright covers business regressions, security, desktop/mobile, actual motion, preference changes,
no-JS, gallery/keyboard behavior, image failure and 360/390/768/1024/1440px compositions.

Final video review caught dark newly-unclipped tiles during rapid seeking. Browser A/B experiments
confirmed that explicit decoding or separate frame compositing resolved it. The selected CSS gives
masked desktop fields their own compositing layers; validate the actual recording as well as live
snapshots when changing this rule.

## Unfinished and next approved action

1. Present/review the local Adwoa’s House experience and evidence with the owner.
2. Record their exact approval or requested changes. Revise Adwoa’s House if requested.
3. **Stop here until explicit creative approval.** A “continue” during implementation is not approval.
4. Only after approval, begin Nsroma Atelier; then Bantama Design Office, preserving distinct identities.

Remaining boundaries: imagery is synthetic, not measured building geometry; room categories,
facilities, rates and booking terms remain unverified; no field Core Web Vitals, hardware-phone
benchmark, screen-reader certification or live Supabase verification is claimed.

## Production restrictions

Do not push, deploy, apply production migrations, change production data, call paid external APIs,
contact prospects, scrape Google Maps/social assets, publish fictional concepts as official sites,
or change existing approval and organization-isolation contracts. Database checks use PGlite only.
Keep Supabase/provider variables blank for previews and e2e runs. Original synthetic assets have
prototype permission only; export/publication remain separate approval gates.
