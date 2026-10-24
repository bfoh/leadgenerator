# Implementation Plan — Digital Opportunity Finder v7

Status legend: ✅ done and verified · 🟡 working with known limits · ⏳ not started · ⛔ blocked on an external dependency

Last updated 2026-10-21. The "Verification log" at the end records what was actually run.

## 0. Baseline audit of v6 (2026-10-21)

| Area | Finding | Action taken |
| --- | --- | --- |
| Build | `tsc --noEmit` and `next build` passed on Next 15.5. | Kept green throughout. |
| Dependencies | `npm audit`: high-severity PostCSS advisories via Next ≤ 16.3.0-preview. | Upgraded to Next 16.3.8; `npm audit --omit=dev` reports 0 vulnerabilities. |
| Structure | One 13 KB single-page component (`dashboard.tsx`) holding state, CRUD, auth, filtering and layout. No routing. | Split into App Router pages, a data layer and a domain layer. v6 files archived in `.archive/v6-original-2026-10-21.tar.gz`. |
| Data model | Single flat `leads` table keyed `(owner_id, id)`; free-text statuses; manual 0–100 "priority". | Organization-scoped, normalized schema (migration 002). Legacy rows copied; `leads` left intact for rollback. |
| Auth | Supabase session only in browser `localStorage`; no server-side route protection. | `@supabase/ssr` cookie sessions, `proxy.ts` route guard, server-side `getUser()` in route handlers. |
| Authorization | Per-user RLS only; no teams or roles. | Organizations, memberships, six roles, role-aware RLS, invitations. |
| Discovery | Google Places Text Search behind a session. No quota, rate limit or cost tracking. | Provider abstraction, per-org daily quota, rate limiter, `usage_records`. |
| Verification | One free-text outcome field; no history. | `website_verifications` history, evidence, confidence, technical HTTP check, audit trail. |
| Scoring | Manually typed priority. | Transparent, configurable rule engine; opportunity score separate from confidence. |
| Reports / proposals | Deterministic templates, not persisted, free-text fee. | Versioned reports (AI + deterministic fallback) and versioned proposals with line items, taxes, milestones and approval states. |
| Export | CSV formula injection possible; contact fields always exported. | Escaped CSV; contact fields opt-in with a warning; every export logged. |
| Tests / CI | None. | Vitest unit + PGlite database/RLS + Playwright E2E/axe/responsive + GitHub Actions. |

Preserved: the 20 v1–v3 research records (`src/data/research.json`), browser demo mode (v6 browser data is migrated on first load), the "Places results are display-only" rule, the v6 sector-specific recommendation content, and migration `001_private_leads.sql` (never edited).

## Phase 1 — Stabilize ✅
- Next 16.3.8, React 19.3, Tailwind v4, ESLint 9, Vitest, Playwright + axe, TanStack Query, Zod 4, Radix, Recharts.
- Migration `002_workspace_model.sql`: organizations, members, roles, invitations, businesses, verifications, activities, tasks, reports, proposals (+ versions), projects (+ milestones), usage records, audit events; legacy `leads` → `businesses` copy.
- Cookie-based Supabase auth (magic link + one-time code), `/login`, `/auth/callback`, `/auth/signout`, route protection.
- Database tests run the real migrations on PGlite and assert tenant isolation and role checks.

## Phase 2 — Professional interface ✅
- Design tokens for light and dark (WCAG AA contrast checked by axe in both), app shell with sidebar, ⌘K command palette, mobile navigation drawer.
- All navigation destinations exist: Overview, Discover, Prospects (+ profile), Verification queue, Opportunity reports, Proposals, Sales pipeline, Projects (+ detail), Solution library, Analytics, Settings, plus public `/privacy`.
- Overview: state KPIs, period KPIs (7/30/90 days/all), pipeline and website-status charts with table views, verify-next, overdue actions, tasks, scheduled contact, recent activity.
- Analytics: pipeline progression (from logged stage changes), score bands, website checks over time, estimated API cost by provider, proposals by status, lost reasons, categories, cities, usage by operation, date range, CSV export. Chart colours validated for colour-blind separation and contrast in both themes.

