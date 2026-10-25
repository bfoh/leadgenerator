# Architecture

## 1. Overview

```
Browser (Next.js client components)
  ├─ TanStack Query cache
  ├─ DataStore interface ──┬─ LocalStore     (demo mode: localStorage, clearly labeled)
  │                        └─ SupabaseStore  (cloud mode: Postgres via RLS-protected Data API)
  └─ fetch → Next.js route handlers (server only)
              ├─ /api/discover            DiscoveryProvider registry (Google Places, demo)
              ├─ /api/verify/website      SSRF-guarded HTTP technical check
              ├─ /api/verify/domains      candidate-domain DNS probe
              ├─ /api/verify/search       WebSearchProvider (Brave Search)
              ├─ /api/reports/generate    Claude structured output → Zod validation
              └─ /api/status              which integrations are configured (booleans only)
Supabase
  ├─ Auth (email magic link / OTP, cookie session via @supabase/ssr)
  ├─ Postgres: organization-scoped tables, RLS on every table, audit triggers
  └─ (planned) Storage bucket for attachments, pg_cron/Edge Functions for jobs
```

**Why a client-side data store?** Supabase's Data API with Row Level Security is the authorization boundary; the browser only ever holds the user's session and the public publishable/anon key. The same `DataStore` interface backs demo mode, so every workflow is exercisable without credentials and is unit-testable. Business rules that must be identical in both modes (scoring, stage gating, activity logging, proposal locking) live in `src/lib/domain` and `src/lib/data/services.ts`, not in components. Privileged operations — anything that spends money, uses a secret, or makes outbound network requests — run only in route handlers.

## 2. Source layout

| Path | Responsibility |
| --- | --- |
| `src/app/(app)/*` | Authenticated application pages (Overview, Discover, Prospects, Verification, Reports, Proposals, Pipeline, Projects, Library, Analytics, Settings). |
| `src/app/login`, `src/app/auth/callback` | Sign-in and PKCE code exchange. |
| `src/app/print/*` | Print-optimized proposal and report documents (outside the app shell). |
| `src/app/api/*` | Server route handlers. |
| `src/proxy.ts` | Session refresh + redirect to `/login` when Supabase is configured. |
| `src/lib/domain/*` | Pure domain logic: types, constants, geography, scoring, pipeline rules, dedupe, report schema and deterministic generator, proposal math and rendering, legacy mapping. No I/O. |
| `src/lib/data/*` | `DataStore` interface, `LocalStore`, `SupabaseStore`, cross-entity `services`. |
| `src/lib/server/*` | Server-only: env, request auth context, rate limiter, usage/quota, safe fetch, providers, AI client. Every file imports `server-only`. |
| `src/components/*` | UI primitives (`ui/`), shell, and feature components. |
| `supabase/migrations/*` | Append-only SQL migrations. |
| `tests/unit`, `tests/db`, `tests/e2e` | Vitest unit, PGlite database/RLS, Playwright end-to-end. |

## 3. Modes

| | Demo mode | Cloud mode |
| --- | --- | --- |
| Trigger | `NEXT_PUBLIC_SUPABASE_URL` / key absent | Both present |
| Persistence | Browser `localStorage` (`dof-v7-demo`) | Supabase Postgres |
| Auth | None; persistent "Demo mode" banner | Required; `/login` |
| Server tools (discovery, website check, AI) | Allowed in `next dev`, or when `DEMO_SERVER_TOOLS=true`; refused in public production demos | Allowed for authenticated members with an appropriate role, subject to quotas |
| Seed data | 20 v1–v3 research candidates preloaded, labeled unverified | Imported on request from Settings → Data |

v6 browser data stored under `dof-cloud-v1-local` is migrated into the v7 demo store on first load.

## 4. Data model (migration 002)

All tenant tables carry `organization_id`. Child rows reference parents through composite foreign keys `(parent_id, organization_id)`, so a row can never point at another organization's record even if a client forges IDs.

```
organizations ─┬─ organization_members (user_id, role)
               ├─ organization_invitations (email, role)
               ├─ businesses ─┬─ website_verifications
               │              ├─ activities (notes, stage changes, calls, meetings, consent)
               │              ├─ tasks
               │              ├─ opportunity_reports (append-only versions)
               │              ├─ proposals ── proposal_versions (trigger-written snapshots)
               │              └─ projects ─── project_milestones
               ├─ usage_records (insert-only from clients)
               └─ audit_events (written only by triggers)
```

