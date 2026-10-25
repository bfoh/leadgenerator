# Design Research — Milestone 3C.4R

**Scope:** Premium fashion, hospitality and architecture websites; reference study for the Adwoa’s
House, Nsroma Atelier and Bantama Design Office rebuilds and for the reusable website engine.

**Status:** Research brief complete. This document records external evidence and the principles we
will apply. It is not a moodboard of assets and contains no copied artwork, copy, source code or
proprietary animation.

**Research date:** 25 October 2026.

---

## 1. Method and evidence boundary

I inspected public marketing sites in a real Chromium browser at **1440 × 900** and **390 × 844**.
For each selected site I captured the first viewport, two desktop scroll positions and the mobile
first viewport, and recorded:

- computed display/body type, sizes, weights, tracking and colours;
- navigation placement, fixed/sticky layers and menu labels;
- first-viewport media geometry, object-fit and lazy-loading;
- cinematic media (video, autoplay, mute, loop, poster);
- JavaScript motion libraries and CSS animation counts;
- scroll-reactive transforms, sticky elements and Web Animations/view-timeline usage;
- page height, document/asset counts and navigation performance entries.

The captures are working evidence in `/tmp/3c4r/research/` and are **not committed**: the screenshots
contain other studios’ copyrighted photography and layouts. This document records observations, not
reproductions.

**Limits, stated rather than hidden:**

- **Six Senses** returned `403 Access Denied` from its CDN. It was not bypassed and is not analysed
  as a visual reference.
- **Habitas** did not resolve at `habitashotels.com` during the study.
- **SiteInspire** returned `429 Too Many Requests`; no content was scraped or retried aggressively.
- **Godly** loaded only its interface shell without exposing a stable public list of outbound sites
  in the captured session.
- Awwwards and Hoverstat.es were used for discovery and current-scene calibration, not as a source
  of copied composition.
- The study therefore relies on **15 directly observed sites**: five per industry. This meets the
  minimum of 12 with four per industry and adds a fifth in each category as a control against a
  single aesthetic becoming the false standard.

### Discovery sources

| Source | URL | How it was used |
| --- | --- | --- |
| Awwwards — Fashion | https://www.awwwards.com/websites/fashion/ | Current fashion/editorial calibration; named references including Maison AUGE, Almira Kho, MIU MIU, Heirest |
| Awwwards — Hotel & Restaurant | https://www.awwwards.com/websites/hotel-restaurant/ | Current hospitality calibration; named references including Tengile Malamala, Velaa Private Island, White Desert |
| Awwwards — Architecture | https://www.awwwards.com/websites/architecture/ | Current architecture calibration; named references including AAT Architecten, Estudio Bang, LPAS |
| Awwwards — Luxury | https://www.awwwards.com/websites/luxury/ | Confirmed the current luxury field: restrained type, image-led pacing, occasional WebGL, frequent over-animation |
| Hoverstat.es | https://hoverstat.es/ | Alternative interaction research; especially `archiveforspace.com`, `ballet-de-marseille.com`, `muda.co` |
| Godly | https://godly.website/ | Curation check; dynamic shell limited extraction |
| SiteInspire | https://www.siteinspire.com/ | Attempted; unavailable (`429`) |

The direct references below are the evidence. The indexes were used to avoid selecting only familiar
brands and to see which interaction patterns are currently overused.

---

## 2. Reference set at a glance

| # | Industry | Reference | URL | Useful because |
| --- | --- | --- | --- | --- |
| 1 | Fashion | Lemaire | https://www.lemaire.fr/ | Editorial commerce without hero copy; image and garment first |
| 2 | Fashion | The Row | https://www.therow.com/ | Extreme restraint; one portrait, almost no interface |
| 3 | Fashion | Toteme | https://toteme.com/ | Split-image lookbook and tiny, precise interface type |
| 4 | Fashion | Khaite | https://www.khaite.com/ | Film-led luxury and serif/sans contrast; heavier motion system |
| 5 | Fashion | Studio 189 | https://www.studio189.com/ | Cultural craft and material specificity; also a cautionary accessibility case |
| 6 | Hospitality | Aman | https://www.aman.com/ | Destination-first calm; dark, low-chrome, persistent reserve route |
| 7 | Hospitality | Belmond | https://www.belmond.com/ | Long-form travel storytelling with editorial serif typography |
| 8 | Hospitality | Casa Cook | https://casacook.com/ | Video/scroll choreography and a distinct lifestyle voice |
| 9 | Hospitality | Singita | https://www.singita.com/ | Very large display type and slow conservation narrative |
| 10 | Hospitality | The Hoxton | https://thehoxton.com/ | Big city-specific personality without losing booking clarity |
| 11 | Architecture | OMA | https://www.oma.com/ | Content archive over marketing; radical plainness |
| 12 | Architecture | David Chipperfield Architects | https://davidchipperfield.com/ | Disciplined grid, quiet custom grotesk, long project index |
| 13 | Architecture | John Pawson | https://www.johnpawson.com/ | One-screen image series; extreme reduction |
| 14 | Architecture | Adjaye Associates | https://www.adjaye.com/ | Cultural narrative, Baskerville/sans contrast, horizontal project reel |
| 15 | Architecture | Studio KO | https://studioko.fr/ | Film-first studio introduction and material atmosphere |

