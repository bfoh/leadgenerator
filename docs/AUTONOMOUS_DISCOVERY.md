# Autonomous Business Discovery (Milestone 3B)

**Status:** framework implemented and tested against an offline, synthetic provider. **No real provider is integrated, enabled or called.** Migration 011 is written but **not applied to production**; nothing is deployed and no outbound message path was added.

This document is the audit, the source comparison, the architecture and the activation checklist. It is an engineering reading of public terms, not legal advice.

## 1. What existed before this milestone

| Layer | What it did | Why it mattered for discovery |
| --- | --- | --- |
| Discover (`/api/discover`, `server/providers/google-places.ts`) | User-initiated Google Places API (New) Text Search with a strict field mask, daily quota and per-request budget. Results are transient; only the Place ID may be stored. | A lawful interactive source, but it must never become a scheduled harvester. |
| Provider declarations (`domain/discovery-providers.ts`) | Declared permitted uses, attribution and retention per provider. Campaigns could use only `tracked_records`; Google Places was refused for campaigns. | The policy gate already existed; it had no autonomous connector to describe. |
| Campaigns (`domain/campaigns.ts`, `server/campaigns/*`, migration 009) | A saved scope (16 regions, districts, towns, industry groups/categories), schedule, batch size, daily target limit, optional monthly budget. It re-read **tracked** prospects through identity → website → contacts → audit → scoring → report. | Quotas, dedupe (one active research chain per prospect), pause/resume, run log and membership history were reusable. It deliberately never acquired a new business. |
| Source attribution and dedupe | `businesses.source_kind`, `source_url`, `places_place_id`; `domain/dedupe.ts` compares normalised names, city, domain and phone. | New provider records needed their own provenance and a stricter dedupe path. |
| Contact safety | Consent records, hashed suppression, lawful basis, opt-out, validation by DNS only, sandbox-only messaging, outbound emergency stop (migrations 005–008). | Business discovery must not bypass any of it. |
| Budgets and usage | `usage_records`, paid-request ledger (`:sent` markers), provider budgets and hard stops, daily quotas. | A real paid connector must enter this ledger before it is enabled; the synthetic connector costs nothing. |

The gap was precise: the campaign engine could research a business already in the CRM, but nothing could acquire a *new* eligible business lawfully and put it through the same pipeline.

## 2. Source research

Public visibility is **not** a reuse licence. A vendor’s “global coverage” is **not** evidence of Ghana coverage. A source is listed as `not_integrated` when no connector exists, even if its licence looks permissive.

| Source | Ghana coverage | Fields | Commercial CRM storage | Automated discovery | Evidence reviewed (2026-10-24) | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Overture Maps — Places** | Global; Ghana **unmeasured** | Name, category/taxonomy, address, website, phone, email, operating status, provider ID, confidence | **Permitted** by the Places-theme licences | Not built | Places theme is “published under the CDLA Permissive 2.0 and Apache 2.0 licenses. It contains no OpenStreetMap data and carries none of the share-alike obligations of the ODbL.” CDLA-Permissive-2.0 allows use/modification/sharing; the licence text must travel with shared Data; Results are unrestricted. Foursquare-derived rows carry an Apache-2.0 NOTICE. | **Best candidate; not integrated.** Needs a Ghana coverage measurement, a bulk importer, category mapping and owner approval. |
| **Google Places API (New)** | Strong in practice; density unmeasured | Name, address, website, phone, status, type | **No** — only Place ID may persist | **No** | “Content, except for place IDs, cannot be cached or stored unless permitted by agreement.” The existing integration stores only the Place ID. | **Blocked** for autonomous discovery; remains manual and user-initiated. |
| **OpenStreetMap / Nominatim / Overpass** | Community-mapped POIs; completeness unmeasured | Name, category, address, website, phone, status | **Not claimed** | **No** | ODbL: “If you alter or build upon our data, you may distribute the result only under the same license.” Nominatim forbids “downloading all POIs in an area” and systematic queries; bulk users must use an extract or their own instance. A proprietary CRM built from a substantial extract may be a derivative database. | **No connector.** Revisit only with counsel’s written view and a self-hosted extract. |
| **Foursquare Places API** | Global; Ghana unmeasured | Rich place fields | **No claim** without a paid EULA and DPA | **No** | Developer Master Terms (29 Feb 2024) treat the Products and underlying data as Confidential Information even where facts are public, and require destruction/removal of all copies on termination, with audit rights. No clause permitting an indefinite CRM copy was found. | **Not integrated.** A contract could change this; nothing is assumed. |
| **Yellow Pages Ghana** | Advertises 35,533 listings across every region (publisher claim, unaudited) | Directory listings | **No** | **No** | Terms (24 Oct 2026) prohibit “automated tools, bots, scrapers, crawlers, or similar data-gathering methods” and using the service “to build, populate, or maintain any commercial database or directory that competes with Yellow Pages Ghana”. | **Blocked.** Only a signed data licence could change it. |
| **BusinessGhana / GhanaYello and similar directories** | Advertised; unmeasured | Directory listings | **No claim** | **No** | Terms pages were unavailable or returned HTTP 403 during review; no permission is inferred. | **Not integrated.** A written licence and technical access method are prerequisites. |
| **Registrar-General’s Department (Ghana)** | National register in principle | Legal entity name, status, registered address | **Agreement required** | **No** | The public site describes registration and estate services; no extract or permission was obtained. A public register is not a public API. | **Not integrated.** Needs a data-sharing agreement, lawful-basis review and privacy assessment. |
| **HERE Places / TomTom Search / Mapbox** | Global; Ghana unmeasured | Place fields | **Unverified** | **No** | HERE platform terms returned HTTP 503; TomTom’s developer terms are script-rendered and did not expose their text. No permission is inferred. | **Not integrated.** Quote, EULA and storage review required. |
| **Licensed B2B contact providers (Apollo, ZoomInfo and similar)** | Global contact databases; Ghana coverage unverified | People/company contact data | Contract-specific | **No** | Apollo Terms (10 Aug 2026) grant paid use and put personal-information compliance on the customer (Sections 6 and 12); they do not establish Ghana coverage or a marketing basis. | **Not integrated.** This belongs to contact intelligence, behind consent, suppression and outbound safeguards. |
| **GhanaPostGPS / Ghana Statistical Service** | National addresses / statistics | Digital addresses; aggregate statistics | Not a business directory | **No** | GhanaPostGPS is an addressing system; GSS publishes statistics and microdata, not a public establishment list under a CRM-reuse licence. | **Not business-discovery sources.** Not evaluated further. |

