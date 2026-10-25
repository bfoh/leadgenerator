# Visual and Interaction Audit — Milestone 3C.4R

**Baseline commit:** `ad37950d2ff62a1e6761b7ab555c1b43a420eb53`

**Scope:** every available page of the three flagship demonstrations at desktop (1440 × 900) and
mobile (390 × 844). This is an evidence-based audit of the rendered result, not a review of component
inventory or test coverage.

**Rendered pages:** 19 (6 Adwoa’s House, 5 Nsroma Atelier, 8 Bantama Design Office).

**Status:** this document records the rejected baseline. The Adwoa redesign and its verification are
recorded separately in `ADWOA_REDESIGN_3C4R.md`.

---

## 1. Method

- Built the current branch and served it at `http://localhost:3110` with Supabase variables blanked, so
  no production data or auth was touched.
- Captured full-page desktop and mobile screenshots for all 19 pages.
- Scrolled each page to exhaust lazy images before capture.
- Measured section heights, padding, heading sizes, index-row heights, image counts, natural/rendered
  dimensions, font families, horizontal overflow, reveal targets and resource weight.
- Observed the live first viewport and intermediate scroll positions in Chromium; the static capture is
  evidence, not a substitute for the browser review.
- All screenshots are of our own synthetic sites and may be retained for the design review. No
  third-party artwork is included.

---

## 2. Baseline: the numbers

### 2.1 Full page and content density

| Site / page | Desktop height | Mobile height | Images | Main deficiency |
| --- | ---: | ---: | ---: | --- |
| Adwoa / home | 8,874 | 8,073 | 8 (5 unique) | Repeated rooms; three 666px index rows; 2,535px sequence |
| Adwoa / house | 6,248 | 5,479 | 5 | Same room/detail images recur; one plan |
| Adwoa / rooms | 6,592 | 5,708 | 4 | Same four images; no true room inventory |
| Adwoa / day | 5,302 | 4,798 | 5 | Two chapters plus a sequence, all same room photographs |
| Adwoa / cape-coast | 7,290 | 4,461 | 5 | 4,516px desktop gallery for three images |
| Adwoa / stay | 3,869 | 3,527 | 1 | Visually thin conversion page |
| Nsroma / home | 7,274 | 6,981 | 7 | Sparse statement; 2,133px sequence; repeated cloth detail |
| Nsroma / atelier | 6,784 | 5,790 | 5 | A 1,667px hero with the image at the end |
| Nsroma / collections | 5,665 | 4,956 | 7 | 2,491px gallery, four images, two repeated |
| Nsroma / commissions | 4,596 | 4,345 | 1 | No human/garment image on the conversion page |
| Nsroma / contact | 4,203 | 3,616 | 1 | One drawing only |
| Bantama / home | 6,712 | 7,039 | 7 | Strong type, static grid |
| Bantama / practice | 5,444 | 6,210 | 6 | Long text bands, few project images |
| Bantama / work | 4,817 | 4,708 | 7 (4 unique) | Repeated drawings and white-building |
| Bantama / courtyard clinic | 5,295 | 5,613 | 6 (3 unique) | Drawings dominate; no human/context frame |
| Bantama / ashanti house | 4,463 | 4,777 | 5 (3 unique) | White-building/interior repeat |
| Bantama / reading room | 4,996 | 4,935 | 5 | Scarpa image used twice; static gallery |
| Bantama / method | 3,377 | 4,074 | 1 | Text-only method page |
| Bantama / contact | 3,220 | 3,598 | 1 | Drawing as the only visual |

### 2.2 Spacing and rhythm

- Every cinematic section uses the same desktop vertical padding: **129.6px** top and bottom. The
  result is a metronomic page rather than an art-directed rhythm.
- Adwoa’s room register uses `min-height: 74svh`. At 900px, each of the three rows measured **666px**.
  Three rows produce 2,636px of index before the chapter.
- The Adwoa sequence measured **2,535px desktop / 2,087px mobile** for three plates.
- The Cape Coast gallery measured **4,516px desktop** for three images because each plate inherits a
  cinematic `min-height: 62svh` plus the filmstrip layout. This is not generous space; it is an
  incomplete composition stretched by CSS.
- On mobile, the same pages remain long: Adwoa home is **8,073px**, roughly 9.5 screens, with only
  eight image placements.
