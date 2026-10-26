# Controlled live Google resource test

Prepared 25 October 2026 on `feature/google-business-resource-collector`. **Part A ran once, later on 25
October 2026**: one Place Details request, HTTP 200, counts parsed with no listing content retained, under
a `$0.03` cap that reserved `$0.025` and left no room for a second paid call. No photo request was made,
no search was made, production Supabase was untouched and Social Discovery stays disabled. **Part C has
not run**: the listing has never been shown through the product's own UI, which needs cloud mode. Its
prerequisites, cost and pass conditions are now in
[STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md).

## Run result (Part A, 25 October 2026)

The operator's wrapper (`/tmp/live-place-details.sh`, outside the repository) swapped `.env.local` for a
copy without Supabase variables, ran one filtered test, and restored the file byte-for-byte. The log
recorded exactly one request:

```
[live-trace] request 1: GET https://places.googleapis.com/v1/places/ChIJ... -> HTTP 200
Place Details ChIJ...: photos 1, author credits 1, author avatars 1, author profiles 1,
  photo source links 1, hours 7, provider credits 0, website listed false, phone listed true
Live resource checks reserved $0.025 of the $0.03 budget
Tests 1 passed | 1 skipped
```

The log holds counts, the Place ID and URLs only — no name, address, phone, hours text or photo bytes —
and lives in the private change record, not in this repository. Replay its summary with no network:

```
/tmp/live-place-details.sh --summary /tmp/live-place-details.log
```

The first version of that summary reported "Requests attempted 0" and "Assertions not passed" for this
run, because Vitest colourises its reporter even through a pipe and every anchored `grep` missed. The
wrapper now sets `NO_COLOR` and strips ANSI escapes into a clean copy before counting, counts only
`^\[live-trace\] request ` lines, and reads the verdict from the `Tests` line; the same log now replays
as `1` request, `200 x1`, assertions `passed`.

## What one run costs

The app meters each click from `PLACES_COST_*` and refuses at the daily quota, the per-call maximum and
the workspace budget. The billed Google price is the highest SKU tier any requested field belongs to.

- Place Details, one click: the field mask asks for identity, contact, hours, website, photos and
  attributions, so Google bills the highest tier it touches. Budget at the Enterprise + Atmosphere
  list (`$25/1,000`, i.e. `$0.025`) rather than the app's default `$0.02` estimate.
- Text Search, one click: three results at `$0.035` in the app's estimate; the published Enterprise +
  Atmosphere SKU is `$40/1,000` (`$0.04`). Skip it entirely by taking the Place ID from the free Place
  ID Finder.
- Place Photos, one click: `$7/1,000` (`$0.01`), and only if a photo is previewed.

A full run that previews one photo is therefore about `$0.035`, and the prepared check reserves that
worst case inside the live budget cap. The cap is whatever `LIVE_BUDGET_USD` resolves to at run time,
and `.env.local` decides that, not the command line: see the precedence note in Part A before trusting
the number printed by a run.

## Preconditions

1. A Google Cloud project with billing, **Places API (New)** enabled, and a server API key whose
   application restriction is IP addresses or none (never website referrers). Read the account's
   Google Maps Platform terms, including the EEA adjustments if anyone using the workspace is in the
   EEA; the intended use is managing a sales team's named opportunities.
2. Google Cloud quotas pinned low for the run, for example Places API (New) requests per day `= 20`,
   plus a `$1` budget alert. Application limits do not replace provider limits.
3. Add to `.env.local` (server-only, never `NEXT_PUBLIC_`):

   ```
   GOOGLE_PLACES_API_KEY=<the server key>
   RESOURCE_GOOGLE_ENABLED=true
   PLACES_COST_PER_SEARCH_USD=0.04
   PLACES_COST_PER_DETAILS_USD=0.025
   PLACES_COST_PER_PHOTO_USD=0.01
   SIMULATE_EXTERNAL_TOOLS=false
   SOCIAL_DISCOVERY_ENABLED=false
   LIVE_BUDGET_USD=0.15
   ```

   `LIVE_BUDGET_USD` belongs in that file rather than on the command line: it is the one live-test
   setting `.env.local` is most likely to already contain, and on this machine it overrides the shell
   (see Part A). Keep it at `0.15`, or at least `0.03` for a details-only run and `0.05` with a photo;
   the hard cap in `tests/live/budget.ts` is `0.5`.

   Leave every Supabase variable blank for Part A. Live collector calls are refused in demo mode by
   design (`Live collector calls require an authenticated workspace.`), so Part A calls the provider
   module directly instead of the route.

