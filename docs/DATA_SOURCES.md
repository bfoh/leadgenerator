# Data Sources and Usage Rules

Every provider is implemented behind `DiscoveryProvider` or `WebSearchProvider` (`src/lib/server/providers`) and must declare its capabilities, attribution requirements and retention rules. The UI displays these declarations next to results. Autonomous discovery sources use the richer declaration in `src/lib/domain/discovery-sources.ts`; see [AUTONOMOUS_DISCOVERY](AUTONOMOUS_DISCOVERY.md) for the licence audit and the rule that no real provider is integrated.

## Summary

| Source | Used for | May be stored in the CRM? | Notes |
| --- | --- | --- | --- |
| Google Places API (New) — Text Search | Transient discovery preview | **Place ID only.** Names, addresses, phone numbers, ratings, website fields: display only. | Requires `GOOGLE_PLACES_API_KEY` (server only). Show "Google Maps" attribution. A missing `websiteUri` is **not** evidence that no website exists. No email field exists. |
| Brave Search API | Independent website discovery during verification | Result URL and title the researcher selects as evidence, with timestamp | Requires `BRAVE_SEARCH_API_KEY`. Subject to Brave's API terms; results may not be resold. |
| Manual research (researcher browsing) | Verification evidence, business identity | Yes — researcher-entered facts with source URL and date | The app generates search links; the researcher opens them in their own browser. |
| Direct business submission / referral | Identity, contact, permission | Yes | Record lawful basis and evidence of permission. |
| Website technical check (`/api/verify/website`) | Status code, redirect chain, HTTPS, response time, `<title>`, viewport meta | Yes, as a verification snapshot | One user-initiated GET per check; no crawling. |
| Candidate domain DNS probe | Whether guessed domains resolve | Yes, as evidence ("resolves — ownership unknown") | DNS only, max 8 names per request. |
| Seed research (`src/data/research.json`) | 20 research candidates from v1–v3 desk research (third-party directories, search) | Yes, imported as `legacy_seed` and labeled unverified | Source links may be stale; re-verify before any outreach. |
| Demo discovery provider | UI testing without credentials | Never imported automatically | Fictional names, explicitly labeled "DEMO". |

## Autonomous discovery sources (milestone 3B)

None is integrated. The only connector is the offline synthetic provider (`DISCOVERY_SYNTHETIC_PROVIDER=true`), which creates clearly labelled fake records and never calls the network. The source declarations record the licence evidence for Overture Places, OSM, Foursquare, Yellow Pages Ghana, the Registrar-General, HERE/TomTom and licensed B2B providers. Overture is the strongest licensing candidate (CDLA-Permissive-2.0/Apache-2.0, no ODbL share-alike) but its Ghana coverage is unmeasured and no importer exists. A real provider is activated only after the owner's written approval and the checklist in [AUTONOMOUS_DISCOVERY](AUTONOMOUS_DISCOVERY.md) §7.

## Google Maps Platform rules applied

- Policy: https://developers.google.com/maps/documentation/places/web-service/policies
- No scraping, bulk export, or caching of Places content beyond what the terms allow. The discovery route sets `Cache-Control: no-store` and the client keeps results only in component memory.
- "Track as research candidate" stores the Place ID plus the researcher's own search context (city, category). The business name and all other fields must be confirmed and entered from an independent source; the form requires a source of record.
- The query is the category's search phrase plus the area: `pharmacy in Kumasi, Ghana` for a town, or `pharmacy in Ashanti Region, Ghana` for a whole region when no town is given (`placesTextQuery`). A region-wide search returns the places Google ranks most relevant for that region, 20 per page, not every business in it; search town by town for fuller coverage.
- The profile page can fetch live Place details on demand for display (not stored).
- Search field mask: `places.id, places.displayName, places.formattedAddress, places.websiteUri, places.googleMapsUri, places.businessStatus, places.primaryTypeDisplayName, nextPageToken`. Details (on demand, profile page only) add `nationalPhoneNumber`. Phone numbers are deliberately not requested in bulk search results. `websiteUri` places requests in the Text Search Enterprise tier; usage is metered with an estimated cost (`PLACES_COST_PER_SEARCH_USD`, default US$0.035 per page) and capped by `DAILY_DISCOVERY_QUOTA`.
- The "Track as candidate" form starts with an empty business name and refuses Google-hosted links as the source of record (`google.*`, `goo.gl`, `g.page`).
- Listing "website" fields are classified: no link → "No website listed" (never "no website"), a social or link-in-bio URL → "Social profile listed, no website", anything else → website listed. In the 21 Oct 2026 live test, one of 20 Accra fashion results listed an Instagram profile as its website.

### API key setup (server-side key)