### Cross-industry interaction references

These are not additional visual templates. They were used only to test whether a technique is
current and appropriate:

- **archiveforspace.com** (via Hoverstat.es): architectural structure expressed through navigation
  levels rather than decorative chrome.
- **ballet-de-marseille.com** (via Hoverstat.es): large sticky type layered with editorial
  slideshows; confirms that sticky choreography can be calm, not carnival-like.
- **muda.co** (via Hoverstat.es): a scroll-reactive menu; interesting, but rejected for our work
  because persistent reactive chrome competes with reading.

---

## 3. Fashion references

### 3.1 Lemaire — https://www.lemaire.fr/

| Dimension | Observation |
| --- | --- |
| Brand personality | Quiet, intellectual, everyday luxury. The clothes are treated as objects with a life, not as a campaign slogan. |
| Creative concept | A full-bleed campaign frame carries the first viewport; the interface is almost entirely in the masthead. There is no “hero headline” competing with the image. |
| Hero composition | Sticky 107px header over a 1440-wide campaign image. A small ivory title (“THE WRAP COAT”, 24px) sits low-left, not centred. Navigation is set in five calm columns. |
| Layout grid | A wide masthead with four groups; below it, a photographic field rather than a card grid. Product and editorial content share the same 12-column-ish margin discipline. |
| Type | BrownStd throughout. Body 16px; interface 12px; the display moment is only 24px. Tracking is generous at display size. Hierarchy comes from placement and image scale, not huge type. |
| Colour hierarchy | Near-white bone (`#FDFBF9`), near-black ink (`#100A0D`); colour is supplied by photography. The UI does not add a second accent. |
| Photography | 69 images, 65 lazy-loaded. A cool, natural grade; garments shown full-length and in movement. The image is allowed to be the first and last argument. |
| Navigation | Sticky; four large groups plus utility (cart, search, account); a mega-menu with images at 246 × 312. Navigation feels like an index, not an overlay. |
| Section sequencing | Campaign → category/product index → editorial. The first commerce action is never pushed above the image. |
| Scroll | Standard native scroll, no smooth-scroll library. A Swiper carousel handles product movement. No scroll hijack. |
| Hover | Product image swapping (`data-hover-image`) and restrained text states. |
| Motion transitions | Very few. The brand’s confidence is expressed by not animating the page. |
| Responsive | Mobile collapses the nav; photography remains the first screen. The 12px label system survives without becoming unreadable. |
| Conversion | Persistent cart/search and a product route; no hero CTA. This works because the brand already has demand. |
| Performance | 65 of 69 images lazy; no animation framework; one carousel library. |
| Distinctive decision | **No hero copy.** The image and the garment title are enough. |
| What we take | Image-first confidence; small chrome; one accent; a title that sits in the composition rather than above it. |
| What we must not copy | The specific five-column masthead, BrownStd pairing, crop selection, mega-menu composition or campaign imagery. Our guests need practical information earlier than a luxury shopper does. |

### 3.2 The Row — https://www.therow.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Monastic, discreet, expensive without explanation. |
| Creative concept | One portrait, one screen. The site behaves like a printed lookbook opened to a single page. |
| Hero composition | A 1440 × 810 black-and-white portrait under a 48px header; split navigation (categories left, wordmark centre, utility right). Captured page height was only 1,060px. |
| Layout grid | A three-part masthead over a single full-bleed image. There is no secondary card grid in the first page. |
| Type | 13px Basic Commercial/Arial, 21.45px line height. The interface is deliberately smaller than comfortable, relying on brand recognition. |
| Colour hierarchy | White, black and greyscale photography only. |
| Photography | Six images; no lazy loading because there are so few. A single human portrait, close-cropped, looking away. |
| Navigation | Full category set visible on desktop; utility on the right; no hamburger until mobile. |
| Section sequencing | Essentially one editorial screen. Depth is delegated to category pages. |
| Scroll | No motion library, no meaningful first-page scroll. |
| Hover | Underline/colour changes only. |
| Motion transitions | Almost none. This is a deliberate anti-motion position. |
| Responsive | The same full-bleed portrait is cropped for mobile; 104KB mobile capture. |
| Conversion | Navigation leads directly to product; no explanatory CTA. |
| Performance | Six images and no libraries: the lightest reference in the set. |
| Distinctive decision | **Refusal.** No headline, no CTA, no decoration, minimal page. |
| What we take | The discipline of removing anything that does not earn its place; the confidence of a single image. |
| What we must not copy | A one-screen site only works for a famous brand. Adwoa’s House must explain the place, the nine rooms and the booking terms. We need more pages, not fewer. |