### 2.1 Licensing conclusions

1. **Overture Places is the only source found whose licence clearly permits commercial CRM storage without ODbL share-alike.** It still needs a coverage/quality measurement and a connector. It is *not* “integrated” because a licence permits something.
2. **Google Places cannot be scheduled.** The existing field mask and Place-ID-only retention are the maximum permitted use.
3. **OSM is not a free shortcut.** ODbL share-alike plus Nominatim’s bulk prohibition make it unsuitable for this CRM without a legal review and a self-hosted extract.
4. **Ghana directories are not open data.** Yellow Pages explicitly prohibits the exact use this milestone would make of it; a commercial licence is the only route.
5. **Contact data is a separate question from business identity.** A lawful right to store a business name and address does not create a right to email or call it. The source declaration separates `crm_storage` from `contact_storage` and `marketing`.

## 3. Architecture

### 3.1 The contract

- `src/lib/domain/discovery-sources.ts` declares each source: status (`available`, `synthetic`, `not_integrated`, `blocked`), fields, permitted uses, retention, attribution, licence evidence, access mode, cost and limits.
- `src/lib/domain/discovery-framework.ts` validates a request, binds a pagination cursor to the scope, scores quality/identity, canonicalises categories, detects duplicates, and defines campaign controls. It is browser-safe and never calls a provider.
- `src/lib/server/discovery/provider.ts` is the connector interface: `isEnabled()`, `search(query, signal)`, a declaration and a typed error with retry/billing information.
- `src/lib/server/discovery/offline-provider.ts` is the deterministic synthetic provider. It generates records from the Ghana district reference list across all 16 regions, with `.example` websites and no phone or email.
- `src/lib/server/discovery/registry.ts` contains **only** connectors that exist. No placeholder adapter is registered.
- `src/lib/server/discovery/service.ts` performs the permission gate, provider rate/daily limits, retry, one-page search, staging, duplicate suppression, optional high-confidence promotion, review decisions, retention purge and audit events.

### 3.2 Permission gate

A run happens only when **all** of these are true:

1. The source declaration permits `unattended_search` and `crm_storage`.
2. A connector exists and its status is not `blocked` or `not_integrated`.
3. Server configuration enables that connector (`DISCOVERY_SYNTHETIC_PROVIDER=true` for the synthetic one).
4. The campaign is active, due, not paused, within its daily/total quotas, and within its discovery spend cap.
5. The database accepts the campaign provider (`research_campaigns_discovery_provider` refuses Google Places and `tracked_records` when discovery is enabled).

The decision is made again at promotion time: a staged record cannot become a business if its source no longer permits CRM storage or its connector is disabled.

### 3.3 Pagination, retries, cost and quotas

