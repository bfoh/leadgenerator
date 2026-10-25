# Adwoa’s House — creative review packet

25 October 2026 · **owner creative approval pending** · branch `feature/codex-creative-excellence`.

Implementation commit: to be recorded after final verification. Nothing has been pushed or deployed.

## Open the experience

The local production preview runs in demo mode with Supabase and provider credentials blanked.

| Page | Exact preview URL |
| --- | --- |
| Arrival | http://127.0.0.1:3110/showcase/adwoas-house |
| The house | http://127.0.0.1:3110/showcase/adwoas-house/house |
| Rooms | http://127.0.0.1:3110/showcase/adwoas-house/rooms |
| Slow days | http://127.0.0.1:3110/showcase/adwoas-house/day |
| Cape Coast | http://127.0.0.1:3110/showcase/adwoas-house/cape-coast |
| Your stay | http://127.0.0.1:3110/showcase/adwoas-house/stay |

Start at arrival, scroll slowly through the three-image story, reverse direction, then try a room
preview, the rooms gallery and the enquiry notice. On a phone the narrative becomes a complete inline
image sequence; the navigation and gallery remain interactive. No reservation or enquiry is sent.

## Creative decisions

**One house, one visual world.** Ten original synthetic images replace the unrelated stock interiors.
Bone plaster, square-column verandas, dark timber shutters, coastal stone, clay paving and frangipani
recur through exterior, courtyard, rooms, close details and evening. A separate portrait arrival is
composed for phones. The real licensed castle photograph supplies geographic context, never a claimed
view from the house. [Image direction, prompts and continuity critique](assets/ADWOA_IMAGE_DIRECTION.md)
and the [source/rendition manifest](assets/adwoa-concept-v2.json) preserve provenance and permissions.

**A continuous journey.** The full-bleed arrival leads into a paper-ground threshold spread, a
scroll-linked garden/table/room sequence, a selectable room/material register, the coast, and an evening
invitation. House, rooms, day, location and enquiry have distinct section plans. Long explanations about
design and evidence have moved to the existing concept notice; room studies and commercial unknowns
retain local qualifications.

**Typography in several roles.** The approved Instrument Serif/Public Sans pairing remains. The
panoramic arrival, smaller split-page covers, compact scene numbers, quieter body copy and room-register
titles now have different jobs and scales. Both families are self-hosted under SIL OFL 1.1; existing
licence text and language-coverage gates remain. Main reading text starts at 16px. No proprietary
reference font was downloaded.

**Motion changes the image.** Desktop scroll geometry maps directly to the visible wipe between
photographs as the next chapter heading enters. The stage is genuinely sticky, with its bounds checked
in the viewport; reverse/rapid seeks return the same masks. The timeline does not intercept wheels,
animate browser scroll, create pin spacers or rerender React each frame. CSS handles coordinated
entrances, page arrival, navigation underlines and hover feedback. The native gallery dialog supports
arrows, Escape and focus return; room previews have actual keyboard/touch buttons.

Research: [15-reference browser study](CODEX_CREATIVE_RESEARCH.md), including URLs, computed typography,
observed animation samples, mobile layouts, limitations and the GSAP/native-motion decision. References
informed hierarchy, photographic consistency and pacing; their code, artwork and layouts were not copied.

## Before and after

Baseline: `aa6eec0`, captured from an isolated credential-free copy. The initially encountered sign-in
redirect was rejected as invalid evidence and replaced with captures of the actual original showcase.

| Owner-rejected aspect | Revised experience |
| --- | --- |
| Unrelated room and domestic stock photographs | Ten original images with a common architectural/material identity |
| Dark, text-heavy public sections | Warm paper interludes, photographic chapters and shorter public prose |
| Static three-photo triptych | Reversible scroll-linked frame changes; inline visual sequence on phone/reduced motion |
| Hover-only room preview | Explicit buttons, active states, keyboard focus and touch selection |
| Long explanatory room inventory proposal | Short, locally qualified room/material studies; detailed unknowns in the concept notice |
| A plan-led evidence section | A photographic Cape Coast chapter and a direct invitation |
| Repetitive full-bleed inner-page covers | Split editorial covers, image galleries and page-specific content plans |

| Route | Before desktop / phone height | After live desktop / phone height |
| --- | ---: | ---: |
| Home | 6,894 / 6,276 | 7,114 / 6,852 |
| House | 5,340 / 4,953 | 5,836 / 5,686 |
| Rooms | 6,760 / 5,846 | 5,337 / 5,196 |
| Day | 5,384 / 5,275 | 5,315 / 4,977 |
| Cape Coast | 4,504 / 4,478 | 4,538 / 4,574 |
| Stay | 4,508 / 4,999 | 3,433 / 4,123 |