### 3.3 Toteme — https://toteme.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Scandinavian exactness; warm minimalism rather than cold minimalism. |
| Creative concept | A lookbook split across image columns, with product names set as small annotations rather than sales cards. |
| Hero composition | Fixed 72px header; the wordmark is a 16px `h1` at centre. The captured first viewport contains tall portrait crops beginning 96px below the header, with labels at the base. |
| Layout grid | A multi-column editorial grid with consistent 4:5-ish crops; the interface aligns to the image edges. |
| Type | “Toteme Sans” at 300/400; 16px body, 12px labels, normal tracking. Typography is quiet and almost system-like. |
| Colour hierarchy | Warm white and charcoal; no decorative accent. Photography carries the season. |
| Photography | 58 images, 53 lazy. Consistent grade, model in architectural interiors, garments shown as worn rather than isolated. |
| Navigation | Fixed header; menu/search/account/bag; deep product taxonomy in a mega menu. |
| Section sequencing | Campaign image pairs → product stories → editorial/featured → footer. |
| Scroll | Native; no JS library detected; 13 CSS animations only. |
| Hover | Product labels and image changes; no theatrical movement. |
| Motion transitions | Mostly entrance fades and menu transitions, short and functional. |
| Responsive | Mobile retains the image-pair rhythm or stacks it without losing the label hierarchy. |
| Conversion | Search and bag persistent; product labels link directly from the image. |
| Performance | 58 images but 53 lazy; no heavy framework. |
| Distinctive decision | **The image grid is the navigation.** Labels at the bottom of photographs make browsing feel editorial. |
| What we take | Mixed image scales, small precise labels, warm neutral ground, images that touch the viewport edge. |
| What we must not copy | The specific season/crop system or the tiny 12px label as body copy. Adwoa’s practical terms must remain comfortably readable. |

### 3.4 Khaite — https://www.khaite.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Cinematic, urban, feminine, controlled. |
| Creative concept | Film and still photography alternate as chapters; the serif/sans pairing creates tension between softness and precision. |
| Hero composition | A 1440 × 811 full-bleed media frame begins 35px below the top. The header is intentionally minimal; a 12px `h1` wordmark leaves the image in charge. |
| Layout grid | Full-bleed cinematic frames alternate with two 600 × 800 image columns and caption bands. |
| Type | Fakt Pro 12px UI/body; ITC Galliard 14px 600 for editorial headings. The serif is an accent, not a second body face. |
| Colour hierarchy | Black/white interface; images provide the palette. |
| Photography | 80 images, 28 lazy; four `<video>` elements (muted, looped, not autoplaying in the captured state), all referencing a 1080p fashion film. |
| Navigation | Static top bar plus utility pages; mega menu; an appointment route. |
| Section sequencing | Film frame → product columns → film frame → editorial grid. Repetition is rhythmic, not accidental. |
| Scroll | GSAP + ScrollTrigger + Swiper detected. The captured page exposes 29 fixed/sticky elements, indicating layered scroll choreography. |
| Hover | Swiper navigation, image/product changes; restrained. |
| Motion transitions | Scroll-triggered reveals and video cuts. This is the most motion-heavy fashion reference. |
| Responsive | Mobile capture 250KB; video is likely replaced or deferred; grid becomes one or two columns. |
| Conversion | “Book An Appointment” is the service route; shipping/returns/FAQ are surfaced in the footer navigation. |
| Performance | Four copies of a 1080p film, 80 images, GSAP: a warning as much as a model. |
| Distinctive decision | **A film sequence is the spine**, not a background decoration. |
| What we take | Serif display against tiny sans detail; alternating full-bleed and split compositions; motion that cuts between scenes rather than animating every element. |
| What we must not copy | Four videos or a 1080p autoplay asset. Adwoa’s first frame must be a still image with a real poster/fallback and no video dependency. |

### 3.5 Studio 189 — https://www.studio189.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Joyful, material, community-rooted; fashion as cultural practice. |
| Creative concept | Craft and people over interface; saturated cloth and portraiture carry the page. |
| Hero composition | A 1000 × 1333 image begins 227px below the top; the page is only 2,574px tall. The captured DOM had no semantic `h1`, `nav` or landmark structure. |
| Layout grid | A simple stacked editorial field rather than a product grid. |
| Type | No reliable type hierarchy was exposed by the captured DOM; the visual system relies on imagery and spacing. |
| Colour hierarchy | Warm white ground; saturated garment colours; no controlled accent role. |
| Photography | Four images, two large; documentary/craft framing, not showroom photography. |
| Navigation | No semantic navigation in the captured render. This is an accessibility failure, not a style choice to imitate. |
| Section sequencing | Brief narrative and image sequence; limited depth. |
| Scroll | 24 CSS animations; no JS motion library. |
| Hover | Minimal; any interaction is image-led. |
| Motion transitions | Small CSS entrances; no scroll storytelling. |
| Responsive | Mobile 166KB; image scale remains the main event. |
| Conversion | Little explicit commerce path in the captured page. |
| Performance | Very light, but partly because the site is structurally incomplete. |
| Distinctive decision | **Cultural specificity is the art direction**, not a “heritage” filter applied to a generic luxury layout. |
| What we take | Show the hand, the cloth and the people; do not sand the culture into beige minimalism. Use warm, close, specific imagery. |
| What we must not copy | The missing semantic structure, absent navigation and thin conversion path. Nsroma must be more complete and more accessible than this reference. |

### Fashion synthesis

