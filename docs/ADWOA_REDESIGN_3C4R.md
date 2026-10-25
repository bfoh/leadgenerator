# Adwoa’s House — 3C.4R redesign evidence

**Historical status: rejected by the owner.** The current rebuild and creative-review gate are tracked
in [ACTIVE_CREATIVE_HANDOFF.md](ACTIVE_CREATIVE_HANDOFF.md) and
[CODEX_ADWOA_REVIEW.md](CODEX_ADWOA_REVIEW.md). This document records the earlier rebuild of the first flagship
website (Adwoa’s House, “First Light”), the measurements taken in a real browser, the defects found
after the rebuild, and what was corrected. It is not a claim of creative acceptance.

Companion documents: `docs/VISUAL_AUDIT_3C4R.md` (the rejected baseline and acceptance criteria),
`docs/DESIGN_RESEARCH_3C4R.md` (references), `docs/WEBSITE_STUDIO.md` (how the renderer works).

---

## 1. What changed in the rebuild

| Area | Before (3C.4) | After (3C.4R) |
| --- | --- | --- |
| Hero | Static image under a large title | Masked two-line title, frame reveal, timed copy entrance, scroll progression |
| Sequence | Three full-width plates of equal weight | Desktop triptych: 16:9 establishing frame, hanging 4:5 portrait, 3:2 detail |
| Room register | Rows that expanded a list | Sticky preview panel with hover/focus change, compact rows |
| Chapter | Same overlay treatment everywhere | Plan-led chapter with a marked drawing and an evidence ledger |
| Photography | Five images reused across four pages | Eight distinct assets per page; no photograph repeats inside a page |
| Page arrival | Full-screen wipe | 520 ms veil, or a static settle when motion is reduced |

The executable side is the same renderer the Studio uses: the blueprint’s `artDirection` plan selects a
scene recipe, `useWebsiteMotion` observes the page, and CSS owns every animated property. No animation
configuration exists without a browser implementation behind it.

## 2. Measured result (local production build, 1440×900 and 390×844)

| Page | Desktop height | Mobile height | Images |
| --- | ---: | ---: | ---: |
| home | 6,894 | 6,276 | 8 |
| rooms | 6,760 | 5,846 | 8 |
| house | 5,340 | 4,953 | 5 |
| day | 5,384 | 5,275 | 6 |
| cape-coast | 4,504 | 4,478 | 5 |
| stay | 4,508 | 4,999 | 2 |

Baseline for comparison (from the audit): home was 8,874 / 8,073 with eight placements and five unique
files. The home page is now 22% shorter on desktop and 22% shorter on mobile while carrying more
distinct images, meeting the acceptance target (≤ 7,000 desktop, ≤ 6,500 mobile).

No horizontal overflow at 360, 390, 768, 1024 or 1440 (`scrollWidth - clientWidth = 0`). Hero line masks
report `clientHeight === scrollHeight` at every width after the padding correction in §4.3.

## 3. What actually runs in the browser

Verified by `tests/e2e/website-motion.spec.ts` against the production build:

1. **Arrival.** Both hero lines are split into word masks; each line animates with
   `heroLineReveal` (760 ms, 90 ms stagger), the hero frame reveals with `heroFrameReveal` (900 ms) and
   the lead, meta rail, actions and concept note enter with `heroCopyEnter`. The scene writes
   `--scene-progress` and `--scene-y` from a single rAF-throttled passive listener.
2. **Scroll progression and the sticky register.** Scrolling moves `--scene-progress` from 0 towards 1;
   the register’s preview follows the active row and the section keeps its sticky behaviour.
3. **Page-scoped navigation.** A route change tears down the observer and listeners, clears every inline
   custom property, and re-attaches against the new DOM; the new page runs `pageVeil` once.
4. **Reduced motion.** With `prefers-reduced-motion: reduce` the root carries `data-motion="static"`, the
   line animation is `none`, no transform or clip-path remains, there are no running animations and no
   scroll listener. The whole design is visible at rest.
5. **No JavaScript.** Without JavaScript the site renders every section at rest: `data-motion` is absent,
   line transforms are `none`, masks are fully opaque and all six images are present in the markup.
6. **Accessibility.** Axe (WCAG 2.0/2.1 A and AA) reports no serious or critical violations on seven
   routes, including home, rooms, day and stay.

## 4. Defects found during this pass, and the fixes

### 4.1 Two attributes shared one name