- Section headings are large but not the only problem: Adwoa’s `h1` measures **192px** at 1440 and
  its CTA headings **106.56px**; these are statement sizes, but without enough visual material around
  them they read as emptiness rather than confidence.

### 2.3 Repetition

Adwoa’s home loads eight images but only five distinct files. The same `room-window.jpg`,
`room-detail.jpg`, `room-evening.jpg` and `house-interior.jpg` recur across home, house, rooms and
day. The Cape Coast page uses the castle photograph in both its chapter and gallery. On the rooms
page, `room-window.jpg` appears twice. This is precisely the “duplicate the same room photograph”
failure identified by the owner.

The other showcases have the same pattern: Nsroma repeats kente-detail and fitting-detail across
pages; Bantama repeats architectural references and drawings across the index and case studies.

---

## 3. Page-level audit

### 3.1 Adwoa’s House

**Home.** The strongest first impression of the three, but the first frame is static beneath a large
title. The title is beautiful; the image behind it is a room interior rather than an arrival or a
threshold. The sequence is three full-width plates of similar weight and similar subject; the index
then repeats the same room photographs at 666px per row. The chapter is the only section with a
different composition, but it inherits the same overlay treatment used elsewhere. The CTA is a cream
panel after a long dark scroll; it feels like a separate brochure page rather than the natural end of
the walk.

**The house.** A strong statement and a good plan drawing, but the plan appears after 900px of hero
and 795px of statement; the first project-specific visual arrives late. The sequence repeats the room
photographs already seen on home. The page has no sense of a threshold, garden or street.

**Rooms.** The hero uses `room-window.jpg`; the sequence repeats it; the index has no preview image
interaction. The page explains the missing inventory honestly, but visually it is a text ledger with
one repeated room photo. There is no way to feel the difference between the three proposed room
positions.

**The day.** Two chapter overlays and a sequence, all using the same four photos. The concept of
“morning/afternoon/evening” is present in copy but not in image or light. The page is 5,302px of
mostly one room. The castle appears at the end without a route or a spatial relationship.

**Cape Coast.** The castle chapter is strong and factually careful, but the gallery after it is 4,516px
desktop / 1,693px mobile for three images, one of which is the castle already seen and one of which
is the same common room. The page needs a route/plan composition, not a stretched gallery.

**Stay.** One image, a ledger and a statement. It is the clearest commercial thesis and the weakest
visual experience. The page does not carry the atmosphere of the house into the moment of decision.
The “Preview the booking enquiry” action is clear, but there is no visual explanation of what the
booking conversation will ask for.

### 3.2 Nsroma Atelier

The visual identity is the most distinctive of the three: cream ground, oxblood accent, kente detail
and a strong editorial headline. The problem is **density**, not identity. The statement pages leave
large fields empty around a headline; the sequence uses three plates at similar scale; the index is
visually quieter than the clothing. The atelier hero measured 1,667px desktop with its image at the
bottom; the user reads a long block of type before seeing the work. Commissions and contact each
carry only a drawing, so the conversion pages lose the material argument entirely. The site feels like
a beautiful cover and a thin book.

### 3.3 Bantama Design Office

The grid, monochrome imagery and vermilion accent are promising, but the pages are rigid. The work
index uses 1,307px of rows and repeats the same drawings; the case studies put most of their evidence
in a gallery below a text chapter. The method page has one image across 3,377px; contact has one
drawing across 3,220px. There is no transformation of the grid between sections, no pinned project
title, no sense of moving through a building. The site reads as a static portfolio with an excellent
typeface, not as an architectural experience.

---

## 4. Cross-site deficiencies

### P0 — blocks creative acceptance

1. **The motion direction is not executed.** `cinematic_sequence` produces the same 420ms block
   reveal as every other direction. There are no masked lines, no image wipes, no sticky scenes, no
   scroll progression and no page choreography. The documented motion language is metadata, not
   behaviour.
2. **Adwoa has no arrival image strategy.** The hero is a room; the threshold, garden and street are
   absent. The same room photographs recur across pages. The owner’s “excessive repetition” finding
   is confirmed by the image inventory.
3. **The suite register is a repeated full-screen row.** Three 666px rows with the same photographs
   create length without information. A room index should let the visitor compare, not scroll through
   near-identical frames.