The strongest fashion sites do not treat “luxury” as beige plus a serif. They choose one photographic
argument and give it authority. Interface type is small, tracking is deliberate, and colour is either
absent from the UI or reduced to a single stamp. The weak point across the sector is practical
information: size, price, terms and accessibility are often subordinated to atmosphere. For Nsroma,
the lesson is to keep the material confidence and editorial crop discipline while making the
commissioning path clearer than any of these references.

---

## 4. Hospitality references

### 4.1 Aman — https://www.aman.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Serene, remote, quietly expensive; hospitality as a state of mind rather than an amenity list. |
| Creative concept | Let the destination occupy the frame; keep the interface dark, sparse and persistent. |
| Hero composition | A dark first viewport (mean luminance ≈ 69/255) with a sticky 88px header, a persistent Reserve route and a full-bleed destination image. Interface type is absent from the captured `h1` because the image/heading is not semantic; the visual effect is still destination-first. |
| Layout grid | Wide cinematic bands, then a 3-up destination grid with square crops at 326 × 326. |
| Type | Small sans interface type against a hospitality serif in the image; measured body remains near 14–16px. |
| Colour hierarchy | Near-black ground (`#171A17`-family), bone type, and photography carrying warmth. No bright interface accent. |
| Photography | 18 images, 13 lazy; low-key destination photography; wide establishing frames followed by detail and square destination tiles. |
| Navigation | Sticky header with mega-menu “Destinations” and utility links; Reserve remains visible. |
| Section sequencing | Destination image → brand promise → destination index → offers/experiences → footer. |
| Scroll | Native; 44 CSS animations; no JS animation library detected. The page relies on fades/slides rather than scroll hijacking. |
| Hover | Image and text transitions; mega-menu reveals. |
| Motion transitions | Slow, minimal, atmospheric; no cinematic scrub. |
| Responsive | Mobile 168KB; header collapses to menu + reserve; destination imagery re-crops. |
| Conversion | Reserve is always available but not visually loud. Trust is built before the ask. |
| Performance | 18 images, 13 lazy, no animation framework. |
| Distinctive decision | **The interface disappears into the place.** |
| What we take | Persistent quiet booking route; dark, low-chrome framing; one warm accent; destination images allowed to breathe. |
| What we must not copy | Aman’s authority lets it omit explanatory copy. Adwoa’s House is unknown and must explain the nine rooms, the walled garden and the walk before asking for a booking. |

### 4.2 Belmond — https://www.belmond.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Romantic, adventurous, heritage travel with a literary voice. |
| Creative concept | Travel as a sequence of stories; each place, train or boat is a chapter rather than a product tile. |
| Hero composition | A 1440 × 850 full-bleed image/video frame below a 50px header, followed by a wide editorial band. |
| Layout grid | A full-bleed opening then mixed editorial bands: 3-up cards, asymmetric image/text, strong horizontal rules. |
| Type | Sebenta serif at 48px for the `h1`; sans for navigation and utility. The serif is the storytelling voice. |
| Colour hierarchy | Warm neutral ground with dark green/charcoal; imagery supplies most colour. |
| Photography | 53 images, 49 lazy; one video. Wide establishing shots, interior details and human travel moments. |
| Navigation | Horizontal categories (Destinations, Hotels, Trains, Boats, Lodges, Stories) with a separate Find Booking utility. |
| Section sequencing | Welcome → journey types → stories → signature suites → wellness → conversion. |
| Scroll | Native; no JS animation library detected; two CSS animations in the captured document. |
| Hover | Image scale/underline transitions; card reveals. |
| Motion transitions | Editorial fades; video is used as a place-setting, not a scrub target. |
| Responsive | Mobile 113KB; video is likely replaced by a poster/image; navigation collapses. |
| Conversion | “Find Booking” is separated from “Contact”, matching different guest intents. |
| Performance | 49 of 53 images lazy; one video; no framework. |
| Distinctive decision | **Hospitality sold as narrative**, not as a facilities grid. |
| What we take | Long-form chapter sequencing; a serif that carries voice; separate booking and contact intents; video only when it earns its weight. |
| What we must not copy | The colonial-travel tone, named properties, imagery or the exact editorial grid. Adwoa’s voice must be local, specific and honest about what is unconfirmed. |

### 4.3 Casa Cook — https://casacook.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Sunlit, social, design-conscious, youthful luxury. |
| Creative concept | A brand film is the first room; scroll choreography and a magazine-like voice make the hotel feel like a place to be seen. |
| Hero composition | Fixed 73px header; an autoplaying, muted, looping 1280 × 720 brand film is present. Large Oswald display type and Courier Prime body create a deliberately mismatched, editorial voice. |
| Layout grid | Full-bleed films alternate with oversized type, hotel cards and a horizontal/stacked image rhythm. |
| Type | Oswald 40px display and Courier Prime 15px body; optional utilities in a monospace/typewriter register. |
| Colour hierarchy | Sun-bleached grounds, black type, saturated photography. |
| Photography | 37 images, **not lazy-loaded** in the captured document; one video. |
| Navigation | Fixed header with hotel selector, offers, journal and contact. |
| Section sequencing | Film → hotels → lifestyle → offers → booking. |
| Scroll | GSAP + ScrollTrigger + Lenis + Swiper. Animated transforms reach large scales; native scrolling is replaced with smoothing. |
| Hover | Image scale and card motion. |
| Motion transitions | High choreography: film cuts, scroll-linked entrance, image scaling. Visually alive, but the heaviest motion/performance burden in the set. |
| Responsive | Mobile 78KB capture; video and large type are re-composed; the brand remains legible without hover. |
| Conversion | Hotel selector and offers are prominent; booking is a clear next step. |
| Performance | Autoplay film, no lazy images and a smoothing library make this a performance warning. |
| Distinctive decision | **A holiday is sold as a mood film.** |
| What we take | A distinct voice; film used only where it creates place; large type against small documentary captions. |
| What we must not copy | Lenis/scroll smoothing, unthrottled autoplay or non-lazy media. Adwoa must not sacrifice scroll accessibility or mobile data for atmosphere. |

