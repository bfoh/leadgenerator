# Digital Opportunity Finder v7

Business-development platform for a Ghanaian digital agency, launching in Accra and Kumasi. It finds businesses with weak or missing websites, verifies that with documented evidence, scores the opportunity transparently, drafts evidence-based reports and editable GHS proposals, and tracks the deal through a permission-aware CRM into delivery.

**Workflow:** Discover → Prospect research → Website verification → Qualification → Opportunity report → Proposal → Sales pipeline → Project

**Automation (phases 2–6 of the autonomous platform):** research agents — identity, website verification, digital audit, scoring, contact research and validation, and reports — and the Proposal Generation agent work through a durable, budgeted job queue managed in the Automation Center. Workspaces start in *Research only* mode with the outbound emergency stop engaged. Phase 7 adds messaging infrastructure (eligibility gateway, templates, Resend and WhatsApp Cloud API adapters, webhooks) for **sandbox testing only**: nothing can be sent to businesses in this version. See [docs/AUTONOMOUS_PLATFORM_ARCHITECTURE.md](docs/AUTONOMOUS_PLATFORM_ARCHITECTURE.md) and [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md).

**Research campaigns (milestone 2):** Automation Center → Campaigns runs that research pipeline over
prospects the workspace already tracks — by region, district, town and industry, on a manual, daily,
weekly or monthly schedule, with a batch size, a daily target limit and an optional campaign budget.
One prospect can belong to several campaigns, and every membership change is kept in an append-only
history. A campaign never searches Google Places and never contacts anyone. See
[docs/MILESTONE_2_CAMPAIGNS.md](docs/MILESTONE_2_CAMPAIGNS.md).

**Autonomous discovery (milestone 3B, framework only):** campaigns may opt into a permitted discovery
connector with daily/total quotas, a quality gate, an optional spend cap and human review. Only a
deterministic **offline synthetic** provider exists; it is disabled unless
`DISCOVERY_SYNTHETIC_PROVIDER=true` and makes no network call. Provider records are quarantined until a
person promotes them, and contact details are never copied. **No real provider is integrated or
activated.** See [docs/AUTONOMOUS_DISCOVERY.md](docs/AUTONOMOUS_DISCOVERY.md).

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + RLS + Auth) · TanStack Query · Zod · Recharts · Anthropic Claude (optional) · Google Places API (New) (optional)

## Quick start (demo mode)

```bash
npm install
npm run dev        # http://localhost:3000
```

Without Supabase variables the app runs in **demo mode**:
- Records live in this browser's `localStorage` only, starting with the 20 v1–v3 research records (labeled unverified).
- There is no sign-in. Server tools (discovery, website checks, web search, AI reports) are enabled under `npm run dev`, and in production only when `DEMO_SERVER_TOOLS=true`.

> **Billing warning.** Server keys are read from the process environment as well as `.env.local`. If your shell exports `ANTHROPIC_API_KEY` (or another provider key) for other tools, `npm run dev` will use and bill it. Start with `env -u ANTHROPIC_API_KEY npm run dev` if that is not intended.

## Configuration