The live home is slightly longer because it now contains a real three-chapter scroll story and ten
primary image placements, rather than eight. Its complete static composition is 5,858px desktop. The
phone narrative shows every scene inline; its extra imagery increases length. This is a visual-density
tradeoff, not a claim that shorter automatically means better. Measurements are at 1440×900 and 390×844.

## Visual evidence

- [Desktop before/after](evidence/creative-excellence/before-after-desktop.jpg) · [phone before/after](evidence/creative-excellence/before-after-mobile.jpg)
- [Final desktop arrival](evidence/creative-excellence/capture/home-1440-arrival.jpg) · [final phone arrival](evidence/creative-excellence/capture/home-390-arrival.jpg)
- [Full desktop static composition](evidence/creative-excellence/capture/home-1440-static-full.jpg) · [full phone composition](evidence/creative-excellence/capture/home-390-static-full.jpg)
- [Actual desktop scroll recording](evidence/creative-excellence/motion/adwoa-desktop.webm) · [actual phone-viewport recording](evidence/creative-excellence/motion/adwoa-mobile.webm)
- [25% wipe](evidence/creative-excellence/motion/story-25.jpg) · [50% wipe](evidence/creative-excellence/motion/story-50.jpg) · [75% wipe](evidence/creative-excellence/motion/story-75.jpg)
- [Third image fully revealed](evidence/creative-excellence/motion/story-third-100.jpg) · [third image reversed halfway](evidence/creative-excellence/motion/story-third-50.jpg)
- [360/768/1024px multi-scroll review](evidence/creative-excellence/breakpoint-review.jpg) · [image collection](evidence/creative-excellence/asset-contact-sheet.jpg)
- [Desktop gallery](evidence/creative-excellence/capture/gallery-1440.jpg) · [phone gallery](evidence/creative-excellence/capture/gallery-390.jpg) · [phone menu](evidence/creative-excellence/capture/mobile-menu.jpg)

All six routes have desktop/phone arrival and full static captures in `evidence/creative-excellence/capture/`.
Full-page stitches are explicitly static variants: a single stitch cannot faithfully represent a pinned
image that changes during scrolling. The intermediate frames and recordings show the live behavior.
The browser was real Playwright Chromium; no physical-phone or native-browser-connector review is claimed.

## Shared architecture and security

The renderer has no Adwoa-specific React branch. Validated variants and plate storytelling fields travel
through the existing editorial/builder/blueprint path. `paper-and-ink` is an optional cinematic surface;
legacy variants remain supported. Native `picture` offers portrait art direction and AVIF/WebP sources.
Mobile and invitation asset references participate in the same asset-permission validation as other media.

The exact creative direction and Brand Kit binding, approved asset provenance, prototype permission,
expiry checks, schema validation, immutable history, organization isolation, concept disclosure and
`publishReady: false` remain. No database migration or production-data change was needed. Enquiry
actions still open the trusted notice and collect no information. No paid dependency was installed.

Measured performance prompted three further shared improvements: application fonts load when used,
instead of globally preloading three unused files on showcase routes; the arrival has AVIF derivatives
with WebP fallback; and pure navigation helpers no longer pull the schema-validation runtime into the
visitor renderer. Validation remains at the existing builder/service boundaries.

## Verification and accessibility

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| ESLint | Passed; zero warnings |
| Unit and database | **855 passed** in 54 files; PGlite only, with network disabled |
| Full Playwright suite | **117 passed**: 91 desktop, 26 mobile |
| Responsive review | Six routes at 360, 390, 768, 1024 and 1440px; no horizontal overflow or clipped hero lines |
| Accessibility | No serious/critical axe WCAG 2/2.1 A/AA findings at tested states, including every home section |
| Production build | Passed |
| Client secret scan | 171 files; five key formats, service-role tokens and two configured secret values; no matches |
| Asset integrity | Ten original masters and 32 responsive renditions verified against recorded hashes |

The final full browser run used an isolated output directory and passed all 117 cases in one run.
Machine-readable results: [verification.json](evidence/creative-excellence/verification.json).

The checks include the complete offline unit/PGlite suite, full desktop/mobile business regressions,
axe WCAG 2/2.1 A/AA checks, keyboard focus/return, no-JS, reduced motion, preference changes, image
failure before hydration, actual scroll masks, sticky bounds, page-scoped cleanup and all six Adwoa
routes at 360/390/768/1024/1440px. No existing test was removed or weakened; old heading/motion-mode
expectations were updated to the new authored behavior.