### 4.4 Singita — https://www.singita.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Remote, reverent, conservation-led, unhurried. |
| Creative concept | A slow, large-format journey through place and purpose; the guest is invited to understand before booking. |
| Hero composition | Fixed 84px header; a full-bleed 1440 × 900 image/video; a 100px Morion/Cormorant display line “Place of Miracles” at x348–1093, with a 14px line below. |
| Layout grid | Alternating 810 × 871 portrait/landscape frames, wide text bands and small caption groups over a 12,674px page. |
| Type | Morion/Cormorant serif at 100px for the hero; 14px interface lines; enormous display-to-detail contrast. |
| Colour hierarchy | Muted savannah browns and greens; warm bone type. |
| Photography | 29 images and 2 videos; wide landscapes alternating with close wildlife/people details. |
| Navigation | Fixed header; collection, conservation, wildlife, about; the menu is an overlay rather than a permanent row. |
| Section sequencing | Place → purpose → collection → experiences → conservation → stay. |
| Scroll | Native; no JS animation library detected. The long page is paced by image scale and typography, not effects. |
| Hover | Minimal; arrows and image states. |
| Motion transitions | Slow reveal/crossfade; video sets atmosphere. |
| Responsive | Mobile 110KB; display type scales down but keeps the serif voice. |
| Conversion | “Explore” and “Book” separated; conservation credibility supports the price. |
| Performance | 29 images with lazy loading; two videos; no framework. |
| Distinctive decision | **Scale and patience** are the motion. |
| What we take | One enormous serif line, then quiet; long-form chapters; images used as evidence, not wallpaper; no dependence on a motion library. |
| What we must not copy | The conservation narrative or the 100px hero at mobile size. Adwoa’s display type must be composed for 360px from the start. |

### 4.5 The Hoxton — https://thehoxton.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Informal, worldly, city-specific, hospitable without being precious. |
| Creative concept | Each hotel is a neighbourhood story; a bold sans voice and local programming make the brand feel social. |
| Hero composition | Fixed header; a 1400 × 650 video begins 150px below the top; an 80px GT America Extended headline, “Welcome to The Hoxton”, sits at x60 y415. |
| Layout grid | Video banner → editorial cards → city/hotel grid → offers → newsletter. |
| Type | GT America Extended Regular 80px display; 14–16px interface; wide, contemporary sans. |
| Colour hierarchy | Warm neutral/brown ground, strong black type, photography as colour. |
| Photography | 52 images, one video; city life, interiors and people, not just rooms. |
| Navigation | Fixed transparent header; destinations/offers/events/blog; a booking utility. |
| Section sequencing | Film → welcome → hotels → offers → newsletter. |
| Scroll | Swiper detected; native page scroll. |
| Hover | Card image scale and link states. |
| Motion transitions | Video plus short fades and card shifts; lively but not a scroll hijack. |
| Responsive | Mobile 120KB; the hero video is re-composed; the headline remains readable. |
| Conversion | “Book” is persistent; offers and newsletter support direct booking. |
| Performance | 52 images and one video; no heavy scroll library beyond Swiper. |
| Distinctive decision | **Hospitality has a personality and a neighbourhood**, not just a room count. |
| What we take | A human, local voice; one bold sans gesture; city context as content; booking remains obvious without dominating. |
| What we must not copy | The exact video-banner/80px-headline formula or the “cool hotel” tone. Adwoa’s voice is quieter and its facts are deliberately incomplete. |

### Hospitality synthesis

Hospitality sites earn atmosphere through **arrival**, not through amenity lists. The best ones use one
full-bleed establishing image or film, then alternate human-scale detail with practical information.
The hero may be large, but it is not repeated at every section. The persistent booking route is quiet
but always available. The weakest pattern is autoplay video and scroll smoothing at the expense of
mobile data and accessibility. For Adwoa, the correct translation is a still, slowly-moving arrival
frame; a short, legible chapter sequence; a sticky room register; and a conversion path that states
terms before asking for a date. Video is not necessary to achieve the cinematic effect.

---

## 5. Architecture references

