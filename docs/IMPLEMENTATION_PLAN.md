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
- ✅ Solution library with 8 archetypes, tailored design briefs (copy / download Markdown). Digne Suits & More is shown only as an internal creative reference with an explicit "not a client" notice.
- ⏳ File attachments (Supabase Storage bucket + RLS) and client approval history.

## Phase 7 — Production readiness 🟡
- ✅ Settings: agency profile, proposal defaults and taxes, scoring weights (save + rescore all), focus/custom categories, packages and pricing, team and invitations (cloud), integration status, data import/export/reset.
- ✅ Privacy notice (`/privacy`, public) covering Act 843, permission-aware contact, third-party sources and retention.
- ✅ CI workflow (`.github/workflows/ci.yml`), security headers, `docs/RUNBOOK.md`.
- 🟡 Rate limits are in-memory per server instance; demo-mode quotas count per instance.
- ⏳ Background job runner (scheduled re-verification, reminders) — design in ARCHITECTURE.md §8.
- ⏳ Edge rate limiting (Vercel WAF / Upstash), error monitoring, uptime checks.
- ⏳ Invitation emails (invitations are recorded; the inviter shares the sign-in link).

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