Found and corrected through rendered review: paper-surface headings/prose inherited pale ink;
caption backgrounds retained dark chapter styling; the active nav link used dark green on ink;
gallery/process notes inherited incorrect muted ink; a brass chapter marker failed on paper; initial
image failures could occur before hydration; the phone header and concept note were crowded. The
strict reverse-scroll assertion now waits for the containing page’s arrival transform to settle
before measuring absolute geometry; its equality checks remain unchanged. A concurrent test-artifact
collision was corrected by isolating the final runner output. There are dedicated checks for the
interaction and contrast paths. Passing axe is not a full WCAG certification
or screen-reader audit.

Recorded-video review also exposed dark newly-unclipped image tiles during rapid seeking, despite
loaded image resources and correct live snapshots. Temporary browser A/B experiments with explicit
decoding and with per-frame compositing both restored the recorded image. The final CSS keeps the
masked desktop fields on separate compositing layers. This avoids an extra JavaScript loader or
additional image requests; phone/static compositions keep their existing inline-image behavior.
The final recording was decoded in Chromium and visually checked at the full third image and its
halfway reverse wipe. Seek timestamps and computed masks are preserved in `motion/frame-observations.json`.

## Performance measurements

Six cold samples ran separately from tests, axe, screenshots and recording. Desktop used 1440×900,
DPR 1 and an unthrottled local connection. Phone used 390×844, DPR 2, 4× CPU slowdown, 150ms latency,
1.6Mbps downlink and 750Kbps uplink. Every sample used a fresh context with cache disabled. These are
local Chromium lab results on a shared development machine, not field Core Web Vitals or Lighthouse scores.

| Metric | Desktop median (range) | Throttled phone median (range) |
| --- | ---: | ---: |
| Browser LCP | 0.212s (0.204–0.572) | 1.540s (1.524–1.540) |
| First contentful paint | 0.212s (0.204–0.572) | 1.352s (1.352–1.360) |
| CLS, maximum session window | 0 | 0 |
| Initial long-task blocking estimate | 87ms (47–88) | 648ms (644–657) |
| Observed interaction duration | 152ms (152–160) | 200ms (192–208) |
| Sustained scroll frame p95 | 33.3ms (16.8–33.3) | 33.4ms (all three) |
| Initial encoded resource bytes | 1,410,636 | 663,563 |
| Font payload | 57,360 bytes | 57,360 bytes |

**Interpret the LCP number carefully:** the final API candidate was a headline span. The portrait hero
finished its network transfer at 3.056s median under the phone profile; LCP is not a claim that the whole
photographic entrance had completed at 1.540s. Entrance animation continues on its own bounded timeline.
The interaction samples come from opening/closing the disclosure; they are not a field INP estimate.
TBT is an initial observed long-task estimate, not Lighthouse TBT. The 648ms phone blocking estimate and
roughly 3.06s hero transfer remain performance weaknesses under this intentionally demanding profile.
The desktop frame interval varied between roughly 60 and 30 frames per second across samples; the
final composited story is not claimed to sustain 60fps. Phone used the complete inline-image layout.

Before optimization the same phone setup recorded 5.920s median LCP, 741ms initial blocking, 1,073,760
resource bytes and 228,444 font bytes. AVIF and load-on-use fonts reduced the portrait file by 56%, font
payload by 75% and initial encoded resource bytes by 38%. Moving pure navigation helpers out of the
schema module reduced initial JavaScript from about 225KB to 195KB. No animation library was added.
All before/after samples are retained in [before-optimization.json](evidence/creative-excellence/performance/before-optimization.json)
and [lab-results.json](evidence/creative-excellence/performance/lab-results.json).

## Remaining visual and production limits

- The images are coherent fictional studies, not surveyed building geometry. Interior joinery and
  door spacing vary; no measured adjacency or verified room category is implied.
- Warm afternoon/evening light dominates. A future commissioned set would benefit from more neutral
  morning light and a consented human guest/host story.
- Landscape masters are 1536×1024. Larger HiDPI production would need higher-resolution originals.
- The castle is the only real-location photograph. The house, garden and room facilities remain
  synthetic; rates, access, room categories and booking terms need business confirmation.
- Lab browser emulation is not field Core Web Vitals, a hardware-phone benchmark or a screen-reader audit.

## Approval gate

The requested outcome is now Adwoa’s House creative review. **Do not redesign Nsroma Atelier or
Bantama Design Office until the owner explicitly approves this direction.** No push, deployment,
production migration, live provider call, publication or prospect contact is authorized. Record the
owner’s feedback against this version, then revise Adwoa or proceed only within their next approval.

Persistent recovery instructions: [ACTIVE_CREATIVE_HANDOFF.md](ACTIVE_CREATIVE_HANDOFF.md) and root
`AGENTS.md`. Reproduce screenshots/recordings/lab samples with `node scripts/review-adwoa.mjs
capture|motion|performance http://127.0.0.1:3110` against a credential-free demo production server.