- A page is capped by the source’s `maxPageSize` (20 for the synthetic connector) and by the campaign’s remaining daily/total allowance.
- The cursor is `v1:<offset>:<fingerprint>`. The fingerprint covers the source, regions, districts, towns and categories — **not** page size or quality threshold, so a shrinking daily allowance or a quality change does not strand the remaining pages.
- A cursor from another scope is refused; a provider page is never silently applied to a different search.
- Retry is limited to three attempts, 100/300 ms apart, and only for errors marked retryable. Permission and invalid-cursor errors are never retried.
- Provider rate and daily limits are checked from `discovery_runs`; campaign quotas are checked by the orchestrator. A campaign’s discovery spend cap is checked against recorded run cost (the synthetic connector is free).
- A failed page writes a failed run and an audit event; it does not create targets. The next scheduled tick retries within limits.

### 3.4 Staging and promotion

Provider records live in `provider_discovery_records` until a person promotes them, with normalised identity/location fields, provider ID, quality and identity scores, review reasons, source URL, a licence snapshot, `retrieved_at`, `retention_until`, a one-way `status` (`pending_review` → `promoted` or `rejected`) and an optional `business_id`. Provider fields are immutable after staging.

Promotion creates a `businesses` row with `source_kind = 'provider_discovery'`, `provider_key`, `provider_record_id` and notes naming the provider and licence. **It deliberately does not copy the provider website, phone or email** into the canonical CRM: a listing is not proof that contact is permitted, and a website still needs independent verification. Contact points are never created from provider data.

Automatic promotion is off by default (`requireReview = true`). If a workspace turns review off, a record must still score at least 80, have no review reasons (known category, valid location, usable name, not permanently closed, not low-confidence) and meet the campaign threshold. Unknown categories and uncertain identities always wait for a person.

### 3.5 Deduplication

A record is skipped when the same `(provider, provider_record_id)` is already staged or imported; the exact website URL is already recorded (domain alone is too broad: a provider or franchise can host many businesses); the phone’s last nine digits match; or the normalised name matches and any district or town matches.

The database also enforces a unique provider record per workspace and a unique provider ID on `businesses`. Duplicate checks warn rather than merge; identity merges remain a person’s decision.

### 3.6 Retention

- Each source declares a retention period (30 days for the synthetic provider; no contractual limit for Overture, with an internal 365-day default when none is stated).
- The worker calls `purge_expired_discovery_records(org)` before a discovery tick. Expired staging rows are deleted; audit events survive because they deliberately have no foreign key to the record.
- A promoted business keeps its minimal provider provenance; the staging copy is still subject to retention.
- A personal-data erasure request under Ghana’s Data Protection Act 2012 still applies independently of any provider retention period.

## 4. Campaign integration and controls

`research_campaigns` gains an opt-in discovery block, disabled by default:

| Setting | Default | Enforcement |
| --- | --- | --- |
| `discovery_enabled` | `false` | Migration check refuses Google Places and `tracked_records`; the orchestrator checks the connector and permission gate again. |
| `discovery_daily_limit` | 25 | Sum of `records_fetched` in today’s `discovery_runs`; no page is requested when exhausted. |
| `discovery_total_limit` | 100 | `discovered_total` plus `discovery_remaining()`; also bounds auto-completion. |
| `discovery_quality_threshold` | 60 | A record below it is rejected, logged, and never staged. |
| `discovery_require_review` | `true` | Pending records wait for an owner/admin. Turning it off still requires score ≥ 80 and no review reasons. |
| `discovery_spend_cap_usd` | `null` | Checked against recorded `discovery_runs.spend_usd`; the synthetic provider costs 0. |
| `discovery_cursor` | `null` | Scope-bound cursor; reset when the scope or a discovery rule changes. |
| `discovery_exhausted` | `false` | Set when the provider returns its last page; prevents an endless restart of the same scope. |
| `discovered_total` | 0 | Provider records fetched, including duplicates and rejected rows. |

The existing campaign controls still apply: manual/daily/weekly/monthly schedule in Africa/Accra, batch size, daily research target limit, monthly campaign budget (now including discovery spend), cross-campaign dedupe, pause/resume/complete/cancel, and the append-only run log. A campaign auto-completes only when its research work is finished, no discovery record awaits review, and either the provider is exhausted or the total allowance is used.

The **review queue** is in the campaign detail. Owners and admins can promote a record (creates a prospect, with provenance) or reject it (a terminal decision). A promoted prospect is picked up by the campaign's next run through the normal research chain. Every decision writes `discovery_events`; the log cannot be edited or deleted.

### 4.1 Progress and audit