4. **The cinematic sequence has no visual rhythm.** All three plates are full-width, equal-weight and
   stacked. There is no establishing/medium/detail progression, no offset, no caption rail.
5. **Inner pages do not have distinct compositions.** Adwoa’s house, rooms, day and stay all resolve
   to hero + statement/sequence + CTA. The narrative changes in copy but not in visual behaviour.
6. **No real page transition.** Route changes are a global 8px fade. The navigation and footer change,
   but the new page does not arrive as a composed scene.

### P1 — materially weakens the result

7. **Vertical rhythm is metronomic.** 129.6px section padding on every cinematic section; 74svh rows;
   62svh sequence plates. Space is not responding to content.
8. **Mobile is a shrunk desktop composition.** Image crops and section heights are largely inherited;
   the home page is 8,073px with only eight image placements.
9. **Image art direction is absent.** Every image is `object-fit: cover` with a default centre focal
   point. There are no mobile-specific crops, no responsive sources and no consistent colour grade.
10. **Typography choreography is absent.** Headlines are static text; only the whole section can fade.
11. **Interaction is thin.** Room rows only scale an image by 1.025 on hover; there is no preview
    change, no focus parity, no purposeful link motion.
12. **Conversion is visually underdeveloped.** The stay page has one image and no step sequence; the
    CTA is a panel rather than a continuation of the house.
13. **The concept plan is buried.** The drawing is not treated as evidence; it appears late and small.
14. **No loading/placeholder art direction.** Images pop in against a flat media frame; there is no
    considered poster colour or crop.
15. **Images are not responsive.** The same 2000px JPEG is requested on mobile and desktop.

### P2 — polish and system quality

16. The fixed disclosure pill is visually loud against the quiet cinematic ground and crowds the
    footer/CTA at the bottom of the page.
17. Section notes use the same treatment everywhere, competing with the main copy.
18. The concept status appears three times (pill, hero meta, footer) in the first two screens.
19. `h1` at 192px and CTA headings at 106.56px are impressive on desktop but lack a deliberate mobile
    composition; they are simply scaled by `clamp()`.
20. The site has no visible focus treatment on image links/rows beyond the global outline.
21. There is no reduced-motion visual review beyond disabling CSS; the content is usable but the
    alternative composition has not been art-directed.
22. No measurable motion test exists; a regression in animation would not fail the suite.

---

## 5. What must be preserved

- The **honesty model**: missing room types, rates and terms are visible; no invented amenities.
- The **approved palette and type pairing**: deep green/bone/brass, Instrument Serif + Public Sans.
- The **accessible navigation**: focus trap, Escape, same labels on mobile, skip link.
- **No external requests**, no enquiry submission, no tracking.
- **Image licensing records** and the prototype-only permission boundary.
- The **slow, quiet voice**; the fix is not to make Adwoa loud.

---

## 6. Acceptance criteria for the Adwoa rebuild

The rebuild is not accepted until all of the following are true in a real browser:

1. The home page has a distinct arrival composition using a threshold/garden image and a masked
   two-line title.
2. At least **four new licensed atmosphere images** are used; no room photograph appears more than
   once on a page; the room register does not repeat the home sequence images.
3. The suite register has a real interaction (sticky preview / focus-and-hover change) and its rows
   are compact enough to compare three rooms in roughly one viewport on desktop.
4. The sequence has at least three different scales/compositions and a caption rail.
5. At least four motion behaviours are observable in the browser: hero line mask, image wipe/drift,
   sticky register/preview, page settle, and a reduced-motion static alternative.
6. Mobile is composed separately at 360, 390, 768 and 1024; no overflow, no clipped headings, and
   image crops are art-directed.
7. Page heights fall materially (target: Adwoa home ≤ 7,000px desktop and ≤ 6,500px mobile while
   carrying more images and content).
8. LCP target ≤ 2.5s, INP target ≤ 200ms, CLS target ≤ 0.1 on the local production build; images use
   responsive sources and explicit dimensions.
9. `prefers-reduced-motion` shows the complete design immediately, with no hidden content and no
   scroll listener.
10. Axe reports no serious/critical violations; keyboard focus reaches every row and action; mobile
    menu still traps and restores focus.
11. The owner reviews the actual result and explicitly approves the creative direction before Nsroma
    and Bantama are rebuilt.

These criteria are deliberately visual and behavioural. A green test suite alone does not satisfy
them.