`ImagePlate` wrote `data-motion="cinematic_sequence"` (a motion *direction*) while the renderer writes
`data-motion="ready" | "static"` (the engine *state*) on the site root. The no-JavaScript test read the
first `[data-motion]` in document order and found a plate. The plate attribute and the dead `--parallax-y`
rule that consumed it were removed; the direction is already exposed once, on the root, as
`data-motion-mode`.

### 4.2 Secondary ink was only validated against the page ground

`buildPalette` measured the muted colour against `background` only. Raised surfaces are a shade away and
lost the last tenth of a point: Nsroma’s details section measured **4.35:1** against its surface while
passing against the ground. Secondary ink is now held above 4.5:1 against both grounds, and
`contrastChecks` records the surface pair. Two further causes were fixed at the source:

- `.credit` no longer applies `opacity: 0.72` on top of the muted token (2.8:1 on Bantama’s light ground).
- `.toneAccent` no longer mixes its readable ink back towards the accent; small type on a filled accent
  block stays at full ink (was 4.01:1, now above 4.5:1).

### 4.3 The hero mask clipped its own line

The mask hid the incoming line with `overflow: hidden` and 0.18em of bottom padding, which is less than a
0.84 leading needs: at 360px the last three pixels of the line box sat outside the clip. Two changes:

- the padding is 0.28em with a compensating negative margin, so the headline rhythm is unchanged and the
  descenders are clear at every width;
- the line is now revealed by **clipping the text** (`clip-path: inset(...)` from above the glyphs to
  beyond their ascenders) rather than by pushing a translated copy up inside the mask. A transformed
  descendant inside an overflow box counts as scrollable overflow, so the old technique reported a
  three-to-fifty-pixel “clip” for the whole duration of the entrance even when nothing visible was cut.
  The new keyframes keep the mask box honest at every frame, which is what the width test measures.

### 4.4 Photography contradicted the place and the copy

Three licensed studies were withdrawn rather than re-captioned:

| File | What it actually showed | Why it was withdrawn |
| --- | --- | --- |
| `arrival-courtyard.jpg` | A modern suburban house with a lawn and neighbouring roofs | Contradicted “a quiet street, a walled garden”; read as a display home |
| `room-detail.jpg` | A desert house with a glass bedroom cube | Was captioned “linen, timber and a handle worn by use” |
| `house-interior.jpg` | A white villa with a pool and a dog | Read as a private Western villa, not a nine-room guest house |

Every remaining caption now describes what is in the frame. The home hero is the warm timbered room at
dusk, the rooms page opens on a morning room, the house page on a doorway, the day page on pale light,
Cape Coast on the castle itself, and the register uses two interior studies plus the light study.

### 4.5 The sequence was a stack, not a composition

The three plates sat in one centred column, so the caption of one plate landed level with the top of the
next while two thirds of the viewport stayed empty beside each frame. The desktop sequence is now a
12-column triptych with three different scales, aligned captions, and 150px less height.

## 5. Honest limits of this pass

- **The photography is not Ghanaian.** Seven licensed atmosphere studies cannot make a Cape Coast house
  look like Cape Coast. They are disclosed as concept images and no caption claims otherwise, but the
  site will stay generic until the house supplies its own photographs. Sourcing new imagery needs the
  owner’s authorisation; nothing was downloaded in this pass.
- **Nsroma Atelier and Bantama Design Office are unchanged.** Both still repeat plates inside a page
  (Nsroma’s home uses seven placements for four files). The new invariant test covers Adwoa’s House now
  and will cover them when their rebuilds are approved.
- **The day page opens on the palest frame.** It is honest as a light study, but it is the weakest first
  impression of the six and the first candidate for replacement photography.
- The visual editor, publishing and the other two sites remain out of scope until this direction is
  approved.

## 6. What the owner is asked to approve

1. The direction itself: dark, warm, timber and bone, Instrument Serif with Public Sans, brass as the only
   accent, the plan and light studies as first-class imagery.
2. The composition of each page, and specifically the desktop triptych, the sticky register and the
   ledger-style terms.
3. The motion: a 760 ms masked arrival, slowed image reveals, and a static alternative under reduced
   motion — quiet rather than demonstrative.
4. The decision to withdraw three photographs and to treat the remaining seven as disclosed placeholders.

Approval of this direction is the gate for rebuilding Nsroma Atelier and Bantama Design Office with the
same engine.