## Phase 3 — Discovery and verification 🟡
- ✅ `DiscoveryProvider` abstraction; Google Places API (New) provider; labeled fictional demo provider.
- ✅ Live Places search verified (Kumasi furniture stores, Accra fashion boutiques). Field mask limited to name, address, website, Maps link, business status and type; phone only in on-demand details.
- ✅ Quotas, rate limits, usage/cost records; transient results; "Track as candidate" stores only the Place ID and requires an independent source URL.
- ✅ "No website listed" is labeled as not proof of absence; social links listed as websites are classified separately.
- ✅ Website technical check (SSRF-guarded), candidate-domain DNS probe, manual search links, Brave Search provider.
- ✅ Verification history with audit trail and corrections; duplicate detection; scoring and qualification gates.
- 🟡 Places Details endpoint and Brave Search are implemented and unit-tested with mocked responses but not exercised live.
- ⏳ Additional licensed business-data providers (none selected — requires a commercial agreement).

## Phase 4 — AI intelligence 🟡 (live use ⛔ until `ANTHROPIC_API_KEY` is configured for the app)
- ✅ Evidence pack → Claude structured output (Zod schema, server-side fallback models) → re-validation → citation check → stored version with token usage and estimated cost.
- ✅ Deterministic generator with the same schema; editable reports saved as new versions.
- ⛔ Not run against the live API in this project.

## Phase 5 — Proposals and CRM ✅
- ✅ Configurable packages with no invented prices (blank = "To be quoted"); proposal editor with the 15 required sections (cover + 14), GHS line items (one-time, monthly, annual, optional; development, maintenance, hosting, domain, integration), taxes, payment milestones, versions, draft/approved/sent/accepted/declined/withdrawn.
- ✅ Markdown and print-ready HTML export; PDF via the browser's "Save as PDF".
- ✅ Kanban + table pipeline, permission-gated outreach stages, opt-out blocking, activities, tasks, scheduled meetings, lost reasons.
- ⏳ Configurable pipeline stages (fixed 12-stage model today).
- ⏳ Server-generated PDF files.

## Phase 6 — Client delivery 🟡
- ✅ Accepted proposal → project conversion (phases become milestones); manual project creation for existing clients.
- ✅ Project detail: status, type, contract value, dates, deployment URL, maintenance and invoice status, deliverables, milestones, tasks; status changes logged on the prospect timeline.
- ✅ Solution library with 22 archetypes, tailored design briefs (copy / download Markdown). Digne Suits & More is shown only as an internal creative reference with an explicit "not a client" notice.
- ⏳ File attachments (Supabase Storage bucket + RLS) and client approval history.

## Phase 7 — Production readiness 🟡
- ✅ Settings: agency profile, proposal defaults and taxes, scoring weights (save + rescore all), focus/custom categories, packages and pricing, team and invitations (cloud), integration status, data import/export/reset.
- ✅ Privacy notice (`/privacy`, public) covering Act 843, permission-aware contact, third-party sources and retention.
- ✅ CI workflow (`.github/workflows/ci.yml`), security headers, `docs/RUNBOOK.md`.
- 🟡 Rate limits are in-memory per server instance; demo-mode quotas count per instance.
- ⏳ Background job runner (scheduled re-verification, reminders) — design in ARCHITECTURE.md §8.
- ⏳ Edge rate limiting (Vercel WAF / Upstash), error monitoring, uptime checks.
- ⏳ Invitation emails (invitations are recorded; the inviter shares the sign-in link).

## Milestone 3A — Ghana-wide industry taxonomy (2026-10-24) ✅
- ✅ 30 industry groups and 388 categories in `industry-taxonomy.ts`, containing local trading terms (chop bar, waakye, kenkey, provision shop, kente, susu, trotro). The 20 original labels are unchanged, so saved prospects, reports and proposals keep their existing guidance.
- ✅ 14 new sector tracks (29 total) with report guidance, proposal templates and 13 new solution-library archetypes (22 total).
- ✅ Searchable, grouped, mobile-friendly category picker in Discover, with whole-group research; grouped pickers in Prospects, campaign targeting and Settings focus categories.
- ✅ Campaigns can target a whole industry group in one of their 50 scope entries; a category entry stays exact.
- ✅ Google Places mappings use only the verified Table A identifiers in `places-types.ts` (159 types); categories with no honest mapping, and every custom-term search, fall back to the text phrase.
- ✅ No migration: `businesses.category` is free text (1–80 characters), so the catalogue is a constant-layer change. Migrations 009/010 were not modified or applied to production.
- ✅ `npm run typecheck`, `npm run lint`, 443 unit tests, 165 database tests, 58 desktop + 17 mobile Playwright tests and the production build all pass.
- ⏳ Analytics should roll category breakdowns up to industry groups now that there are 388 labels.
- Details: `docs/INDUSTRY_TAXONOMY.md`.