`discovery_runs` records one provider page per tick: query scope, pages, fetched/staged/duplicate/rejected/promoted counts, spend, error kind and note. `discovery_events` records `started`, `page_fetched`, `record_staged`, `duplicate_skipped`, `record_rejected`, `record_promoted`, `quota_reached`, `provider_refused`, `failed` and `completed`. Both are visible to workspace members; only the service role writes them.

## 5. Contact intelligence safeguards

Business discovery and contact intelligence remain separate capabilities:

- No source in this milestone has `contact_storage` permission. The synthetic provider supplies no phone or email. Overture’s declaration permits business identity and location but **not** contact storage or marketing.
- Staging can hold a phone/email column, but the service writes them only when a source declares `contact_storage`; promotion never copies them into `businesses` or creates a contact point.
- A verified website is still required before contact research, and the existing contact agent keeps its own purpose, provenance, retention, lawful-basis, consent, suppression and review rules.
- No message is drafted, approved or sent by discovery. The outbound emergency stop and sandbox-only messaging are untouched.
- A published phone number or email is not consent to market to it (Ghana Data Protection Act 2012, Act 843; WhatsApp Business Messaging Policy).

## 6. Testing and verification

Added:

- `tests/unit/discovery.test.ts` — declarations and blockers, Overture/OSM/Yellow Pages evidence, request validation, scope-bound cursors, quality/identity scoring, category canonicalisation, duplicate rules, the offline generator, staging, idempotent repeats, promotion provenance, automatic-promotion gate and campaign input rules.
- `tests/unit/campaign-orchestrator.test.ts` — a synthetic campaign stages a page, respects the daily discovery quota, promotes a record, and researches it on the next tick; a disabled connector skips safely.
- `tests/db/discovery.test.ts` — migration 011 schema, RLS, tenant isolation, immutable provider fields, one-way review, promoted-business requirement, append-only audit, retention purge, provider uniqueness and campaign provider constraints.
- Existing campaign rollback/staging tests now roll back 011 first, and the independence tests skip 011 alongside 009.

The full suite must pass with **no network** (`tests/setup/no-network.ts`). No test may call a real provider; the synthetic adapter is in-process and free.

## 7. Activating the first real provider (not done)

Do not enable a real provider until every item is complete and the owner has approved it in writing.

1. **Choose and contract.** For Overture: confirm the release licence and preserve the attribution/NOTICE. For a directory or B2B vendor: sign a data licence/DPA that expressly permits CRM storage, defines contact use, retention and deletion.
2. **Measure Ghana coverage.** Count records by region, category and field completeness on a named Overture release (or a vendor sample). Record the query, release date and results in this document. Do not infer density from a global total.
3. **Map categories.** Map the provider taxonomy to the 388-category Ghana catalogue. Unknown categories become `Other` and require review; never silently widen a category.
4. **Build the adapter.** Implement `DiscoveryProviderAdapter` with honest capabilities, attribution, retention, cost and limits. No scraping, no browser automation, no circumventing rate limits. Bulk Overture data needs a Parquet importer, not a fake API.
5. **Enter the paid-request ledger.** If the provider charges, route every call through `paidCall`/`usage_records`, add a budget key and hard stop, and reserve the worst case before sending.
6. **Set the declaration.** Add the reviewed licence URL/date and exact evidence; set `unattended_search`/`crm_storage` only if the licence permits them. Leave `contact_storage` and `marketing` off until separately reviewed.
7. **Gate enablement.** Replace the synthetic-only registry entry with the real adapter behind an explicit server flag. Default off. Production activation needs an owner decision, not an environment accident.
8. **Privacy and deletion.** Complete a Ghana Act 843 assessment for business-contact data; implement erasure and retention. Keep contact intelligence separate.
9. **Test and stage.** Unit, database, cross-workspace isolation and failure recovery; a named staging run with quotas and review on; no outbound messages. Record results.
10. **Apply migration 011** through the runbook and monitor the first runs. Do not run a production migration or a paid call without explicit approval.

## 8. Known limits and deliberate non-goals

- Only the synthetic connector exists. It is not market evidence and must stay disabled in production.
- Overture’s Ghana coverage, category accuracy and duplicate rate are unmeasured; its licence is permissive but a bulk importer and category mapping do not exist yet.
- The review queue is per campaign and capped at 100 rows in the detail view; the review API is owner/admin only.
- Discovery fetches one page per due tick. A very large scope progresses slowly by design; quotas and rate limits are the point.
- A campaign completed after its total discovery allowance is used does not automatically reopen when the scope is edited; create a new campaign or raise the allowance before it completes.
- The quality score is deterministic and explainable, not a machine-learning judgement. It measures identity completeness, not commercial fit.
- No provider record is merged automatically. Identity merges remain an explicit owner/admin action in the existing workflow.
- Google Places remains manual. The database and application both refuse it as a campaign provider.




