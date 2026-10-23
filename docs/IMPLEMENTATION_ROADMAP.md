# Implementation Roadmap — Autonomous Platform

Status legend: ✅ done and verified · 🟡 built, limited verification · ⏳ not started · ⛔ blocked on an external dependency

**Update 2026-10-23:** the owner applied migrations 003–008 to production, and the read-only `supabase/checks/after-migrations.sql` passed there. Phase notes below that say a migration is not applied describe the state when that phase ended. The phases stay 🟡 until their cloud paths and live providers have run for real.

The v7 history is in [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md). Each phase ends with a report: functionality, files, migrations, environment variables, tests, results, API cost, missing credentials, security notes, remaining work.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Audit and design documents | ✅ |
| 2 | Job infrastructure, orchestration engine, workflow state machine, Automation Center, budgets, pause/resume, emergency stop; scoring and report agents | 🟡 |
| 3 | Business identity, website verification agent (licensed search, DNS, HTTP), digital audit findings, score overrides with justification | 🟡 |
| 4 | Contact intelligence: contact points with provenance, validation (libphonenumber, MX), consent records, suppression list, Contacts page | 🟡 |
| 5 | AI opportunity reports: 12-section schema with labelled statements, auto-generation after verification within budget | 🟡 |
| 6 | Proposal auto-drafts from industry templates, approval before issue, branded exports | 🟡 |
| 7 | Eligibility gateway, outreach drafting, email and WhatsApp Cloud API adapters in sandbox/test mode, webhooks | 🟡 |
| 8 | Sending policies behind the gateway: approved-message policies, quiet hours and sending days, daily limits, per-recipient caps, safe scheduling, pause switch, audit trail; Outreach Drafting agent with an optional AI personal note. Sandbox only: sending to businesses stays ⛔ on legal review, a verified domain and a WhatsApp Business Account | 🟡 |
| 9 | Reply classification (rules on every reply, optional AI, people's corrections; an opt-out stays one), interested-lead alerts, CRM updates, follow-up plans as tasks, meeting briefs, proposal change requests decided by owners/admins, acceptance guard, client conversion; Response Classification and Follow-Up Planning agents | 🟡 |
| 10 | Hardening: requirement-traced test suite, job reliability soaks, cost bounds and opt-in live checks, security audit (CSP, bundle secret scan, redacted logs), accessibility review, migration review with a read-only preflight, System health, incident response, backups, deployment guide, runbooks | 🟡 |

## Phase 1 — Audit and design ✅ (2026-10-22)

- Repository audited against the brief (AUTONOMOUS_PLATFORM_ARCHITECTURE §2).
- Provider terms reviewed: Google Places policies, Brave Search API terms (1 Sep 2026), WhatsApp Business Messaging Policy, Resend acceptable use, Gmail/Yahoo sender requirements (secondary), Ghana Act 843 s.40 and L.I. 1991 (secondary sources).
- Orchestrator chosen: Postgres-backed queue in Supabase executed by the app's engine (architecture §4).
- Documents: AUTONOMOUS_PLATFORM_ARCHITECTURE, DATA_PROVIDER_POLICY_MATRIX, AGENT_WORKFLOWS, CONTACT_PERMISSION_MODEL, OUTREACH_COMPLIANCE, COST_CONTROL, this roadmap.

## Phase 2 — Automation infrastructure 🟡 (2026-10-22)

Scope:
- Migration `003_automation_infrastructure.sql`: `automation_settings`, `automation_jobs`, `agent_runs`, `workflow_transitions`, business workflow columns, queue functions, guards, RLS. Tested on PGlite; **not applied to production**.
- Engine (`src/lib/automation`): agent registry, mode and budget checks, timeouts, retries with backoff, idempotent follow-ups, dead-letter, cancel, pause, emergency stop, tracing, agent-run records.
- Queue backends: Supabase (RPC) and local (demo, browser).
- Runners: foreground (`POST /api/automation/run`), scheduled (`GET /api/cron/automation`, disabled until `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are set), demo (browser).
- Automation Center: overview, jobs and inspector, agents, controls (mode, pause, emergency stop, concurrency, budgets), run log.
- Prospect profile: workflow state, "Automate research", agent runs and transitions in the timeline.
- Agents: Opportunity Scoring, Opportunity Report (rule-based; AI only with an Anthropic budget).
- All outbound sending disabled.

Verification:
- Unit tests (engine, stores, budgets, workflow rules, agents) with simulated tools; migration 003 on PGlite (guards, RLS, queue functions, leases, service-role claim, workflow triggers, backfill, re-run, rollback); Playwright in demo mode (Automation Center, controls, prospect automation, axe in light and dark, phone layouts). No paid API was called.
- 🟡 because the cloud path has not run against a real database: migration 003 is **not applied to the production Supabase project** (needs the owner's approval after a backup; RUNBOOK §7), so `SupabaseAutomationStore`, `POST /api/automation/run` and the scheduled worker are verified only by type checks, PGlite tests of the SQL they call, and unauthenticated endpoint checks (401/503).
- Not built in this phase: per-provider rate limiting beyond the existing per-user limits and daily quotas, and job-level tracing beyond `trace_id` across jobs and runs.

## Phase 3 — Identity, verification and audit 🟡 (2026-10-23)

Also in this phase: Next.js upgraded to 16.4.2 (`npm audit --omit=dev`: 0 vulnerabilities).

Scope:
- Migration `004_research_verification.sql`: agent fields and review workflow on `website_verifications` (agent rows immutable except review fields), identity columns on `businesses` (alternate names, branch, merged-into, identity confidence, score override with justification), `identity_links`, `audit_findings`, `merge_businesses` / `undo_business_merge`, guards, RLS, audit triggers. Rollback script included. Tested on PGlite with and without 003; **not applied to production**.
- Licensed search behind a clean interface: Brave Search provider (transient use, paced requests), daily quota, and an explicit budget for automated use; labelled simulated provider for tests only.
- Website checks: SSRF guard at every hop, robots.txt (RFC 9309) for every origin in the redirect chain on automated checks, size and time limits, page signals parsed as text (no JavaScript), phone numbers and emails reduced to match results and never stored.
- Agents: **Business Identity** (identity confidence, duplicate detection; pauses for a person on likely duplicates), **Website Verification** (13 steps, ≤ 4 searches, nine classifications, evidence confidence with factors, negative-verification guards, temporary vs persistent failures, disagreement with a person's verification), **Digital Audit** (evidence-backed findings, verified issues separate from growth hypotheses). Pipeline: identity → verification → audit → scoring → report.
- Review queue: Verification queue → *Needs review*; Confirm / Reject (with reason) on each agent result; rejected results never count; a person's recent verification is never replaced by an agent.
- Identity workflow: Identity card (confidence factors, possible duplicates), manual **merge** (owner/admin; non-destructive, contact restrictions carry over) and **undo merge** (split), branch and different-business decisions.
- Digital audit tab: accept, dismiss with reason, reopen; superseded history.
- Score override with justification (≥ 20 characters), computed score kept visible, audited history.
- Verification history per prospect shows each agent run's queries, sites checked, steps and factors.

Verification:
- `npm run check` — typecheck, lint, 201 Vitest tests (11 files: unit tests including the brief's six website-verification scenarios with simulated providers; the fetch layer with a scripted fake network — robots.txt 4xx/5xx/network failure, per-origin robots across redirects, private-address redirects, redirect cap; and migration 004 on PGlite: constraints, role guards, merge and undo atomicity, RLS, re-run, rollback), production build.
- Playwright, demo mode with `SIMULATE_EXTERNAL_TOOLS=true`: 47 tests, including automated verification with evidence factors and audit, the review queue, merge and undo, and score override. No request left the test server.
- Cloud-mode dev server (without 004): verification routes refuse unauthenticated calls (401), pages redirect to sign-in, simulation is disabled because Supabase is configured.
- API cost: $0. No live Brave, Google or Anthropic call was made by tests.
- 🟡 because:
  - migration 004 is not applied to the production project (RUNBOOK §8 — owner's approval after a backup), so the Supabase store's merge RPCs, review updates and audit findings are verified only by PGlite tests of the SQL and type checks;
  - no Brave Search key is configured, so live search is untested; the website-check path (robots.txt, redirects, fetch) is covered by unit tests with a scripted fake network, not by a run against real sites.
- Not built in this phase: AI assistance for identity matching (deterministic only), periodic re-verification scheduling beyond the recorded re-check date, a reviewer-facing diff when a merge's copied fields were later edited.

## Phase 4 — Contact intelligence 🟡 (2026-10-23)

Scope:
- Migration `005_contact_intelligence.sql`: `contact_points` (type, value and normalised value, scope, source type / URL / provider / licence / note, SHA-256 suppression hashes and a masked hint, classification, validation, purpose, retention, last seen, review), `consent_records` (append-only, per channel, lawful basis, evidence, wording, expiry), `suppressions` (organisation-wide by hashed value, domain or business; never deleted). Guards: restricted sources refused by a check constraint, provenance immutable, automated rows must name their agent version, consent only by signed-in owner/admin/sales (the database stamps who), Act 843 written-consent constraint, automatic suppression on withdrawal and business opt-out (backfilled for existing opt-outs), lifting only by owners/admins with newer consent. Rollback script included. Tested on PGlite with and without 003/004; **not applied to production**.
- Licensed provider interface (`ContactDataProvider`): each provider must declare its licence and permitted uses; none is connected, and `/api/status` lists them.
- Source-permitted website extraction: the Contact Research agent reads only a verified official website — the homepage and at most one same-site contact page, robots.txt honoured, SSRF guard, text parsing only — and records `mailto:`/`tel:` links, visible addresses and numbers, JSON-LD contact points and the business's own WhatsApp links, each with the page URL. No guessing, no social platforms, no Google Places contact fields, no AI in the extraction path (so nothing can be laundered through a model). Addresses on another company's domain (a web designer's footer credit) and personal-looking addresses are kept for review, not treated as the business's.
- Validation (Contact Validation agent and `validateContactPoint`): email syntax and IDN normalisation, DNS MX (null MX, no domain, resolves without MX, temporary errors), duplicates across prospects; libphonenumber (Ghana default) to E.164 with line type; mailbox deliverability marked as skipped. No SMTP probing, no WhatsApp enumeration.
- Retention: workspace setting (30–1,095 days, default 365), per-row extension with a reason, bulk deletion past the date (owner/admin).
- CRM integration: the profile's phone and email are filled from verified business channels when empty; existing profile values can be tracked with provenance (undocumented ones stay "Needs review"); contact points, consent and suppression appear on the prospect's new **Contacts** tab and the **Contacts** page (filters, stats, suppression list). The old `?tab=permission` link still works.
- Consent status: per-channel consent state derived from the latest record; `channelEligibility()` implements gateway checks 2–4 and is shown with its reasons. The summary keeps "discovered" and "permitted" apart (email/phone available, source, data rights, email eligible/blocked, WhatsApp opted in, last validation, "Sending: not available in this version").
- Pipeline: identity → verification → audit → scoring → contact research → contact validation → report (with 005); without 005, scoring goes straight to the report.
- Agent authority: the engine hands agents a store that refuses consent records, suppression lifts, deletions, merges, settings and membership changes, and permission edits other than an opt-out.

Verification:
- `npm run check` — typecheck, lint, 248 Vitest tests in 13 files (164 unit, 84 on PGlite), production build. New: 26 unit tests (normalisation, extraction, sources, validation, eligibility, retention, both agents, the agent store guard) and 20 migration tests (constraints, provenance immutability, RLS and roles across tenants, Act 843, append-only consent even for the table owner, automatic suppression, lift rules, service role refused, re-run, rollback).
- Playwright, demo mode with `SIMULATE_EXTERNAL_TOOLS=true`: 51 tests, including contact research on a verified site, written consent → eligible, opt-out → suppressed workspace-wide, manual suppression with duplicate detection, the restricted-source explanation, and axe checks. No request left the test server. Fixed along the way: a dialog opened from a row menu left the page unclickable after closing (menu now non-modal).
- API cost: $0. MX lookups and page reads are free; no paid API was called.
- 🟡 because:
  - migration 005 is not applied to the production project (RUNBOOK §9 — owner's approval after a backup), so the Supabase store's contact methods are verified only by PGlite tests of the SQL and type checks;
  - live MX lookups and contact-page reads have not been run against real sites (unit tests use a simulated world and a scripted fake network);
  - no licensed contact provider is connected.
- Not built in this phase: scheduled re-validation and retention deletion (phase 10 retention jobs), import of contact lists from files, person-level contacts from licensed sources.

## Phase 5 — AI autonomous reports 🟡 (2026-10-23)

Scope:
- Report schema version 2 (`src/lib/domain/report.ts`): twelve sections; every statement labelled verified fact, evidence-supported finding, recommendation, assumption or unknown; computed evidence references and confidence summary (overall, research confidence, website, identity, audit, contact channels, statement counts). Same `opportunity_reports.content` column; reports saved earlier are converted on read and never rewritten. No migration.
- Evidence grounding: the evidence pack now carries identity confidence, non-rejected verifications only, open/accepted audit findings, contact channels by type, source, validation and consent (no addresses or numbers), business permission and the score, plus deterministic signals.
- Report validation (`validateReport`, for every generator and every edit): citations must exist; facts and findings may not assert revenue, customer or staff numbers, years in operation, conversion rates, software in use, owners, budgets, prices, awards or reviews unless the cited evidence does; no monetary amounts or guaranteed results anywhere; "no website" only when documented checks found none and only hedged; offending summaries replaced by the rule-based ones; the next action limited by research and permission (`allowedNextActions`).
- Automated generation (`report-2.0.0`): readiness gate (verified website position, verification evidence, workspace minimum research confidence — Settings → Agency → Automatic reports); insufficient evidence → no report, `research_incomplete`, one research task; AI only with an Anthropic budget and within the daily AI quota, falling back to the free rule-based report on automatic runs when the quota is used up.
- AI integration: the configured model is checked with the Models API before each paid call (cached ten minutes; refused if unavailable or without structured outputs), output tokens capped at the model's own limit, structured output validated with Zod and then `validateReport`. New `POST /api/ai/model` for an authenticated check.
- UI: twelve numbered sections with label badges and citations, confidence panel, next action, "Show what was removed", versions with generator and cost, a sectioned editor, readiness notice on the prospect's Reports tab, Markdown export in the same structure.
- Cost tracking unchanged in mechanism (usage records, run costs, report usage); the up-front estimate now assumes up to 30k input tokens.

Verification:
- `npm run check` — typecheck, lint, 279 Vitest tests in 14 files (31 new: the rule-based report survives validation for every category × website status; eleven invented-fact categories removed; supported claims kept; guarantees, projections and prices removed; absence claims; next-action limits; contact values never in the pack; rejected verifications excluded; injection text stays quoted data; readiness and the research task; minimum confidence; AI within budget with cost recorded; quota fallback; version history and edits; earlier-format conversion; the server generator against a fake SDK — model unavailable or without structured outputs refused before any paid call, invalid output, refusal, truncation, escaped evidence wrapper, token cap and cost), production build.
- Playwright: 54 tests, including twelve labelled sections with axe, an edit that adds an invented customer number (removed and listed in a new version), and the minimum-confidence setting.
- Live check (free): the Models API confirms the configured model `claude-sonnet-5-5` (Claude Sonnet 5.5) is available to the configured key with structured outputs and effort support.
- API cost: $0. No AI report was generated against the live API.
- 🟡 because no AI report has been generated live (it needs an Anthropic budget and your go-ahead for a paid call; the expected cost is a few cents), so the prompt's real output quality and the structured-output path are verified only against a fake SDK; and the cloud path depends on migrations 003–005 for automation, audit and contact evidence.
- Not built in this phase: report sharing outside the team, side-by-side diff between versions, scheduled report refresh when evidence changes.

## Phase 6 — Automated proposal preparation 🟡 (2026-10-23)

Scope:
- Industry templates (`src/lib/domain/proposal-templates.ts`) for all thirteen sector tracks, including the brief's fashion, furniture, beauty, hotel and restaurant recommendations, with sector add-ons, roadmap items, assumptions and exclusions.
- Controlled price list: `addOns` in organization settings (23 defaults, all unpriced) edited in Settings → Packages. Drafts take prices only from packages and add-ons; totals are computed in code; unpriced required lines block approval, unpriced optional lines do not.
- Deterministic plan: package chosen from the sector routine and the recorded needs (not the largest package), with reasons; add-ons in scope for recorded needs, up to three optional offers, nothing quoted twice, missing add-ons listed rather than invented.
- Proposal drafting: template-driven content (evidence-based problem statement without internal research records, recommended solution with in-scope, optional and later items, timeline only from configured durations, hosting and support lines, discovery questions from the report's limitations). Provenance stored in `content.basis` and shown in the editor; never printed.
- Proposal Generation agent (`proposal-1.0.0`, Research + proposals mode, no paid provider): queued by the report agent when a report supports a proposal; drafts only; no duplicates; never for opted-out, suppressed, inactive or closed prospects. The agent store refuses any proposal status other than draft and the approval, sent and decision fields.
- Lifecycle: approval also checks the validity date; an expired proposal cannot be marked sent; issue and decision dates shown; client responses recorded on sent proposals and with an acceptance or decline (kept in the activity log with the proposal ID).
- Exports: the client document carries the agency's logo, accent colour and contact details (Settings → Agency → Proposal branding) and a footer with validity and currency; the print view sets the PDF file name and prints page numbers; Markdown export unchanged in structure. Versioning is unchanged (every content or status change is a snapshot).
- No migration: proposal content and settings are JSON columns; settings saved before this phase load with the new fields defaulted.

Verification:
- `npm run check` — typecheck, lint, 299 Vitest tests in 15 files (20 new in `tests/unit/proposals.test.ts`: need detection; templates cover every track and reference only existing packages and add-ons; no sector defaults above Business Website Plus without a recorded need; upgrades only for recorded needs, with the need quoted; apps and automation deferred without a working website; limited budget; optional offers capped and covered add-ons skipped; missing price-list entries never invented; a person's choice shown against the recommendation; every price in a draft comes from settings and totals are computed; problem statement without internal records; timeline only from configured durations; provenance not exported; expiry; older settings load; expired proposals cannot be issued; client responses recorded; agents limited to drafts; automatic drafting after a supporting report, once; skipped in Research only mode; waits for supporting research and never drafts for opted-out or suppressed businesses), production build.
- Playwright: price list → recommended package and explained plan → draft with the configured add-on price → branded preview without internal reasoning (with axe); the agent listed as available, draft-only and free.
- API cost: $0 (the agent makes no provider calls).
- 🟡 because PDF export is the browser's print-to-PDF of the branded print view (checked by rendering it to PDF in Chromium), not a server-generated file; default packages and add-ons ship unpriced, so drafts stay "To be quoted" until you enter your rates; and automatic drafting in the cloud depends on migrations 003–005.
- Not built in this phase: AI-written proposal prose (the deterministic draft needs no model), e-signature, sending proposals from the app (outreach is phase 7–8), per-proposal payment milestone templates in settings.

## Phase 7 — Messaging infrastructure (sandbox only) 🟡 (2026-10-23)

Scope:
- Migration 006 (`supabase/migrations/006_messaging.sql`, rollback `supabase/rollback/006_messaging_down.sql`): `message_templates`, append-only `eligibility_decisions`, the `outreach_messages` queue, `inbound_messages`, `channel_events` (webhook deduplication); suppression sources `inbound_opt_out` and `provider_event`. Triggers decide who may move a message between which statuses (people draft, approve, queue and cancel; only the service role dispatches and records delivery), compute the content hash, stamp the dedupe key at queue time and suppress after bounces, complaints and opt-out replies.
- Eligibility gateway `checkEligibility` (CONTACT_PERMISSION_MODEL §5, phase 7 paragraph): every check except quiet hours and caps; deterministic; run at preview, at approval (stored, required by the database) and again on the server at dispatch.
- Templates: email templates written and approved in the app (owner/admin; quality rules: no prices, ≤ 150 words, known variables only); WhatsApp templates synchronised from the WhatsApp Business Account, status only from Meta, never re-enabled by a sync once a person disabled them.
- Adapters: Resend (idempotency key, `message_id` tag, footer with sender identity, postal address and a signed unsubscribe link, RFC 8058 one-click headers) and WhatsApp Cloud API (approved templates with named parameters, free text only inside the 24-hour window, callback data). Outcomes: sent, rejected (failed) or uncertain (*delivery unknown*, never retried).
- Webhooks: `/api/webhooks/email` (Svix signature) and `/api/webhooks/whatsapp` (verify token, `X-Hub-Signature-256`); each event processed once; delivery status moves only forward; replies filed in the workspace named by `MESSAGING_ORGANIZATION_ID`, linked to the one prospect whose contact point matches, with deterministic opt-out detection and a task for a person. Unsubscribe page and one-click endpoint `/api/messaging/unsubscribe`.
- Dispatch `/api/messaging/dispatch` (owner/admin, cloud): reads through the user's row-level security, writes the server-only facts with the service role, re-runs the gateway, re-derives the address from the contact point and checks its hash, compare-and-set *queued → sending*.
- UI: **Outreach** page (Messages with filters, Inbox, Templates, Setup), **Draft a message…** on email and WhatsApp contact points, Messages card on the prospect's Contacts tab, gateway checklist and timeline per message. Demo mode simulates dispatch and replies in the browser and says so.
- Sandbox rule: only the agency's own test recipients (`MESSAGING_TEST_RECIPIENTS`; demo: Outreach → Setup) pass the mode check; every other check still applies to them. Messages to businesses are blocked: `outbound_available()` is false and the emergency stop cannot be lifted.
- Agents: may draft (naming their version) and record preview decisions; may not approve, queue, send, record delivery or replies, manage templates or delete messages.

Verification:
- Vitest: 362 tests in 18 files. New: `tests/db/messaging.test.ts` (17, PGlite: template rules incl. Meta-only status and no re-enable by sync, append-only decisions, approval needs an exact current decision by the approver, people cannot record sending or delivery, dispatch needs a dispatch decision, dedupe index, bounce/complaint/opt-out suppression, deletion and cross-workspace isolation, audit, re-run, rollback); `tests/unit/messaging.test.ts` (26: no consent, opt-out, expired consent, suppression, businesses always blocked, sandbox does not waive consent or approval, template status and version, sender configuration errors, duplicates, reply window incl. manual entries, dispatch-stage checks, duplicate dispatch does not resend, changes after approval block dispatch, opt-out detection, forward-only delivery, template rules, agent limits); `tests/unit/messaging-server.test.ts` (20: Svix test vector, Meta signatures, unsubscribe tokens, Resend and WhatsApp adapters with mocked fetch incl. timeout and uncertain outcomes, event parsing, configuration errors without exposing values, server dispatch against an in-memory Supabase stand-in incl. concurrent dispatch sending once, prospects never sent to, address re-check, webhook deduplication and reprocessing, forward-only status, Resend suppression, inbound opt-out, WhatsApp 131050, template synchronisation).
- Playwright: 63 tests (desktop and mobile). New in `tests/e2e/security.spec.ts`: unsigned webhooks are refused, the WhatsApp verify token is checked, unsubscribe never reflects its input, demo mode never dispatches from the server, messaging status exposes no secrets. New `tests/e2e/outreach.spec.ts`: agency identity → email template approved → sandbox recipient → consenting, validated prospect blocked by the gateway; sandbox address approved, queued, simulated and delivered (with axe) → STOP reply suppresses the sender. Navigation checks the four Outreach tabs in light and dark mode.
- Bugs found by the new tests and fixed: a Postgres regex repetition limit in the WhatsApp template-name check (`{1,512}` is not allowed), a template sync with new text from Meta could re-enable a disabled template, the draft dialog did not preselect the approved template when templates loaded after it opened, and gateway wording ("No Email consent").
- API cost: $0. No message was sent: provider calls are mocked in tests and demo mode simulates them.
- 🟡 because no live provider call has been made (no Resend domain or WhatsApp Business Account is configured), migrations 003–006 are not applied to the production project, and webhook processing was tested against an in-memory stand-in rather than a live Supabase project.
- Not built in this phase: quiet hours, frequency caps and daily limits (phase 8), AI-written drafts (phase 8, through the gateway), automatic replies (never), multi-workspace inbound routing, local-language opt-out keywords (to be agreed with the team).

## Phase 8 — Sending policies and gated drafting (sandbox only) 🟡 (2026-10-23)

Every send passes the deterministic gateway, now with timing and volume rules. AI may write one sentence of a draft, but it has no way past the gateway.

Scope:
- Migration 007 (`supabase/migrations/007_sending_policy.sql`, rollback `supabase/rollback/007_sending_policy_down.sql`; needs 003 and 006):
  - `automation_settings.sending_policy`: validated JSON with the time zone, quiet hours (they always cover 22:00–06:00), sending days, a daily limit per channel (at most 100), recipient spacing, the 30-day maximum, unanswered follow-ups and approval age.
  - The `sending_paused` switch. Resuming needs a reason.
  - `message_policies`: an owner's or admin's standing approval of one approved template version.
    - Daily cap 1–50; expiry at most 180 days; one live policy per version.
    - Statuses go active → paused ↔ active → revoked. Revoked is final.
    - Policies are never deleted, and every change is audited.
  - The `deferred` decision outcome (dispatch stage only).
  - The `enforce_send_policy` trigger:
    - approval and sending need a covering policy;
    - a schedule is at most 7 days ahead;
    - when a message moves to *sending*, it checks again under an advisory lock: the pause switch, the sending window (`public.messaging_now()`), the channel daily limit, the policy cap and the recipient rules.
- Gateway `gateway-1.1.0`:
  - New checks: `policy`, `frequency`, `volume`, `schedule`, and approval age.
  - At dispatch, timing rules **defer** the message. It stays queued and its due time moves to the next allowed instant, snapped into the sending window. A pause holds it until a person acts.
  - At preview and approval, the same rules show as "At dispatch: … would wait".
  - Follow-up limits block the message instead of deferring it.
  - Counting matches the database: only messages that reached sending, counted in the workspace's local day.
- Scheduling:
  - *Schedule* a queued message by wall time in the policy's time zone, up to 7 days ahead.
  - **Dispatch due messages** (cloud, `/api/messaging/dispatch` with `{ due: true }`) or **Simulate due messages** (demo) runs each due message through the gateway again, one at a time.
  - Nothing dispatches on its own in this version.
- Personal note: the `{{personal_note}}` variable holds one reviewed sentence. Limits: at most 40 words or 280 characters; no prices, links, contact details, figures, website-absence claims, guarantees or pressure. The note is checked whenever a person or an agent drafts a message.
- Outreach Drafting agent (`outreach-drafting-1.0.0`, from Research + proposals mode):
  - It picks a contact point and an approved, policy-covered template using the gateway's own checks (business, suppression, consent, contact, template, policy, frequency).
  - It keeps at most one open draft per contact and purpose.
  - Proposal messages need an approved or issued proposal.
  - When nothing qualifies, it returns the reasons.
  - Optional AI note through `/api/messaging/draft-note`:
    - Limited by `DAILY_AI_NOTE_QUOTA` and the budget check. Usage is recorded even when the note is discarded.
    - The model returns structured output that cites evidence IDs, and evidence is treated as data.
    - The note then passes `groundNote` and `validatePersonalNote`.
  - The agent store refuses approving, queueing, sending, recording delivery and setting message policies.
- UI:
  - **Outreach → Policies**: the pause switch, the next sending window, message policies and the sending policy form.
  - **Outreach → Audit**: one trail of gateway decisions, message/template/policy changes and sending-control changes, with filters.
  - *Draft with the agent* on a prospect's Messages card.
  - A schedule field and "Waiting/Due" states on messages.
  - The Setup checklist adds the policy review and local-language opt-out keywords.

Verification:
- Vitest: 409 tests in 20 files (295 unit, 114 PGlite).
- New `tests/db/sending-policy.test.ts` (13 tests):
  - policy validation and role checks;
  - pause and resume with reasons;
  - message policies: stamping, uniqueness, approved templates only, no reply templates, expiry, immutable terms, final revoke, no delete, audit;
  - deferred decisions only at dispatch;
  - the trigger: policy cover, the 7-day schedule, the pause, quiet hours (19:30, 07:59 and Sunday blocked; 18:59 allowed), the channel limit, the policy cap, recipient spacing and the 30-day maximum (replies exempt);
  - re-run, rollback and re-apply.
- New `tests/unit/sending-policy.test.ts` (31 tests):
  - Windows and policy rules: sending windows and sending days; Lagos and London across the 25 October daylight-saving change; policy validation; follow-up and spacing caps; schedule bounds.
  - Gateway outcomes:
    - approval is blocked without a policy, or after the policy is revoked;
    - policy limits apply;
    - a message approved at night is deferred, becomes due and is sent;
    - a pause holds messages without moving their time;
    - the daily limit, the policy cap and approval age are enforced.
  - Personal-note rules and AI note grounding.
  - The drafting agent:
    - mode checks;
    - only one draft;
    - nothing is drafted without consent, for a suppressed address, or without policy cover;
    - a proposal message only after approval;
    - an AI note only when asked;
    - a rule-breaking note from the tool cannot enter a draft;
    - no approve, queue, send or policy changes through the agent store.
- Also new:
  - in `messaging-server.test.ts`: server-side dispatch deferral, due dispatch and the pause;
  - in `reports.test.ts`: the AI note generator against a fake SDK.
- Playwright: 66 tests (desktop and mobile).
  - `tests/e2e/outreach.spec.ts` now creates a message policy before approving and fixes the browser clock.
  - New steps in that spec:
    - the agent refuses without a policy and drafts once one exists;
    - the message is approved at night, and dispatch waits for Friday 08:00;
    - a pause blocks the morning run, and resuming needs a reason;
    - one simulated send goes out;
    - the Audit tab shows the waiting and eligible decisions, the pause with its reason, the resume and the policy (with an axe check on Policies).
  - Navigation covers the Policies and Audit tabs.
- Found and fixed:
  - recipient caps counted a message that had started sending and then failed, which the database does not count;
  - an AI note that failed the checks would have lost its token usage (the generator now returns it for recording);
  - re-running the agent within the same minute silently did nothing (it now says so).
- API cost: $0. The AI note ran only against a fake SDK, and no message was sent.
- 🟡 because:
  - migrations 003–007 are not applied to the production project;
  - no live AI note has been generated;
  - no live provider send has been made;
  - timing is enforced only on dispatch requests that a person starts (no scheduler sends by itself).
- Not built:
  - automatic dispatch at the due time without a person (it would use the existing cron route once sending to businesses is approved);
  - WhatsApp 24-hour-window scheduling nuances beyond the reply window;
  - per-recipient time zones;
  - local-language opt-out keywords;
  - public-holiday calendars.

## Phase 9 — Replies and conversion 🟡 (2026-10-23)

Every reply is read, and what it means becomes work for a person. Opt-outs win over every classifier and every person, and commercial changes need an owner or admin.

Scope:
- Migration 008 (`supabase/migrations/008_response_conversion.sql`, rollback `supabase/rollback/008_response_conversion_down.sql`; needs 002 and 006):
  - `reply_classifications`: append-only readings of received messages (11 intents, confidence, source rules / AI / person, a one-line summary, classifier version, model). The guard stamps the actor and time, refuses edits, requires a signed-in person for corrections, and refuses any intent but `opt_out` for a reply the opt-out rules matched. The server (service role) may insert rules readings for webhook replies.
  - `proposal_change_requests`: what a client asked to change (price, scope, timeline, payment or contract terms) on an approved or issued proposal. People only; owners and admins approve or decline with a note; the recorder, an owner or an admin withdraws; decisions are final; never deleted; audited.
  - `guard_proposal_acceptance` on `proposals`: acceptance is refused while a request is open, or while an agreed change was decided after the stored approval time. The database stamps `approved_at` on approval and refuses any other non-null change to it, so the check cannot be bypassed by writing the field.
- Domain:
  - `reply-rules-1.0.0`: ordered patterns (automatic reply, wrong contact, not interested, meeting request, pricing question, proposal question, more information, not now, interested) after the opt-out rules; unmatched replies are *unclear*.
  - `reconcile`: a rules opt-out stands; an AI opt-out is taken (it only makes contact less likely); an AI reading under 60% falls back to the rules; summaries have contact details masked.
  - `follow-up-1.0.0` planner (tasks only, deduplicated against open tasks): answer hot replies today; after the policy's spacing with no reply, decide on a follow-up, or stop after the policy's unanswered follow-ups; check back 30 days after "not now"; arrange a meeting after interest; prepare a proposal after a meeting; issue or withdraw an approved proposal after 3 days; ask about a proposal after 7 silent days; decide change requests open 2 days. Silence is never read as interest.
  - Meeting brief: only report statements labelled verified or evidence-supported with evidence IDs; the website position as recorded (never "you have no website"); the conversation; the issued proposal (no total for a draft); limitations and pack unknowns as questions; an agenda; what not to promise.
- Services (`src/lib/data/response-services.ts`): rules reading on arrival (demo, manual logging and webhooks, through `afterInbound`) with an alert task, the interest level (classifiers at 70%+ or a person) and the last interaction for real replies; `reclassifyReply` for the AI and people (a new opt-out reading suppresses the sender; a later correction does not lift it); lead alerts; follow-up preview and apply; meeting brief loader; change request record and decide (role checked in the app and the database).
- AI classifier (`reply-ai-1.0.0`, `/api/messaging/classify-reply`): structured output, reply text treated as data and wrapped with `<` escaped, contact details masked before sending, `DAILY_AI_CLASSIFY_QUOTA`, budget check, usage recorded. Webhook replies are never sent to the AI.
- Agents:
  - Response Classification (`response-classification-1.0.0`, Research + proposals): up to 3 reads per run; never re-reads a person's correction or an opt-out; workflow moves only to *response monitoring* or *interested*; queues Follow-Up Planning.
  - Follow-Up Planning (`follow-up-planning-1.0.0`): creates the plan's tasks.
  - The agent store refuses corrections (source `person`) and change requests; agent readings are recorded as `agent`.
  - Sales Intelligence stays planned (after phase 10); the Analytics page shows replies by meaning from stored records, flagged when there are fewer than 10.
- UI: intent badges, *Needs attention* / *To handle* / *Opt-outs* filters and *What does it mean?* in the inbox; *Interested leads* on Overview; the prospect's **Next steps** tab (replies, follow-up plan, meeting brief link, open change requests); the printable meeting brief (`/print/meetings/[id]`); **Discussion and change requests** on proposals with *Agree* / *Decline* for owners and admins and the acceptance button locked with the reason; *Replies by what they mean* on Analytics. New capability `proposals.negotiate` (owner, admin).

Verification:
- Vitest: 442 tests in 22 files (317 unit, 125 PGlite).
- New `tests/db/conversion.test.ts` (11 tests): actor and time stamping; corrections only by signed-in people; append-only (update and delete refused for members and the server); intent, confidence and message checks; an opt-out stays one; cross-workspace isolation; change requests only by people on approved or issued proposals, starting open; decisions only by owners and admins with a note, once; no edits to the request; withdrawal rules; no delete; audit; the acceptance guard (open, agreed but not re-approved, attempts to move `approved_at` alone or with acceptance, revise → approve → issue → accept); declined requests do not block; re-run, rollback order and re-apply.
- New `tests/unit/responses.test.ts` (21 tests): the rules on each intent; opt-out precedence including instruction-like text; reconcile; latest reading (same-instant ties go person > AI > rules); arrival (alert task due today, interest level, last interaction only for real replies, no task and no text in the log for automatic replies); opt-out never reclassified (service, store, AI); person corrections with masked summaries; AI opt-out suppression that a correction does not lift; unsure AI falls back; the planner (silence, stop after the limit, opted-out and closed prospects, not now, interest, idempotent, no messages); the meeting brief (no unsupported statements, website wording, no draft total); change requests end to end (draft refused, acceptance blocked while open and while agreed-but-not-revised, sales cannot decide, note required, final, revise → approve → issue → accept → project, audited, withdrawal, deletion with the proposal); both agents (estimate only with AI, edges, AI only where needed, opt-out and corrections skipped, follow-up planning queued, rules-only path, agent store refusals).
- Also new: the AI classifier against a fake SDK (`reports.test.ts`: masking, the escaped wrapper, the prompt rules, format and refusal errors) and the webhook path recording rules readings as the server (`messaging-server.test.ts`).
- Playwright: 68 tests (desktop and mobile). New `tests/e2e/conversion.spec.ts`: a simulated reply read as a meeting request → *Needs attention* → the Overview alert → Next steps (axe check) → the meeting brief → an issued proposal → a recorded discount request locks acceptance → the owner agrees with a note → acceptance still locked → revise, approve, issue → accepted → project → Won; and an opt-out reply that cannot be read as anything else.
- Found and fixed:
  - the acceptance guard first compared against the approval time in the same update, so writing `approved_at` with the acceptance could skip re-approval (the database now stamps it);
  - a classification's prospect would have gone stale when a message was linked to a prospect later (readings now follow the message);
  - the follow-up plan and the arrival alert created two differently-worded tasks for one reply (they now share the title);
  - the source label in intent badges failed colour contrast (found by axe).
- API cost: $0. The AI classifier ran only against a fake SDK and fake agent tools; no message was sent.
- 🟡 because:
  - migrations 003–008 are not applied to the production project;
  - no live AI classification has been run;
  - local-language opt-out keywords and reply patterns (Twi, Ga, Ewe, Pidgin) have not been agreed, so such replies may read as *unclear* (the AI reading can help, and a person can correct);
  - the rules are English-pattern heuristics with fixed confidence values, not a measured classifier.
- Not built:
  - the Sales Intelligence agent as a queued job;
  - calendar integration for meetings (meetings are logged as activities);
  - drafting a reply from the reading (a person drafts it; the gateway checks it);
  - e-signature or contract generation (custom terms stay with people, outside the app).

## Phase 10 — Hardening and operations 🟡 (2026-10-23)

Scope (no migration):
- **Full test suite** with every requirement in the brief traced to its tests (docs/TESTING.md §2). Unit and database tests now run with the network blocked (`tests/setup/no-network.ts`).
- **Job reliability:** seeded soak tests on the demo queue and the SQL queue (two workspaces, worker and owner). They cover random claims, finishes, crashes, cancellations, deferrals and stale leases. After every step the invariants are checked:
  - no job is held twice;
  - attempts stay within the limit;
  - a job succeeds at most once and is never claimed again;
  - terminal states are final;
  - per-workspace concurrency holds;
  - every job ends terminal.
- **Cost testing:** every AI call checks the byte bound of its request against the input tokens its budget check reserved, and refuses before sending if it is exceeded (`src/lib/server/ai/input-bound.ts`). Replies are cut to 12,000 bytes after escaping. A shared fake SDK (`tests/unit/fake-anthropic.ts`).
- **Live checks:** `npm run test:live` is opt-in (`LIVE_INTEGRATION=1`) and never in CI. Each check reserves its worst case against `LIVE_BUDGET_USD` (default $0.15, hard cap $0.50). Keys come from `.env.local`. Nothing is stored or sent.
- **Security audit** (docs/SECURITY_AUDIT.md):
  - a CSP with `default-src 'self'` and `connect-src` limited to the app and Supabase;
  - `npm run check:bundle` scans the browser bundle for key formats, service-role tokens and the configured secret values (in `check` and CI);
  - redacted structured logs (`src/lib/server/log.ts`) and a request-error hook (`src/instrumentation.ts`), with optional `ERROR_REPORT_URL`;
  - CI blanks every secret;
  - `npm audit`: 0 vulnerabilities.
- **Accessibility review** (docs/ACCESSIBILITY.md): axe on every profile tab, the proposal editor and print views in light and dark; tests for the skip link, dialog focus and tab arrow keys, and reduced motion. Dialogs now return focus to their opener.
- **Migration review** (docs/MIGRATION_REVIEW.md):
  - static checks: RLS everywhere, pinned `search_path`, no destructive statements, a rollback per migration;
  - the 002 → 008 upgrade with records unchanged, a rollback to the exact 002 schema, and re-application;
  - `supabase/checks/preflight.sql`, a read-only inspection to run before production.
- **Monitoring:** the System health card in Automation Center → Overview (`src/lib/domain/monitoring.ts`), and docs/MONITORING.md.
- **Operations docs:** incident response (severity, first steps, Act 843 notification, key rotation table, playbooks), backups (with re-applying opt-outs recorded after a backup), deployment guide (environments, variables, smoke test, roll back), and runbook §15.

Verification:
- Vitest: 466 tests in 27 files (331 unit, 135 PGlite). New files:
  - `unit/job-reliability` (4);
  - `db/job-reliability` (3);
  - `db/migrations` (7);
  - `unit/cost` (4);
  - `unit/monitoring` (6).
- Playwright: 71 tests (54 desktop, 17 phone layouts). New: `e2e/accessibility` (3); a stricter `e2e/security` header test.
- tsc and eslint clean; the client bundle scan passed (no key formats, no service-role token, and neither of the two configured secret values from `.env.local` present).
- The live checks skip without opt-in (4 skipped, $0).

Found and fixed:
- **S-1** the AI cost reservation could be exceeded by a hostile reply (escaping after the character cap), and evidence packs had no size check;
- **S-2** the CSP did not restrict sources;
- **S-3** unredacted error text in logs;
- **S-4** CI did not blank every secret;
- **A-1** dialogs did not return focus.

API cost: $0. No live check was run, nothing was sent, and no migration was applied to production.

🟡 because:
- migrations 003–008 have not been rehearsed on a real Supabase project or applied to production (needs a backup and the owner's approval);
- no live provider check has been run (needs approval for a small budget);
- rate limits are per server instance (SECURITY_AUDIT R-1);
- no screen-reader pass or WCAG 2.2 audit;
- no third-party penetration test;
- no uptime probes or paging (MONITORING §4).

Not built:
- edge rate limiting;
- automated retention jobs (retention is reviewed by people);
- load testing;
- a metrics store.