## Milestone 3A.1 — taxonomy quality and analytics pass (2026-10-24) ✅
- ✅ Analytics reports all 30 industry groups with records, open, qualified (score 50+, the campaign threshold), won (furthest stage, including records lost after a win), proposals accepted/decided, proposal win rate, conversion and average score. All 30 rows are present even when empty, and labels outside the catalogue are kept in a separate bucket so totals reconcile.
- ✅ Drill-down preserved: each group expands to the exact stored category labels (including the 20 legacy labels and workspace-added ones), with record/open/qualified/won counts; each label links to `/prospects?category=…&stage=all`, which now initialises the filter from the URL.
- ✅ Category selection verified in Discover (grouped catalogue + whole-group scope), Prospects (grouped filter of stored labels), Campaigns (grouped target picker), Settings (grouped focus/custom categories) and the Solution Library (category → track → archetype with a mismatch warning).
- ✅ Campaign wildcard validated: a group label matches every prospect in the group (including records filed under the group label), a category entry stays exact, matching ignores case and surrounding spaces, case-variant entries count once, and the 50-entry cap accepts exactly 50 and rejects 51.
- ✅ Google Places audit: 243 categories name a reference type, but only the 127 reviewed pairs in `places-filters.ts` are sent as `includedType`. Venue types (`market`, `bus_station`), narrow tags (`meal_takeaway`, `clinic`, `snack_bar`, `school`) and generic relations (`supplier`, `consultant`) are searched by phrase instead, with the reason recorded; group searches and custom terms never send a type.
- ✅ Lawful-activity guardrails: regulated activities carry the usual regulator and a plain note (shown in Discover, added to proposal assumptions); unlawful activities are absent from labels, search phrases and aliases (the `galamsey` alias was removed; licensed small-scale mining remains).
- ✅ Proposal scope rests on evidence: only a recorded online-selling need selects the ecommerce package (a commerce category no longer upgrades it); `plan.evidence` reports the website check, recorded needs and report confidence; a `guidanceOnly` plan says so in the reasons, the client rationale and the assumptions. Report recommendations no longer carry evidence citations, and sector copy is labelled as guidance to confirm.
- ✅ Regression tests added for industry rollups, legacy labels, campaign targeting/wildcard/limit, Places type filters and phrase fallbacks, compliance notes and evidence-based proposal scope.
- ✅ `npm run check` (typecheck, lint, 462 unit + 165 database tests, production build and client-bundle secret scan) and 80 Playwright tests pass. No migrations were added, changed or applied; no paid API was called.
- ⏳ Nationwide coverage of all 388 categories still needs several campaigns (a campaign is capped at 50 scope entries; one group entry covers a whole industry). Focus categories remain capped at 100.
- Details: `docs/INDUSTRY_TAXONOMY.md`.

## External dependencies still open
| Dependency | Needed for | Owner action |
| --- | --- | --- |
| Supabase project `nshuxeyrcxcnotldvhoh` | Cloud mode, teams, RLS in production | Apply `002_workspace_model.sql` (after a backup), configure auth redirect URLs, then uncomment the Supabase values in `.env.local`. Not done here: it changes a live database and needs the owner's go-ahead. |
| `ANTHROPIC_API_KEY` | AI-assisted reports | Add to the server environment for the app. |
| `BRAVE_SEARCH_API_KEY` | In-app web search during verification | Optional; manual search links work without it. |
| Google Places key restrictions | Cost and abuse control | Restrict the key to Places API (New); add a budget alert in project `leadgenerator-512319`. |

## Explicitly out of scope until requested
Bulk messaging, automated outreach, scraping of any map or directory service, payment collection.

## Verification log (2026-10-21)
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 100 tests in 6 files pass (unit, workflow, server, Places, analytics/settings, PGlite RLS).
- `npm run build` — succeeds; all 28 routes compile.
- `npm run test:e2e` — 35 tests pass: full research → verification → qualification → report → proposal → pipeline workflow; permission gating and opt-out; projects, settings and library; every page in light and dark with no serious or critical axe violations; 13 pages at phone width with no horizontal overflow; API origin and SSRF guards; security headers; status endpoint exposes no secrets.
- `npm audit --omit=dev` — 0 vulnerabilities.
- Live Google Places: 4–5 Text Search calls in total during integration testing (under $0.20 at the configured estimate). The E2E suite and CI blank every paid key.