Key decisions:
- **Text + CHECK constraints instead of Postgres enums** so statuses can evolve without `ALTER TYPE`.
- **Proposal line items stored as validated JSON** inside `proposals.content`, with denormalized totals (`one_time_total`, `monthly_total`) for analytics. Versions are full snapshots, so line-item history is preserved without a join table.
- **Service packages, scoring weights, focus categories and agency profile** live in `organizations.settings` (JSON, validated by Zod), editable by owners/admins.
- **Audit trail**: a generic `SECURITY DEFINER` trigger records changed columns for businesses, verifications, proposals and projects. Deleting a record purges its earlier audit payloads and leaves a data-free tombstone (supports erasure requests).
- **Legacy `leads`** is untouched. Its rows are copied into `businesses` (`legacy_id`, `legacy` JSON) and, where a v6 verification outcome existed, into `website_verifications`.

## 5. Roles

| Role | Read | Prospects & verification | Reports | Proposals | Projects | Settings / members | Delete |
| --- | --- | --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (not owner role) | ✓ |
| researcher | ✓ | ✓ | ✓ | – | – | – | – |
| sales | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| developer | ✓ | notes/tasks only | – | – | ✓ | – | – |
| viewer | ✓ | – | – | – | – | – | – |

Enforced in RLS (`has_org_role`) and mirrored in the UI (`src/lib/domain/permissions.ts`).

## 6. Scoring

`src/lib/domain/scoring.ts` — pure function `scoreBusiness(business, latestVerification, settings)` returning `opportunityScore`, `confidenceScore`, a band, and per-factor explanations. Factors: website opportunity, business activity, service fit, reachability, expressed interest, budget readiness. Unknown factors contribute a neutral value and reduce confidence rather than inflate the opportunity. Weights are configurable per organization. Hard rules: inactive businesses are capped at 10; opted-out businesses are flagged "do not contact".

## 7. AI reports

1. `buildEvidencePack()` turns stored facts into numbered evidence items (`E1…En`). Free text entered by users or fetched from websites is wrapped as quoted data.
2. The server calls Claude with a system prompt that forbids facts outside the evidence pack and requests JSON matching `reportSchema`.
3. Output is parsed with Zod; every "verified fact" must cite existing evidence IDs — uncited claims are moved to the *uncertainties* list and reported in `validation`.
4. The version is stored with model, token usage and estimated cost. No tools are given to the model, so retrieved content cannot trigger actions.
5. Without `ANTHROPIC_API_KEY`, the deterministic generator produces the same schema.

## 8. Automation and background jobs (migration 003)

The autonomous-platform design is in [AUTONOMOUS_PLATFORM_ARCHITECTURE.md](AUTONOMOUS_PLATFORM_ARCHITECTURE.md) and [AGENT_WORKFLOWS.md](AGENT_WORKFLOWS.md). In short:

