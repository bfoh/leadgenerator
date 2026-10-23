# Data Sources and Usage Rules

Every provider is implemented behind `DiscoveryProvider` or `WebSearchProvider` (`src/lib/server/providers`) and must declare its capabilities, attribution requirements and retention rules. The UI displays these declarations next to results.

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
| Discovery results | Not stored (memory only) |
| Usage records | 18 months (cleanup job planned) |
| Research candidates that never qualify | Review after 12 months; archive or delete |
| Audit events | Life of record; payloads purged on deletion |

Retention cleanup is documented as a planned background job (ARCHITECTURE.md §8); until then use Settings → Data to archive or delete records.