### 5.1 OMA — https://www.oma.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Intellectual, institutional, deliberately anti-marketing. |
| Creative concept | The practice is presented as a live archive: news, projects and offices in a dense, plain index. |
| Hero composition | Fixed 89px header at y16; the first 1440 × 905 image begins at the top, followed by full-width project/news bands. The page is 24,093px tall and the DOM exposed only five images to the initial capture. |
| Layout grid | Full-width horizontal bands with hard edges and very little ornamental space; content is stacked as a record. |
| Type | Arial W01 16px/18px, weight 500. The radical choice is to use almost no display typography. |
| Colour hierarchy | Black, white, image colour; no accent system. |
| Photography | Few, large, full-width images; the work is the content, not a curated moodboard. |
| Navigation | Fixed header with offices/work/search; little visible navigation in the captured semantic tree. |
| Section sequencing | Announcement → projects → news → archive. |
| Scroll | Native; two CSS animations; no JS library. The page is long because the archive is long. |
| Hover | Text/image links, minimal. |
| Motion transitions | Almost none; the page is a document. |
| Responsive | The long index stacks into a narrower record; images re-crop. |
| Conversion | Contact/office routes rather than a sales funnel. |
| Performance | Only a few images; no framework; long DOM rather than heavy media. |
| Distinctive decision | **Refuse the portfolio-performance convention.** |
| What we take | Architecture can be presented as evidence and record; large images do not need decorative frames; a practice can be confident without a slogan. |
| What we must not copy | The absence of a clear entry point or conversion path. Bantama needs an index with a human invitation, not a cold database. |

### 5.2 David Chipperfield Architects — https://davidchipperfield.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Rigorous, quiet, civic, materially serious. |
| Creative concept | A practice archive organised as a clean editorial record; the work is framed by generous white space and precise captions. |
| Hero composition | A 159px masthead; the first project image is 914 × 719 at x263, inset from both edges rather than full-bleed. The page is 20,454px tall. |
| Layout grid | A strong 12-column grid with a wide central image and narrower offset images at x28/x850; captions sit on the same baseline. |
| Type | DCA Monument Grotesk 42.4px/48.4px, weight 700, tracking −0.85px; body DCA 17.68px. The display is a grotesk, not a serif. |
| Colour hierarchy | Off-white paper, black ink, no accent; the photographs carry tone. |
| Photography | 30 images, 28 lazy; architectural photography with consistent neutral colour and careful horizons. |
| Navigation | Masthead navigation at 335px, 372px wide; sticky secondary nav; projects/people/news/contact. |
| Section sequencing | Current project → news → selected projects → practice. |
| Scroll | Native; no JS animation library; no CSS animations in the captured document. Sticky navigation is the only persistent layer. |
| Hover | Project title/image states; no decorative effects. |
| Motion transitions | Minimal; page changes and image loads are allowed to be quiet. |
| Responsive | The inset grid becomes a single column; captions remain attached to images. |
| Conversion | Contact and people pages; the work does the selling. |
| Performance | 28 of 30 images lazy; no framework. |
| Distinctive decision | **The grid is the identity.** |
| What we take | Precise asymmetric insets, caption discipline, a neutral ground that lets material colour speak, restrained sticky navigation. |
| What we must not copy | The specific DCA grid, typeface or image selection. Bantama must feel more alive than a quiet archive; its challenge is to add motion without losing rigour. |

### 5.3 John Pawson — https://www.johnpawson.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Ascetic, contemplative, materially precise. |
| Creative concept | A single-screen slideshow of architecture; the practice name is the only interface. |
| Hero composition | Eight 1440 × ~970 images laid out horizontally at x0, 1440, 2880…, forming a slideshow. `h1` “John Pawson” is 27px at x22 y19. The document height is 900px. |
| Layout grid | Full-viewport image sequence with a tiny wordmark; no conventional sections. |
| Type | UniversNextPro-Light 27px for both h1 and body; minimal hierarchy. |
| Colour hierarchy | Image colour only; the interface is black on white/transparent. |
| Photography | 16 images; large, quiet, architectural; minimal captions. |
| Navigation | Almost none; the slideshow is the navigation. |
| Section sequencing | One screen, many frames. |
| Scroll | No page scroll; horizontal slideshow transition. |
| Hover | Implicit slide controls; minimal. |
| Motion transitions | 24 CSS animations; slow image changes rather than scroll choreography. |
| Responsive | The same one-screen idea scales down; words remain tiny. |
| Conversion | Contact via a small link; not a commercial funnel. |
| Performance | 16 images; no framework; one screen. |
| Distinctive decision | **One screen can be enough when the work is extraordinary.** |
| What we take | The courage to let a single image hold a viewport; tiny, precise chrome. |
| What we must not copy | The absence of explanatory content or accessible navigation. Pawson can live on reputation; Bantama must show project context, method and a way to start a conversation. |

### 5.4 Adjaye Associates — https://www.adjaye.com/