Copy `.env.example` to `.env.local` (gitignored) and fill in only what you use. Never put a secret in a `NEXT_PUBLIC_` variable.

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `_ANON_KEY`) | public | Enables cloud mode. Apply migration 002 first. |
| `GOOGLE_PLACES_API_KEY` | server | Live discovery via Places API (New). |
| `BRAVE_SEARCH_API_KEY` | server | Optional web search during verification. Automated use also needs a Brave Search budget (Automation Center → Controls). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | server | Optional AI-assisted reports (default `claude-opus-5-5`). The rule-based generator works without it. |
| `DAILY_*_QUOTA`, `*_COST_*_USD` | server | Per-organization daily limits and cost estimates (`DAILY_AI_NOTE_QUOTA` caps AI personal notes for message drafts). |
| `DISCOVERY_SYNTHETIC_PROVIDER` | server | `true` enables the offline synthetic discovery connector for development/acceptance. No real provider is integrated; leave `false` in production. |
| `DEMO_SERVER_TOOLS` | server | `true` only on a private demo deployment. |
| `SIMULATE_EXTERNAL_TOOLS` | server | Test only (set by the Playwright suite): simulated search, DNS and website checks. Ignored when Supabase is configured. |
| `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | server | Optional scheduled automation worker (cloud mode, migration 003). Without them, jobs run while the Automation Center is open. The service-role key is also needed for messaging (dispatch, webhooks, unsubscribe). |
| `MESSAGING_*`, `APP_URL`, `RESEND_*`, `WHATSAPP_*` | server | Optional sandbox messaging (cloud mode, migration 006): only the agency's own `MESSAGING_TEST_RECIPIENTS` can receive messages. See `.env.example` and runbook §12. |

**Google Places key:** enable *Places API (New)* and billing; restrict the key to that API with an IP-address (or no) application restriction — not website referrers, because the key is used only server-side. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Cloud mode (Supabase)

1. Back up the project if it holds v6 data.
2. Run `supabase/migrations/001_private_leads.sql` (only if never applied) and `002_workspace_model.sql`. Migration 002 is additive: v6 `leads` rows are copied into `businesses` on each owner's first sign-in, and `leads` stays in place for rollback.
3. In Supabase Auth enable email (magic link / one-time code) and add `https://<domain>/auth/callback` and `http://localhost:3000/auth/callback` as redirect URLs. Decide whether open sign-up is allowed (see the runbook).
4. Set the two public Supabase variables and restart.
5. Optional, for automation: after a fresh backup, apply `003_automation_infrastructure.sql` (additive and re-runnable; see the runbook). Until then the Automation Center explains that the database needs updating and everything else works as before.
6. Optional, for agent verification, identity decisions and merges, digital audit findings and score overrides: apply `004_research_verification.sql` the same way (runbook §8).
7. Optional, for contact intelligence (contact points with provenance, consent records, the suppression list): apply `005_contact_intelligence.sql` the same way (runbook §9).
8. Optional, for messaging infrastructure (sandbox only): apply `006_messaging.sql` after 005 the same way (runbook §12), then `007_sending_policy.sql` for message policies, quiet hours, limits and the pause switch (runbook §13). Without 007, template messages cannot be approved.
9. Optional, for reply readings, follow-up plans, meeting briefs and proposal change requests: apply `008_response_conversion.sql` after 006 (runbook §14). Without 008, replies are still read by the rules on arrival (opt-outs suppressed, an alert task), but readings are not stored, the Next steps tab and change requests are unavailable, and proposals accept as before.
10. Optional, for research campaigns: apply `009_research_campaigns.sql` after 003, `010_region_records.sql`, then `011_autonomous_discovery.sql` (runbook §16). Migration 009 adds campaigns, membership history, the run log and campaign attribution on jobs; 010 adds the 261-district reference data and optional district/town-level records; 011 adds the discovery quarantine, run log, append-only audit and opt-in campaign controls. Without them, the Campaigns tab explains what is missing and everything else works as before. **011 is not applied to production.**

Each user belongs to an organization with one of six roles — owner, admin, researcher, sales, developer, viewer. Row-level security enforces tenant isolation and role permissions in the database; the UI only mirrors it.

Full procedures: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## What's inside