- Store the key only in `.env.local` (local) or the hosting provider's secret store, as `GOOGLE_PLACES_API_KEY`. Never prefix it with `NEXT_PUBLIC_` and never put it in `.env.example`, which is committed.
- In Google Cloud console → Credentials, restrict the key: **API restrictions → Places API (New)** only; **Application restrictions → IP addresses** (your server's egress IPs) or none for local development. Do not use "HTTP referrers" — the key is used by the server, so referrer-restricted keys are rejected (the app explains this error).
- The key travels only in the `X-Goog-Api-Key` request header from the route handler, never in a URL, response, log line or client bundle. Errors from Google are mapped to fixed messages (API not enabled, billing disabled, key invalid, key restrictions, quota) rather than echoing Google's text.
- Verification run on 21 Oct 2026 (project `leadgenerator-512319`): live Text Search for furniture stores in Kumasi (20 results, 13–14 without a listed website) and fashion boutiques in Accra (20 results, 7 without a listed website); the production build and server logs were scanned and contain no occurrence of the key.

## Contact data and permission (Ghana Data Protection Act, 2012 — Act 843)

- A publicly listed number or email is **not** permission for direct marketing.
- Each business has `contact_permission` (`unknown`, `introduction_requested`, `granted`, `declined`, `opted_out`), `lawful_basis`, `permission_evidence` and timestamps.
- Pipeline stages *Contact Authorized*, *Discovery Meeting*, *Proposal Sent* and *Negotiation* require `granted` permission or a business-initiated enquiry. Opted-out businesses cannot enter outreach stages and are flagged on every screen.
- No bulk email, SMS or WhatsApp sending exists. Activities are logged manually.
- Exports (CSV) contain internally owned research fields only; contact fields are excluded unless the user explicitly includes them, and the export is recorded in the audit log.

## Retention

| Data | Default retention |
| --- | --- |
| Discovery results | Google Places: not stored (memory only). Autonomous provider records: staged until `retention_until` (30 days synthetic; 365 days when the source states no limit), then purged |
| Discovery run/audit rows | `discovery_runs` and append-only `discovery_events`; staging rows carry the licence snapshot and deletion deadline |
| Usage records | 18 months (cleanup job planned) |
| Research candidates that never qualify | Review after 12 months; archive or delete |
| Audit events | Life of record; payloads purged on deletion |

Retention cleanup is documented as a planned background job (ARCHITECTURE.md §8); until then use Settings → Data to archive or delete records.

## Ghana regions and districts (migration 010)

Used for district targeting in campaigns and for region/district-level prospect records. It is
reference geography, not business data: no personal data, no provider call, no cost.

| Field | Value |
| --- | --- |
| Dataset | Ghana – Subnational Administrative Boundaries (COD-AB v01) |
| Publisher | OCHA Field Information Services on HDX, from Ghana Statistical Service data |
| Record | https://data.humdata.org/dataset/cod-ab-gha (`cod-ab-gha`) |
| Licence | Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO 3.0), http://creativecommons.org/licenses/by/3.0/igo/legalcode |
| Valid from | 8 March 2021 |
| Reviewed by the source | 30 October 2025 |
| HDX record last modified | 14 August 2026 (checked through the HDX API on 24 October 2026) |
| Source structure | 16 ADM1 (regions), 260 ADM2 (districts) |

**Local changes, as the licence asks us to state:**

1. The region the source calls “Northern East” is called **North East** throughout the app.
2. “Municipal”, “Metropolitan” and “Metropolis” are dropped from district names; `sourceName` keeps the
   original. The source applies them inconsistently and several assemblies changed status in 2025.
3. **Guan District** (Oti Region, capital Likpe-Mate), inaugurated 8 October 2021 as Ghana's 261st
   district, is added. It postdates the source's boundaries, so it has the local code `GH10-GUAN`
   instead of a P-code. Sources: Ministry of Local Government inauguration reported by Graphic Online
   and the Ghana News Agency (October 2021); the 2025–2029 MMDA breakdown (ghanadistricts.com,
   September 2025) lists the same 261 assemblies, with Guan in Oti.

The TypeScript list is `src/lib/domain/districts.ts` (with `DISTRICT_SOURCE` metadata); migration 010
seeds the same rows into `ghana_regions` and `ghana_districts`. `tests/db/campaigns.test.ts` compares
the database copy with the TypeScript list code for code, name for name and source name for source
name, so the two cannot drift silently.

**Verification against the source file (24 October 2026).** The GeoJSON resource
`gha_admin2.geojson` (260 features) from the HDX record was downloaded and compared field by field:

- 260 of 260 ADM2 P-codes are present, with no extras and no omissions.
- All 260 names match after the documented suffix change, and every shortened name's `sourceName`
  equals the source name exactly.
- All 260 region associations match, with the single documented rename “Northern East” → “North East”.
- ADM1 P-codes are `GH01`–`GH16` in the source; they match the region codes in `districts.ts`.
- Guan is the only local record: `GH10-GUAN`, region Oti, capital Likpe-Mate. The source (valid from
  8 March 2021) has 260 ADM2; Guan was inaugurated on 8 October 2021, after those boundaries. The
  Ghana Districts repository lists “261 MMDAs” and includes Guan under Oti. Local code `GH10-GUAN`
  follows the Oti prefix but is deliberately not a number, so it can never be mistaken for a P-code.

Attribution to display where this data is shown: **“District list: Ghana Statistical Service via
OCHA/HDX (COD-AB), CC BY-IGO 3.0; Guan District added; names shortened.”**