| Dimension | Observation |
| --- | --- |
| Brand personality | Cultural, diasporic, monumental, intellectually ambitious. |
| Creative concept | A horizontal project reel with large Baskerville captions; the practice is framed as a cultural author. |
| Hero composition | A sticky 120px header; a 1440 × 900 image carousel at the top; project titles in 32px Baskerville at x200 y779. |
| Layout grid | Full-viewport horizontal slides; each project has a title and location on the image baseline. |
| Type | Baskerville/Georgia 32px for project titles; freight-sans-pro 20px/26px for body. Serif authority against a light sans. |
| Colour hierarchy | Black background, white type, full-colour architecture. |
| Photography | 13 images; large-format buildings and cultural spaces. |
| Navigation | Sticky header; search; project index; studio information. |
| Section sequencing | Carousel of projects → selected work → studio. |
| Scroll | Glide carousel with `translate3d`; native page scroll. |
| Hover | Carousel navigation and link states. |
| Motion transitions | Horizontal slide transitions; no scroll-linked scrub detected. |
| Responsive | Carousel becomes a swipeable stack; the large title remains legible. |
| Conversion | Contact and studio routes; the work is the argument. |
| Performance | 13 images; no heavy animation framework detected. |
| Distinctive decision | **A cultural serif gives the practice a voice beyond the photographs.** |
| What we take | The serif/sans contrast, project titles placed on the image, horizontal movement used for a finite project set. |
| What we must not copy | The exact carousel or Baskerville treatment. Bantama’s project set is small and its voice is more direct; a carousel would hide the case studies we need to show. |

### 5.5 Studio KO — https://studioko.fr/

| Dimension | Observation |
| --- | --- |
| Brand personality | Tactile, atmospheric, Franco-Moroccan, material-led. |
| Creative concept | An introductory film stands in for a hero; the studio is sensed before it is read. |
| Hero composition | A 967 × 750 video (`object-fit: contain`) on a black page; no semantic heading or navigation in the captured DOM. Document height 922px. |
| Layout grid | A single cinematic frame, then a minimal index. |
| Type | 10px Arial with 1px tracking; deliberately tiny, and too small for accessible body copy. |
| Colour hierarchy | Black ground, video colour, white/neutral text. |
| Photography | No `<img>` in the captured first view; one intro film. |
| Navigation | Not exposed semantically in the capture; likely overlay/reveal. |
| Section sequencing | Film → studio/projects. |
| Scroll | Seven CSS animations; native page; intro film does the atmospheric work. |
| Hover | Minimal. |
| Motion transitions | Film-led, slow, atmospheric. |
| Responsive | The intro film is letterboxed (`contain`); mobile likely substitutes a poster. |
| Conversion | Project/contact links; not a direct sales funnel. |
| Performance | One video, no image payload; but the film is a hard dependency and the 10px type is an accessibility failure. |
| Distinctive decision | **Atmosphere before information.** |
| What we take | Material atmosphere and the courage to begin with a single moving image (as a still fallback for us). |
| What we must not copy | A video-only opening, 10px body type or hidden navigation. Adwoa’s first frame must be meaningful before any motion or video loads. |

### Architecture synthesis

Architecture sites divide between **archive** (OMA, Chipperfield) and **image object** (Pawson, Adjaye,
Studio KO). The archive model demonstrates rigour, captions and long-form evidence; the image-object
model demonstrates atmosphere and material presence. Bantama needs both: the precision of a project
record and the physical sensation of space. The failure mode is a static grid of equal cards. The
opportunity is to make the grid itself behave architecturally: offset, crop, pin and reveal project
evidence in a controlled sequence. Motion should clarify plan/section/image relationships, not perform
over them.

---

## 6. Cross-industry findings

### 6.1 What premium sites actually do

1. **One argument per viewport.** Lemaire, The Row, Singita and John Pawson do not crowd the first
   frame with a headline, three buttons, a badge and a card grid. They choose one image or one line.
2. **Small chrome, large moment.** Navigation is usually 12–16px; the editorial moment is 40–100px.
   The hierarchy is a deliberate jump, not a smooth scale from 14px to 24px everywhere.
3. **Photography carries colour.** The interface palette is usually ground + ink + one accent.
   Saturated colour belongs to the image or to one functional accent.
4. **One dominant motion idea.** The best sites either use almost no motion (Row, Chipperfield) or a
   single film/scroll choreography (Khaite, Casa Cook). They do not animate every block.
5. **Native scroll is still the default.** 10 of the 15 references had no JS animation library. Sticky
   positioning and CSS transitions do most of the work.
6. **Long-form is acceptable when paced.** Singita (12,674px), Chipperfield (20,454px) and OMA
   (24,093px) are long because the content is long, not because every section is 100vh.
7. **Conversion is persistent but quiet.** Reserve/Book/Search is available without dominating the
   first frame. The commercial path is clearer on the page where the decision is made.
8. **Motion durations are slow and few.** The visible language is 400–1000ms with long eases,
   crossfades, image scale and clipped text, not bouncing cards.
9. **Mobile is re-composed.** Image crops, type scale and navigation change; it is not simply the
   desktop page at 390px.
10. **The best sites have a point of view about what to omit.** Restraint is not the absence of
    design; it is an edited argument.

### 6.2 What is currently overused or risky

- Full-screen video on every hospitality homepage, with no poster or data-saving alternative.
- Lenis/scroll smoothing applied by default, which fights trackpads, keyboards and accessibility.
- 80–100px display type that clips at 360px or pushes the first meaningful action below the fold.
- A full-viewport image per index row, producing a very long page with little informational density.
- Hover-only project previews and cursor-following blobs; unusable on touch and keyboard.
- Tiny 10–12px body copy presented as luxury.
- Repeating the same room or building photograph under different captions.
- “Award-style” WebGL that delays LCP and provides no content.