| Area | Highlights |
| --- | --- |
| Overview | Interested-lead alerts, pipeline and verification KPIs, period activity, verify-next list, overdue actions, tasks, meetings. |
| Discover | Google Places Text Search with a strict field mask, quotas and cost estimates. Search a town (with an optional neighbourhood) or a whole region: all 16 regions of Ghana, with their main towns suggested. The category picker carries the Ghana-wide taxonomy — 30 industry groups and 388 categories, including local trading terms such as chop bar, waakye, kenkey, provision shop, kente, susu and trotro — searchable by group or by phrase, and a whole group can be researched at once. Only the 127 reviewed Google Places Table A type filters are sent; every other category (and any group search or custom phrase) falls back to the text query, so a local business is never hidden by a narrower Google tag. Regulated trades show a licensing note. Results are display-only; "Track as candidate" stores just the Place ID and requires an independent source. "No website listed" is never treated as proof. |
| Prospects | Profiles, identity confidence, duplicate decisions (merge with undo, branch, different business — never automatic), digital audit findings that separate verified issues from growth hypotheses, CSV export (contact fields opt-in, logged). |
| Verification | Manual records with six evidence-based outcomes, plus the Website Verification agent: the 13-step check (licensed search, DNS, robots.txt-respecting site checks), nine classifications, evidence confidence 0–100 with the factors shown, and a review queue for uncertain results. A person's verification is never silently replaced, and absence is never stated as fact. |
| Scoring | Configurable weights; opportunity score separate from confidence; bands 80–100 / 60–79 / 40–59 / 0–39. Manual override with a written justification; the computed score stays visible and changes are audited. |
| Reports | Twelve sections from business overview to the next commercial action. Every statement is labelled verified fact, evidence-supported finding, recommendation, assumption or unknown; facts cite evidence, and invented figures, owners, prices, awards, reviews and guarantees are removed by a deterministic validator. Confidence summary per research area. Written automatically once research is complete (minimum confidence configurable); Claude structured output (model checked first) or the rule-based generator; versioned; usage and cost recorded. |
| Proposals | Industry templates for every sector pick the package and add-ons from the recorded needs (not the largest package) and explain why; a category never upgrades the scope by itself, and the plan records what it rests on (verified website position, recorded needs, report confidence) and says when it is sector guidance only. Regulated trades carry a licensing assumption. Drafts are written automatically once a report supports them. GHS line items (one-time, monthly, annual, optional) priced only from your packages and add-on price list — blank prints "To be quoted" — taxes, payment milestones, versions, approval before issue, validity dates (expired proposals cannot be issued), issue and decision dates, client responses. Branded (logo, accent colour, contact details) print view and browser PDF, plus Markdown export. Client change requests (price, scope, timeline, terms) are decided by owners or admins with a note, and acceptance waits until an agreed change is in a re-approved, re-issued proposal. |
| Automation Center | System health (overdue opt-outs, unknown deliveries, budgets, stuck or failed jobs). Durable job queue (idempotency, leases, retries with backoff, dead letters, cancel, approval), per-agent switches, research-only default mode, pause/resume, outbound emergency stop, per-provider daily/monthly budgets with hard stops, and an append-only agent run log. Prospects carry a workflow state (separate from the CRM stage) with an audited transition history. Eleven agents run today — Business Identity, Website Verification, Digital Audit, Opportunity Scoring, Contact Research, Contact Validation, Opportunity Report, Proposal Generation (drafts only), Outreach Drafting (drafts only), Response Classification and Follow-Up Planning (tasks only), the last four from *Research + proposals* mode; the others are listed with the phase that delivers them. |
| Contacts | Contact details with provenance (source page, provider and licence, who or which agent recorded them), validation (libphonenumber E.164, DNS MX — never mailbox probing), retention dates, append-only consent records (Act 843 written consent), and a workspace-wide hashed suppression list that wins over everything. A discovered contact is shown separately from permission to message it. |
| Outreach | Sandbox-only messaging: email and WhatsApp templates (WhatsApp status from Meta), drafts from a contact point or the Outreach Drafting agent (optional AI personal note grounded in evidence), the deterministic eligibility gateway with stored decisions (consent, suppression, validation, template, message policy, sender, duplicates, per-recipient caps, daily limits, quiet hours and sending days, owner/admin approval), approved-message policies, scheduling, a pause switch that holds every dispatch, an Audit tab, queue, dispatch with compare-and-set and idempotency keys, delivery tracking and replies through signed webhooks, automatic suppression after opt-out replies, bounces and complaints, signed unsubscribe links. Every reply is read (rules, optional AI, a person's correction; an opt-out stays one) and the inbox filters what needs attention. Messages to businesses are blocked in this version; demo mode simulates sends. |
| Next steps | Per prospect: replies and what they mean, a follow-up plan added as tasks (never sends), a printable meeting brief built only from evidence-backed records, and open change requests. |
| Pipeline | 12-stage kanban and table. Outreach stages require recorded permission with a lawful basis; opt-outs block contact. Tasks, meetings, lost reasons. |
| Projects | Accepted proposal → project with milestones, deliverables, invoice and maintenance status. |
| Solution library | 22 website archetypes with tailored design briefs. Digne Suits & More appears only as an internal creative reference, never as a client. |
| Analytics | Pipeline progression, score bands, all 30 industry groups (records, open, qualified at 50+, won, proposal win rate, conversion, average score), with each group drilling down to the exact stored category labels and those labels linking to the filtered prospect list; verification outcomes over time, estimated API cost, proposals, replies by what they mean (flagged under 10 replies), lost reasons; table views and CSV. Records and labels outside the catalogue are kept in a separate bucket so totals reconcile. |
| Settings | Agency profile and proposal branding, proposal defaults and taxes, scoring, grouped focus and custom categories, packages, add-on price list, team, integrations, data import/export/reset. |

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Industry taxonomy: [docs/INDUSTRY_TAXONOMY.md](docs/INDUSTRY_TAXONOMY.md) · Status: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) · Privacy notice: `/privacy`