- **Queue:** `automation_jobs` in Postgres, changed only through `SECURITY DEFINER` functions: enqueue (idempotency key per organization), claim (`FOR UPDATE SKIP LOCKED`, leases, per-organization concurrency, pause and disabled agents honoured), finish (retry with backoff, deferral that does not use an attempt, dead letter), cancel, retry and approve. Expired leases are recovered on the next claim; outbound work is never retried.
- **Engine:** `src/lib/automation/engine.ts` runs one job at a time with mode, emergency-stop, opt-out and budget checks, a timeout, error classification, idempotent follow-ups, workflow transitions validated by `checkTransition`, and an `agent_runs` record for every run.
- **Stores:** `SupabaseAutomationStore` (RPC) and `LocalAutomationStore` (demo, browser storage) implement the same state machine.
- **Runners:** `POST /api/automation/run` (a member's session and RLS), `GET /api/cron/automation` (optional; `CRON_SECRET` + service-role key, every query scoped to one organization), and the browser in demo mode.
- **Policy:** `automation_settings` per organization: mode (default *Research only*; outreach modes rejected), pause, outbound stop (engaged and not liftable in this version), disabled agents, concurrency, budgets. Budgets are also enforced on the manual paid routes in cloud mode.
- **Workflow state:** `businesses.workflow_state` is kept consistent with opt-outs and closing CRM stages by a trigger; every change is logged in `workflow_transitions`.

## 9. Website Studio and brand intelligence (migration 012)

A prospect becomes a website concept. The Studio records evidence about the site that business has today, so a designer starts from what the page actually shows rather than from guesses.

- **Reading the page:** `POST /api/studio/inspect` uses the same guarded fetch as the Verification agent (http/https only, ports 80/443, private and link-local addresses refused at every hop, robots.txt respected, 8 s timeout, 512 KB cap) but requires only `studio.write`, not `website.verify`: a salesperson may analyse a site without being allowed to verify it. The check counts against the same daily website-check quota. It returns structural facts (`extractPageFacts`), the robots outcome, the technical check and a `simulated` flag — never the page's text.
- **Four classifications, kept apart:** `src/lib/domain/studio.ts` turns a reading into *verified facts* (read from the page, each with its source address), *unknowns* (the page is silent: ask the business), *placeholders* (template, parked or stale content) and *creative suggestions* (ours, `sourceKind: 'system'`, never attributed to the page). A page that cannot be read produces `intelligenceStatus: unavailable` with a reason instead of invented evidence.
- **Append-only evidence:** `studio_observations` has no update policy and an append-only trigger, so a person's decision is a new `studio_reviews` row and a correction is a new analysis run. Every run is numbered and kept; the concept shows one run at a time with the latest selected.
- **Roles:** owners and admins manage concepts and delete them (`records.delete`); members with `studio.write` create, analyse and review; viewers read. Deleting a concept cascades to its evidence; a business deletion cascades to its concepts.
- **Modes:** both modes go through `src/lib/data/studio-services.ts`, so demo mode refuses what cloud mode refuses (one live concept per prospect, no analysis on an archived concept, never more than 100 runs). Migration 012 is not applied to production.
- **Specification:** the six Studio phases, the creative standard (bespoke, premium, cinematic, original, Awwwards-caliber work with researched typography and art direction) and the permission model are in [WEBSITE_STUDIO.md](WEBSITE_STUDIO.md).

## 10. Business Asset Vault, licensing and Brand Kit (migration 013)

The Studio's second phase (milestone 3C.2). The authoritative specification, including the long-term creative standard and the six phases, is [WEBSITE_STUDIO.md](WEBSITE_STUDIO.md).

- **Five permissions, not one:** every asset records `inspect`, `store`, `prototype`, `export` and `publish` separately (`unknown`, `granted`, `denied`, `not_required`). Approval requires permission evidence, a licence where the file is licensed, a current expiry date and a person's name; the database refuses approval without a stamp, rejection and revocation without a reason, and any use while `store` is denied. Publishing is never inferred.
- **Bytes validated before storage:** `src/lib/domain/studio-assets.ts` sniffs magic bytes (PNG/JPEG/WebP/GIF dimensions, PDF, MP4, WOFF/WOFF2/TTF/OTF, plain text only when declared and valid UTF-8), refuses SVG and HTML, caps the file at 25 MB and images at 12,000 px per edge, records a SHA-256 checksum, and builds the private path `{organization_id}/{project_id}/{asset_id}/{name}.{ext}`. Cloud uploads go through `POST /api/studio/assets` (session, `studio.write`, rate limit, concept ownership) so validation happens server-side; demo mode calls the same service with browser storage.
- **Private storage:** one non-public Supabase Storage bucket, `studio-assets`, with a 25 MB and MIME allowlist; storage policies authorise select, insert, update and delete from the first path segment using `is_org_member`/`has_org_role`, so the bucket follows the same tenant and role rules as the tables. Previews use short-lived signed URLs (the CSP allows the Supabase origin for images and media only); export reads bytes with the user's session. Demo mode uses IndexedDB with a memory fallback and never uploads anything.
- **History and review:** `studio_assets` is mutable and audited; `studio_asset_events` is append-only (upload, annotation, approval, rejection, revocation, replacement). Replacing a file creates a new candidate linked to the one it supersedes; revoking keeps the file as evidence, denies prototype, export and publish, and names the Brand Kit versions that referenced it.
- **Remote references stay remote:** `studio_asset_references` records an address, what it showed and where the pointer came from. There is no fetch, cache, inline display or "use this" path; turning a reference into an asset requires the business or rights holder to supply the file with its permission. There is no scraper or URL importer in the application.
- **Brand Kit:** structured content (`logoAssetIds`, palette with hex and role, typography with family/weights/web licence, photography, personality, visual direction, tone of voice) stored as immutable versions; a database trigger checks every referenced asset is approved in the same concept. Approval is an append-only row naming the version and the person, so the approved content can always be reconstructed and an older version cannot be approved after a newer one.
- **Approved export:** `exportStudioAssetPack` builds a ZIP with `manifest.json` (provenance, licence, expiry, attribution, checksums, permissions, approved Brand Kit version) and `ATTRIBUTION.txt`, from approved, unexpired files with export permission only. Rejected, replaced, revoked and expired assets are counted and never read. The ZIP writer is dependency-free and deterministic.
- **Roles and modes:** members read; owners, admins, researchers and sales upload, review, build kits and export; owners and admins delete. Deletion removes the stored object and the record and logs it. Migration 013 is not applied to production.

## 11. Security controls

- Secrets only in server env vars; `server-only` imports guard server modules. The service-role key is read only by the scheduled worker route.
- RLS on every table, composite tenant FKs, `SECURITY DEFINER` functions pinned to `search_path = ''`.
- Route handlers: session check, role check, Zod-validated input, per-user rate limit, per-org daily quota, timeouts, generic error messages.
- Outbound website checks: http/https only, ports 80/443, DNS-resolved private/loopback/link-local addresses refused at every redirect hop, 8 s timeout, 512 KB body cap.
- Response headers: CSP-lite, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- CSV export neutralizes leading `= + - @` characters.