### 6.3 Motion patterns worth implementing (and their limits)

| Pattern | Evidence | Our use | Limit |
| --- | --- | --- | --- |
| Masked line/word reveal | Khaite, Singita, Hoxton | Hero title and selected chapter headings | One entrance per heading; no repeat on every scroll direction |
| Full-bleed image scale/drift | Khaite, Singita, Casa Cook | Hero still, chapter media | Transform only; 4–8% maximum; disable on reduced motion |
| Clip-path image wipe | Editorial/luxury field; Hoverstat.es examples | Sequence and gallery plates | One wipe per plate, not every image; no layout shift |
| Sticky chapter composition | Ballet de Marseille; Chipperfield sticky nav | Room register, chapter copy | Only where content genuinely benefits; no scroll hijack |
| Staggered editorial rows | Lemaire, Toteme, Belmond | Index and details rows | 40–80ms stagger, short distance, only visible group |
| Page veil/settle | Editorial transitions | Route changes | Under 500ms; must not block navigation; reduced-motion is immediate |
| Hover image reveal | Toteme, Khaite, Adjaye | Project/room register | Keyboard focus parity; never the only way to access content |
| Video | Casa Cook, Hoxton, Singita, Studio KO | Not used for Adwoa’s first milestone | No autoplay dependency; poster/fallback first |

### 6.4 Originality boundaries

We will use references to reason about **composition, pacing, hierarchy and interaction principles**.
We will not:

- copy a site’s layout measurements, typography pairing, palette, imagery, copy or animation curve;
- reproduce a named designer’s or studio’s visual identity;
- download or commit third-party screenshots as design assets;
- use a reference’s proprietary code or animation implementation;
- present a reference as a client project or as our own work.

For Adwoa’s House, the concept is **“First Light: a house revealed through thresholds, light and honest
terms.”** It uses:

- a dark green/bone/brass palette already approved in the Brand Kit;
- an arrival frame built around a threshold and a garden, not a generic hotel bed;
- Instrument Serif for voice and Public Sans for practical detail;
- a room register that reveals one image at a time, not a stack of duplicate full-screen beds;
- a sticky chapter where the image changes while the text holds, so the page feels like a walk through
  the house;
- motion that behaves like light changing: masked title, slow drift, wipe, hold.

None of those decisions is taken from a single reference. They are a synthesis constrained by the
approved direction, the evidence and the assets we are permitted to use.

---

## 7. Recommendations for the three flagship sites

### Adwoa’s House (first rebuild)

**Concept:** A house revealed through thresholds. The first frame is an arrival, not a hotel
advertisement; the rest of the site is a sequence of rooms, light and honest terms.

**Use:**

- **Hero:** full-bleed threshold/garden image, masked two-line title, small brass arrival meta,
  persistent “Check availability”, no video dependency.
- **Home sequence:** one wide establishing image, one offset detail, one portrait; captions on a
  vertical rail; no three identical full-screen beds.
- **Room register:** sticky image preview on desktop; each row changes the image on hover/focus;
  on mobile, compact rows with one image per row and no huge empty screens.
- **Chapter:** sticky copy and a slow image drift; a visible concept-plan note.
- **Conversion:** a terms ledger before the booking notice, with a clear “what happens next” sequence.
- **Spacing:** open but occupied; desktop section padding 80–140px, mobile 56–88px; hero 100svh only
  once; index rows 42–54svh rather than 74svh.
- **Motion:** one arrival choreography, one image treatment, one sticky register, one page settle.
- **Avoid:** repeating room-evening on home, rooms, day and stay; full-screen video; 8,000px mobile
  scroll with 1–2 images per page.

### Nsroma Atelier (after Adwoa review)

Keep the oxblood/cream identity, but replace the “large headline in empty space” with a dense
editorial archive: cloth close-ups, pattern drawings, fitting details, a collection index with sticky
image preview, and process chapters. Motion should be editorial: line masks, image wipes, a precise
hover on each garment entry. The site must read as cultural craftsmanship, not as a minimal gallery.

### Bantama Design Office (after Adwoa review)

Keep the architectural grid, monochrome imagery and vermilion accent. Introduce a project index that
transforms: a wide project image, offset plan/section drawings, a sticky project title, and case-study
chapters that reveal constraint → decision → evidence. Motion should be structural and restrained:
grid shifts, image wipes, drawing overlays, not decorative parallax.

---

## 8. Research conclusion

The creative problem in 3C.4 was not a lack of components. It was that the engine described motion
and composition richly but executed almost none of it, and the flagship content repeated the same
photographs and full-screen patterns. The redesign must therefore be **engine-first and content-led**:
a small, explicit motion vocabulary; scene-level configuration; density controls; a real image plan;
and a page sequence that earns each viewport.

The standard for acceptance is not “more animation”. It is whether a visitor can feel the place,
understand what is known and unknown, and find the next step without fighting the interface. The
browser review, the motion integration tests and the owner’s personal review decide that — not the
test count.
