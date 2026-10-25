# Creative excellence — architecture and baseline audit

Date: 25 October 2026. Baseline: `aa6eec0`, clean `feature/milestone-3c-4`.
Working branch: `feature/codex-creative-excellence`. This is an owner-rejected baseline, not an approved direction.

## Architecture to preserve

`creative-direction.ts` binds a confirmed evidence brief and approved Brand Kit to an immutable creative territory. `website-editorial.ts` supplies content and named media roles; `website-compositions.ts` resolves only approved, unexpired prototype assets and produces `dof-website-blueprint/1`. Zod parsing and `blueprintProblems` validate the document. `website-prototype-services.ts` rechecks the exact direction, kit, concept and organization on save. Migrations 012–015 supply immutable history and RLS; no migration is needed for this pass.

`WebsiteRenderer` is the shared Studio/showcase renderer. Nine trusted section components consume enums, never generated source. Media URLs are passed separately, preserving signed-source expiry. Structured actions allow internal pages, anchors or a prototype notice only. Concept disclosures and `publishReady: false` remain mandatory. New composition choices must travel through editorial → builder → schema → this same renderer.

## Why the current result remains underwhelming

- The hero contains a two-line title, lead, actions, three facts, status and a long concept explanation over unrelated interior photography. Its visual hierarchy competes with its subject.
- The 4,452-line CSS module contains successive cinematic overrides. Most sections retain the same dark ground and display-serif emphasis. Refinement by adding more family-wide overrides will keep the hierarchy fragile.
- Sequence progress is viewport passage, not a timeline through images. It produces at most 28px drift; the three photographs stay in one static triptych. The observer starts one-off entrances but offers no sustained narrative.
- The room preview responds to mouse hover and focus bubbling, but the non-link room titles themselves are not focusable controls. Touch users see thumbnails, without an equivalent explicit selection interaction.
- Public prose repeatedly explains the design proposal, evidence and missing inventory. This should primarily live in the always-available concept-information dialog, with short local qualifications beside unconfirmed room studies.
- Seven stock atmosphere photographs depict different interiors, not one coastal Ghanaian house. Existing licensed images are safe to use as disclosed references, but cannot establish visual continuity. New asset generation is a separate pending owner permission.
- Instrument Serif/Public Sans are already licensed, self-hosted and direction-bound. The issue is repetitive scale and composition, not licence availability. Keep the approved pairing and differentiate display, editorial, interface and numerical roles.

## Design hypothesis before implementation

**A house between garden and sea.** A photographic arrival, warm paper interludes, deep palm chapters, and a clear invitation. Move through exterior/threshold → shade/material → room → coast → enquiry. Use shorter copy, varied image scales and visible progress. A bounded sticky sequence should change the actual frame and chapter as the visitor scrolls; phone layouts should form their own vertical image story. No scroll interception or heavyweight film player is justified for a short image narrative.

Add optional, validated composition variants, plate storytelling fields and an image invitation. Preserve legacy variants. Prefer native CSS, IntersectionObserver and one batched rAF geometry loop: these already exist, allow a deterministic scroll-linked mask, and add no dependency. Evaluate GSAP, WAAPI and CSS ScrollTimeline in the research record; choose by the required behavior, rather than library reputation.

## Review and evidence plan

Before images: `docs/evidence/creative-excellence/before/` (six routes, 1440 and 390). Research screenshots of third-party sites stay in `/tmp/dof-creative-research/`; they are observation evidence, not production assets. A native browser connector was unavailable; installed Playwright Chromium is the real browser used here. Final review must cover 360, 390, 768, 1024 and 1440px, actual forward/reverse/rapid scroll frames, keyboard, touch controls, no JavaScript, reduced motion, missing media, axe, cold-load lab performance, and the complete offline project verification suite.

Stop after presenting Adwoa’s House for owner creative approval. Do not redesign Nsroma or Bantama, push, deploy, send messages, apply production migrations or call paid providers.