## Choosing the business

One real Ghanaian business that already has a Google listing and no website. Pick it in Google Maps,
open the listing and confirm there is no Website action; capture the listing URL and a screenshot as
evidence that the absence is Google's own state, not the app's. Take the Place ID from the free
[Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id), which
needs no API key and costs nothing, and paste it into the check. Record the business name only in the
private change record, never in the repo: names, addresses and photos are display-only content.

## Part A — one provider-level request (recommended first step)

This exercises the exact production code paths `googleResourceDetails()` and `googleResourcePhoto()`,
including the field mask, the photo-name prefix guard and the author-credit parsing, without any
database, vault or ZIP involvement.

```
LIVE_INTEGRATION=1 LIVE_PLACES_PLACE_ID=<ChIJ...> LIVE_BUDGET_USD=0.15 \
  npx vitest run --config vitest.live.config.mts tests/live/resource-collector.live.test.ts
```

### `LIVE_BUDGET_USD` on the command line is a fallback, not the cap

`vitest.live.config.mts` reads every `NAME=value` line from `.env.local` and hands the map to Vitest's
`test.env`, whose values take precedence over the same names exported by the shell. That is deliberate,
so a stray shell variable cannot pick the account that pays. `tests/live/budget.ts` then reads
`LIVE_BUDGET_USD` from `process.env` and clamps it to the `0.5` hard cap.

So if `.env.local` already sets `LIVE_BUDGET_USD`, the value in the command above is ignored. On this
machine the file sets `0.01`, below the `$0.025` details reservation, so `reserve()` returns false, both
checks call `skip()` and the run exits **0** with two skipped tests. That spends nothing, but it also
means "the run finished cleanly" can mean "the run never happened".

Recognise it by the line the suite prints first:

```
Live resource checks reserved $0 of the $0.01 budget (worst case; actual usage is lower).
```

A real run prints the reserved amount, then one `console.log` of provider counts per check. A `$0` with
an unfamiliar cap means the cap came from `.env.local`. Verified on 25 October 2026 without spending:
with `LIVE_BUDGET_USD=0.99` in the shell and `0.01` in `.env.local`, a probe test under this config read
`0.01`, while a name absent from `.env.local` (`LIVE_PLACES_PLACE_ID`) did survive from the shell.

Two consequences beyond the budget:

- A stale `LIVE_PLACES_PLACE_ID` or `LIVE_PLACES_PHOTO` left in `.env.local` wins the same way, which
  would check the wrong business or spend a photo request unasked. Keep both out of the file and pass
  the Place ID on the command line.
- Do not "fix" a skip by editing `budget.ts` or the config for the run. Set `LIVE_BUDGET_USD` in
  `.env.local`, or comment its stale `LIVE_*` lines out for the run, and restore the file afterwards. A
  run counts as authorised only once the printed budget line shows the cap that was intended.

Add `LIVE_PLACES_PHOTO=1` to spend one photo request as well; the check reuses the reference from the
details call, so it never pays for a second lookup.

Expected: both checks pass and print counts only, for example
`Place Details ChIJ...: photos 3, author credits 3, author avatars 3, author profiles 3, photo source
links 3, hours 7, provider credits 0, website listed false, phone listed true`. A failing
`website listed false` assertion means Google now lists a website for that business: pick another
prospect, do not loosen the check. Every returned photo must carry a Google Maps link to the source
photo (`googleMapsUri`) and at least one author link or avatar; a failure there is an attribution
defect in the provider mapping, not a reason to relax the assertion. The photo check prints only the
host (`*.googleusercontent.com`, `*.ggpht.com` or `*.gstatic.com`) and confirms no bytes were fetched.

## Part B — the same request through the in-app button

The button path needs cloud mode, so it needs a Supabase database that is not production. Either:

- a local Supabase stack (Docker plus the Supabase CLI; neither is installed on this machine, and
  `supabase/config.toml` does not exist in the repo yet, so this needs `supabase init`, `supabase start`
  and `supabase db reset` to apply 001-016 locally), or
- a separate staging project the owner explicitly authorizes.

Never point this at the production project. [STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md)
prepares that environment: which migrations the page needs, the Storage bucket, the auth settings, the
isolated worktree and the budget stop. Steps once cloud mode is running:

1. Sign in, open **Prospects**, and create or open one prospect for the chosen business. Migration 016
   is not needed for this part: Google viewing works without it, and the Place ID is stored in
   `businesses.places_place_id` from migration 002.
2. Press **Collect Business Resources** and confirm the page loads without a website-generation step.
3. Paste the Place ID and press **Load Google listing** — one billed details request. Check the address,
   phone, hours, the "Website field: Not supplied — independently verify website status" line, the
   source link, the provider credits, and the footer: the official unmodified Google Maps logo (18px,
   accessible name "Google Maps", clear space around it) followed by Terms · Privacy · Preview only.
   The photo tiles must show "Preview photo N" rather than loading images.
4. Press **Save Place ID only**. Reload the page: the Place ID persists, and no other Google field was
   written anywhere.
5. Preview at most one photo — one billed photo request. Confirm the image loads from Google's host, the
   author avatar, name and profile link are visible (or, if Google returns no avatar, the name and
   profile link), the "View this photo on Google Maps" link opens Google's own photo page, and the image
   is not offered in the vault or the ZIP.
6. Leave the listing open for five minutes and confirm the viewer clears itself.
7. Optional, free: run the guarded homepage read for a website the business owns, add one independent
   entry with source, evidence, `independently_verified` and export permission, revoke it, then export
   the kit and confirm `business-resources.json`, `MISSING-RESOURCES.md` and the manifest contain no
   Google address, Place ID or `googleusercontent` URL.

## Stop conditions

Abort and disable `RESOURCE_GOOGLE_ENABLED` if: the Console shows an unexpected SKU or a charge above
`$0.10`; Google returns `SERVICE_DISABLED`, `BILLING_DISABLED`, `API_KEY_*` or 429 (each has a named
message in `placesErrorMessage`); any Google name, address or photo URL appears in a file, a database
row, a vault object or a ZIP; or the listing page shows a website for the chosen business.

## Evidence to keep

The Place ID, the Console's billing/SKU line for each call, the check's printed counts, one screenshot
of the listing preview without a website, and a copy of the exported kit listing. Do not keep the
listing's name, address, phone, hours, photo URLs or bytes in the repository.

## Cleanup

Set `RESOURCE_GOOGLE_ENABLED=false` again, remove the key from `.env.local` (restore the file from its
backup if one exists), reset the Cloud quota and delete the test key if it is single-use. The prepared
check is opt-in only: without `LIVE_INTEGRATION=1` it skips before any import of a provider module, so
the normal suites stay free.

## Attribution and retention obligations (Google's policy page revision of 23 Oct 2026, re-checked 25 Oct 2026)

Google's current wording asks for the **Google Maps** logo (or, where space is limited, the text
"Google Maps") whenever Places content is shown without a Google map, and for each photo the author's
avatar, name and profile link plus a direct link to the source photo on Google Maps.

- Publicly reachable Terms and Privacy pages that name Google's terms: `/terms` and `/privacy` already
  do, and the viewer links to both.
- The viewer renders the official, unmodified Google Maps logo from Google's own
  `Google_Maps_Attribution_Assets.zip` (the dark-grey, non-outlined variant for a plain background),
  served from `public/brand/google-maps-attribution.svg` at 18px high with 10dp clear space at the
  sides and top and 5dp below, and an accessible label reading "Google Maps". The logo is branding,
  not Places content: it is never modified, never imported into a vault and never added to a kit.
  Provenance and checksum: `public/brand/README.md`.
- Third-party provider credits stay next to the content, and each photo shows its author avatar, name
  and profile link plus "View this photo on Google Maps" (`photo.googleMapsUri`), which is Google's
  required route to the source photo and its reporting controls.
- Text is no longer used as the attribution: space is available for the logo, and Google prefers it.
  If a future layout cannot fit the logo, use the text "Google Maps" with `translate="no"`,
  12–16sp, weight 400, colour white/#1F1F1F/#5E5E5E and 4.5:1 contrast instead of a cropped logo.
- Content other than a Place ID may not be cached or stored. The app stores nothing else: `no-store`
  fetches, view-only state, a five-minute clear, no local or session storage, and only the Place ID is
  persisted. Photo references expire, so each preview re-requests one and the UI asks for a reload
  when it fails.
- Remaining gap: no live run has yet shown the real logo, avatars and photo links on a real listing,
  because no paid request has been authorized. Part A's assertions and Part B's visual checks are the
  evidence that closes it.