## Quality checks

```bash
npm run check        # typecheck + lint + unit/database tests + production build + client bundle secret scan
npm run test:e2e     # Playwright: workflows, accessibility (axe, light + dark, keyboard), phone layouts, security
LIVE_INTEGRATION=1 npm run test:live   # opt-in, paid, budget-capped live provider checks (owner approval)
```

Unit and database tests run with the network blocked; the E2E suite and CI run in demo mode with every key blanked, so normal runs can never bill an API. CI is defined in `.github/workflows/ci.yml`. Test strategy and requirement traceability: [docs/TESTING.md](docs/TESTING.md).

Operations: [autonomous discovery](docs/AUTONOMOUS_DISCOVERY.md) · [deployment](docs/DEPLOYMENT.md) · [migration review](docs/MIGRATION_REVIEW.md) · [009/010 review](docs/MIGRATION_REVIEW_009_010.md) · [staging acceptance](docs/STAGING_ACCEPTANCE_009_010.md) · [staging validation](docs/STAGING_VALIDATION_009_010.md) · [monitoring](docs/MONITORING.md) · [incident response](docs/INCIDENT_RESPONSE.md) · [backups](docs/BACKUPS.md) · [security audit](docs/SECURITY_AUDIT.md) · [accessibility](docs/ACCESSIBILITY.md) · [runbook](docs/RUNBOOK.md).

## Ground rules built into the product

- No scraping of Google Maps or any directory; Google Places remains an official, user-initiated API.
- Third-party listing data is not copied into the CRM unless a reviewed source licence permits CRM storage. Google Places stores only the Place ID; autonomous records stay quarantined until promoted, and contact details are never copied.
- No real autonomous provider is integrated. The offline synthetic connector is clearly labelled, disabled unless explicitly enabled, and is not market evidence.
- No bulk messaging or automated outreach. A published phone number is not consent to direct marketing (Ghana Data Protection Act, 2012 — Act 843).
- Website absence is reported only as "not found after documented checks", never as fact.
- AI output is validated; uncited claims are removed, and retrieved web content is treated as data, never instructions.
- API keys stay on the server. The service-role key is read only by the optional scheduled worker route, which scopes every query to one organization; it never reaches the browser.
- Automation defaults to research only. An API key alone never enables outreach; messages to businesses are blocked in this version (only the agency's own sandbox test recipients can receive them) and the emergency stop cannot be lifted.
