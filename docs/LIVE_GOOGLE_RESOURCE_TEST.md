# Controlled live Google resource test

Prepared 25 October 2026 on `feature/google-business-resource-collector`. **Not executed.** No paid
request was made, no live key was used, production Supabase was untouched and Social Discovery stays
disabled. This is the procedure for one controlled run against one real Ghanaian business.

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
worst case inside the `$0.15` live budget cap.

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
   ```

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

Add `LIVE_PLACES_PHOTO=1` to spend one photo request as well; the check reuses the reference from the
details call, so it never pays for a second lookup.

Expected: both checks pass and print counts only, for example
`Place Details ChIJ...: photos 3, author credits 3, hours 7, provider credits 0, website listed false,
phone listed true`. A failing `website listed false` assertion means Google now lists a website for
that business: pick another prospect, do not loosen the check. The photo check prints only the host
(`*.googleusercontent.com`, `*.ggpht.com` or `*.gstatic.com`) and confirms no bytes were fetched.

## Part B — the same request through the in-app button

The button path needs cloud mode, so it needs a Supabase database that is not production. Either:

- a local Supabase stack (Docker plus the Supabase CLI; neither is installed on this machine, and
  `supabase/config.toml` does not exist in the repo yet, so this needs `supabase init`, `supabase start`
  and `supabase db reset` to apply 001-016 locally), or
- a separate staging project the owner explicitly authorizes.

Never point this at the production project. Steps once cloud mode is running:

1. Sign in, open **Prospects**, and create or open one prospect for the chosen business. Migration 016
   is not needed for this part: Google viewing works without it, and the Place ID is stored in
   `businesses.places_place_id` from migration 002.
2. Press **Collect Business Resources** and confirm the page loads without a website-generation step.
3. Paste the Place ID and press **Load Google listing** — one billed details request. Check the address,
   phone, hours, the "Website field: Not supplied — independently verify website status" line, the
   source link, the provider credits, the "Google Maps · Terms · Privacy · Preview only" line, and that
   the photo tiles show "Preview photo N" rather than loading images.
4. Press **Save Place ID only**. Reload the page: the Place ID persists, and no other Google field was
   written anywhere.
5. Preview at most one photo — one billed photo request. Confirm the image loads from Google's host,
   the author credit and the "Photo source" link are visible, and that the image is not offered in the
   vault or the ZIP.
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

## Attribution and retention obligations (confirmed against Google's published policy, 23 Oct 2026)

- Publicly reachable Terms and Privacy pages that name Google's terms: `/terms` and `/privacy` already
  do, and the viewer links to both.
- Anything shown without an embedded map must carry Google attribution and any third-party provider
  credits near the content; photos additionally need their author credits. The viewer shows the
  provider credits, per-photo author credits, a source link and a "Photo source" link.
- Content other than a Place ID may not be cached or stored. The app stores nothing else: `no-store`
  fetches, view-only state, a five-minute clear, no local or session storage, and only the Place ID is
  persisted. Photo references expire, so each preview re-requests one and the UI asks for a reload
  when it fails.
- Known gap before public use: the viewer renders a "Google Maps" text chip, not the official Google
  logo. Google's policy expects the logo when Places data is displayed without a map, so the logo
  asset and its placement need the owner's approval before the feature is used outside internal
  research.

