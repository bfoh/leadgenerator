# Autonomous Platform Architecture

Status: Phase 1 design, written 2026-10-22 after auditing the repository. Companion documents:
[AGENT_WORKFLOWS](AGENT_WORKFLOWS.md) · [DATA_PROVIDER_POLICY_MATRIX](DATA_PROVIDER_POLICY_MATRIX.md) · [CONTACT_PERMISSION_MODEL](CONTACT_PERMISSION_MODEL.md) · [OUTREACH_COMPLIANCE](OUTREACH_COMPLIANCE.md) · [COST_CONTROL](COST_CONTROL.md) · [IMPLEMENTATION_ROADMAP](IMPLEMENTATION_ROADMAP.md). The v7 baseline is described in [ARCHITECTURE](ARCHITECTURE.md).

## 1. Principles

1. **Agents propose, deterministic code decides.** Validation, consent, de-duplication, scheduling, money, permissions, provider access and state transitions are ordinary TypeScript and SQL with tests. Language models only draft text and classify; their output is validated before anything is stored.
2. **No agent can send a message, change a consent record, delete a lead or move money on its own authority.** These actions are not exposed to agents at all (see §6); where they exist they sit behind the consent gateway, a human approval and database checks.
3. **Default off.** New workspaces start in *Research only* mode with the outbound emergency stop engaged. Having an API key never switches a capability on: paid automation needs an explicit budget, outbound needs a mode change, a verified channel and the consent gateway.
4. **Evidence over assertion.** Every automated conclusion is stored with its method, sources, time, agent version and confidence. "No website found" is always "not found after documented checks".
5. **Additive evolution.** Nothing in v7 is replaced. New tables arrive in append-only migrations; the app keeps working against a database that does not have them yet.

## 2. Audit of the existing platform (2026-10-22)

Verified against the repository, not assumed: `tsc` clean, ESLint clean, 100 Vitest tests (unit, workflow, server, Places, analytics, PGlite RLS) pass, 35 Playwright tests passed in the last full run, migrations `001` and `002` present and `002` applied to the live Supabase project by the owner.

| Area | Current state | Reused for the autonomous platform |
| --- | --- | --- |
| Persistence | `DataStore` interface with `LocalStore` (demo, browser) and `SupabaseStore` (cloud, RLS). Cross-entity rules in `services.ts`. | Agents call the same services, so demo and cloud behave alike. `SupabaseStore` hardened to scope every query by organization so it is safe with a server-side client. |
| Tenancy and roles | Organizations, six roles, RLS on 14 tables, composite tenant FKs, audit triggers. | Every new table follows the same pattern. Worker functions check membership or the service role. |
| Discovery | `DiscoveryProvider` interface (search, details, capabilities, attribution, retention, cost). Google Places (New) live; demo provider. | Extended with permitted purposes and export rules (see policy matrix). Discovery stays user-initiated. |
| Verification | Verification history with outcomes, methods, confidence, technical check (SSRF-guarded), domain DNS probe, Brave Search provider (not configured), manual search links. | The Website Verification agent orchestrates these tools; its outcomes map onto the brief's nine classifications. |
| Scoring | Pure, configurable `scoreBusiness`; opportunity separate from confidence. | Opportunity Scoring agent = rescore + qualification decision. No AI in scoring. |
| Reports | Evidence pack → Claude structured output (Zod, citation check) or deterministic generator; versioned. `ANTHROPIC_API_KEY` configured with `claude-sonnet-5-5`. | Opportunity Report step. Phase 5: 12-section labelled schema (`schemaVersion: 2` in the same JSON column; earlier reports converted on read), readiness gate, model check. |
| Proposals | Packages without invented prices, 15 sections, GHS line items, approval states, version snapshots. | Proposal Generation agent drafts from industry templates and the add-on price list (phase 6); the agent store refuses any status but draft, so approval, issue and decisions stay human. |
| CRM | 12-stage pipeline, permission-gated contact stages, opt-out blocking, activities, tasks. | Kept as the sales view. A separate workflow state tracks the automation lifecycle (see AGENT_WORKFLOWS §2). |
| Cost | Per-operation daily quotas, `usage_records` with estimated cost. | Budgets (daily and monthly, per provider) read the same records. |
| Gaps | No background execution, no job table, no agent audit, no contact provenance model, no consent records beyond one field per business, no outbound channels. | Phases 2–9. |

## 3. Target flow

```
             ┌───────────────────────────┐
  user  ───▶ │ Discovery (user-initiated)│  Places API (New) / other licensed providers
             └─────────────┬─────────────┘
                           ▼
                 Business Identity  ─── de-duplication, merge/split suggestions (human-approved)
                 ┌─────────┴──────────┐
                 ▼                    ▼
       Website Verification    Contact Research ─▶ Contact Validation
       (search API, DNS,       (permitted sources,  (syntax, MX, E.164 —
        HTTP check)             provenance)          no intrusive probing)
                 └─────────┬──────────┘
                           ▼
                 Digital Audit ─▶ Opportunity Scoring ─▶ Opportunity Report ─▶ Proposal draft
                           ▼
           ╔═══════════════════════════════════════╗
           ║  Permission & Approval Gateway         ║  deterministic: consent record, suppression,
           ║  (no AI, no override by agents)        ║  channel rules, quiet hours, human approval
           ╚═══════════════════╤═══════════════════╝
                               ▼
         Outreach Drafting ─▶ Outreach Execution (email / WhatsApp Cloud API, disabled by default)
                               ▼
         Response Classification ─▶ Follow-Up Planning (human tasks) ─▶ Sales CRM ─▶ Project
                               ▲
                       Sales Intelligence (read-only insights)
```

## 4. Job orchestration decision

| Option | Strengths | Weaknesses for this product |
| --- | --- | --- |
| **Inngest** | Durable step functions, retries, throttling and concurrency keys, good Next.js support. | Business and contact data would pass through another processor (Act 843 cross-border transfer and a further processor agreement); another account and secret; local runs need its dev server. |
| **Trigger.dev** | Long-running tasks, dashboard, retries. | Tasks run on Trigger.dev infrastructure, so the same data-processor concern applies; separate deployment pipeline for task code. |
| **Supabase Edge Functions + pg_cron / Queues** | Inside the existing vendor. | Deno runtime: the TypeScript domain rules (scoring, evidence, proposals) would be duplicated or bundled separately. |
| **Dedicated worker service** | No execution-time limits. | Another server to deploy, patch and monitor for a small agency. |
| **Postgres-backed queue in Supabase, executed by this app** ✅ | No new processor or credential for the queue; jobs commit in the same database as the data they describe; the same domain code runs everywhere; queue semantics are SQL that CI tests on PGlite; cheapest. | Retries, leases and dead-lettering are ours to build and test; serverless time limits require short, resumable steps. |

**Decision:** a Postgres-backed queue (`automation_jobs`) with SQL functions for enqueue, claim (`FOR UPDATE SKIP LOCKED` with leases), finish, cancel, retry and approve, executed by one TypeScript engine (`src/lib/automation`). Three runners call the same engine:

| Runner | Trigger | Identity | Notes |
| --- | --- | --- | --- |
| Foreground | *Process queue* in the Automation Center, or *Keep processing while this page is open* | The signed-in member's session, so RLS limits the worker to what that member may do. | Bounded to a few jobs and ~45 s per request. Works today with no extra credentials. |
| Scheduled | `GET /api/cron/automation` with `Authorization: Bearer $CRON_SECRET`, called every minute by Supabase pg_cron + pg_net (any plan) or Vercel Cron (Pro; Hobby runs at most daily) | Server-only `SUPABASE_SERVICE_ROLE_KEY`, used only inside the worker adapter, which scopes every query to the job's organization. | Disabled until both variables are set. Never exposed to the browser. |
| Demo | The engine runs in the browser over local storage | Demo user | Jobs run only while the app is open; labelled as such. |

**Exit strategy.** Agent definitions are plain typed functions (`input → AgentResult`) with no dependency on the queue. Moving to Inngest or a dedicated worker later means writing a new runner, not rewriting agents.

## 5. Execution model

- **Job lifecycle:** `pending → running → succeeded | failed | cancelled`, plus `awaiting_approval → pending` for steps that need a person. Failed means dead-lettered: it stays visible with its error until someone retries or dismisses it.
- **Leases:** a claim sets `locked_until`. If a worker dies, the next claim recovers the job: research steps return to `pending`; outbound steps go to `failed` with *delivery status unknown* and are never retried automatically.
- **Idempotency:** `(organization_id, idempotency_key)` is unique. Follow-up jobs use keys derived from the trace, step and business, so a replayed step cannot enqueue duplicates. Outbound messages also carry a per-message dedupe key (unique while queued or sent), a compare-and-set on *queued → sending*, and the provider's idempotency key (Resend `Idempotency-Key: outreach-{message id}`) — built in Phase 7.
- **Retries:** exponential backoff with jitter (30 s base, 1 h cap, default three attempts). Policy, validation and permission errors are permanent and never retried. Budget and rate-limit deferrals do not consume attempts.
- **Concurrency:** per-organization limit (default 2) enforced in the claim; per-provider pacing in the engine.
- **Timeouts:** each agent declares a timeout; the engine aborts with `AbortSignal` and records a timeout.
- **Cancel / pause:** cancelling a running job sets `cancel_requested`; the engine stops before writing results. Pausing an organization stops claims without touching queued jobs.
- **Emergency stop:** an organization flag, owner-only to lift, that cancels queued outbound jobs and is checked by the claim function, the engine and (Phase 7) the provider adapters.
- **Tracing:** every job carries a `trace_id` inherited by its follow-ups; agent runs record the trace, so a whole research pipeline can be inspected end to end.

## 6. Authority model

| Action | Who may perform it | Enforced by |
| --- | --- | --- |
| Research writes (verification records, scores, reports, drafts) | Agents and members with research roles | Engine allow-list per agent + RLS role checks |
| Workflow transitions | Agents within research states; people elsewhere | `checkTransition` (TypeScript) + transition log trigger |
| Opt-out / suppression | Any member, deterministic inbound rules | Database trigger forces the workflow to *opted out*; suppression is checked before every send |
| Lifting opt-out, changing consent, lifting a suppression | People only (consent: owner/admin/sales with evidence; suppression: owner/admin with newer consent) | The engine hands agents a store that refuses these calls (`agent-store.ts`); the database requires a signed-in user for consent records and lifts (migration 005) |
| Deleting leads | Owners/admins only | Not in the agent tool set; RLS |
| Sending messages | After the gateway, in an outreach mode, with the stop lifted and the channel verified; dispatched by a person (owner/admin) in Phase 7 | Gateway at approval and again on the server at dispatch; the database refuses approval or *sending* without a matching decision; only the service role records dispatch. **Messages to businesses are blocked in this build; only sandbox test recipients.** |
| Spending money | Agents within budget; nobody beyond a hard stop | Engine budget check before each paid call |
| Financial transactions | Nobody (out of scope) | Not implemented |

Retrieved web content and model output are data. Agents have no tool that executes instructions found in content, and model calls are given no tools.

## 7. Data model

Existing tables are reused wherever the brief's conceptual model overlaps, to avoid parallel copies of the same facts.

| Conceptual entity (brief) | Table | Status |
| --- | --- | --- |
| Businesses / leads | `businesses` (+ `workflow_state` columns) | Existing; workflow columns in migration 003 |
| Source records / discovery results | Not persisted beyond permitted identifiers (Places ID) | By policy |
| Identity matches, merge/split decisions | `identity_links`; `businesses.alternate_names`, `parent_business_id`, `merged_into_id`, `identity_confidence` | Migration 004 |
| Website verification runs and evidence | `website_verifications` (+ `actor_type`, `classification`, `confidence_score`, `evidence` JSON with queries, candidates, factors, decision; `agent_version`, `job_id`, review fields) | Existing; agent fields in migration 004 |
| Digital audit findings | `audit_findings` | Migration 004 |
| Contacts / contact points with provenance | `contact_points` (source, licence, hashes, masked hint, classification, validation, retention) | Migration 005 |
| Consent records | `consent_records` (append-only; written only by people) | Migration 005 |
| Suppression list | `suppressions` (organization-wide, hashed, never deleted) | Migration 005 |
| Scores | `businesses.score_breakdown`; `businesses.score_override` (value, justification, who, when; changes in `audit_events`) | Existing; override in migration 004 |
| Reports | `opportunity_reports` (`content` holds schema version 2 since Phase 5; no migration needed) | Existing |
| Proposals and versions | `proposals`, `proposal_versions` | Existing |
| Outreach messages, conversations, delivery events | `message_templates`, `eligibility_decisions`, `outreach_messages`, `inbound_messages`, `channel_events` (migration 006); message policies and sending controls (migration 007) | Phase 7–8 🟡 |
| Reply readings and proposal change requests | `reply_classifications` (append-only), `proposal_change_requests`, acceptance guard on `proposals` (migration 008) | Phase 9 🟡 |
| Jobs | `automation_jobs` | Migration 003 |
| Agent runs | `agent_runs` | Migration 003 |
| Workflow transitions | `workflow_transitions` | Migration 003 |
| Automation policy, modes, budgets, emergency stop | `automation_settings` | Migration 003 |
| Provider usage and cost | `usage_records` | Existing |
| Audit trail | `audit_events` (+ triggers on the new tables) | Existing |

## 8. Security

- RLS on every new table; writes to jobs only through `SECURITY DEFINER` functions pinned to `search_path = ''` that check membership and role (or the service role) and validate state.
- The service-role key is read only by `src/lib/supabase/service.ts` (`server-only`), only for the scheduled runner. The browser never receives it, and `/api/status` reports only whether a worker is configured.
- `CRON_SECRET` is compared in constant time; the cron route accepts no parameters that widen its scope.
- Agent run logs store summaries, decisions, provider names and costs — never keys, raw provider payloads restricted by licence, or full message bodies beyond what the record needs.
- Outbound fetches keep the existing SSRF guard (public addresses only at every redirect hop, 80/443, timeouts, size caps) and only fetch pages relevant to the business; no crawling, no logins, no CAPTCHA bypass. Automated checks honour robots.txt (RFC 9309) for every origin in the redirect chain; the manual *Check* button stays a single status check a person asked for. Pages are parsed as text — no JavaScript is executed.
- Webhooks (built in phase 7) verify provider signatures, reject replays by timestamp and event ID, and are idempotent.
- Sending policies (phase 8) live in two places that must agree: `checkEligibility` (browser preview/approval, server dispatch) and the `enforce_send_policy` trigger, which re-checks policy cover, the pause switch, the sending window, daily limits, the policy cap and recipient spacing when a message moves to sending, under an advisory lock. Timing rules defer rather than block.

## 9. Compatibility and migrations

- Migration `003_automation_infrastructure.sql` is additive and re-runnable. It is tested on PGlite in CI. **It is not applied to the live project by this work**; the owner applies it after a backup (RUNBOOK §1).
- Until 003 is applied, cloud mode keeps working: workflow state is derived on read, the Automation Center explains that the database update is needed, and budget checks are skipped.
- Rollback: the new tables can be dropped without affecting v7 data; the new `businesses` columns have defaults and are ignored by older builds.
- Migration `004_research_verification.sql` (Phase 3) is additive and re-runnable, and applies with or without 003. Existing verification rows become `actor_type = 'user'` with no review needed. Merges run only through `merge_businesses` / `undo_business_merge` (owner/admin, guarded by a session flag); agent verification rows are immutable except for their review fields. Tested on PGlite; **not applied to the live project**. Until it is applied, cloud mode keeps working: the identity, audit and override panels explain that the update is needed, and the pipeline starts at scoring. Rollback script: `supabase/rollback/004_research_verification_down.sql` (merges are not un-merged by it; undo them first).
- Migration `005_contact_intelligence.sql` (Phase 4) is additive and re-runnable, and applies with or without 003/004. It creates `contact_points`, `consent_records` and `suppressions`, backfills a suppression for every business already opted out, and changes no existing row. Provenance is immutable; consent is append-only and needs a signed-in person (the database stamps `recorded_by`); suppressions have no delete privilege and are lifted only by owners/admins with newer consent (`guard_suppression`). Tested on PGlite; **not applied to the live project**. Until it is applied, the Contacts tab shows the business-level permission panel with a notice, and the pipeline goes from scoring straight to the report. Rollback script: `supabase/rollback/005_contact_intelligence_down.sql` (it deletes consent history and the suppression list — export them first, RUNBOOK §9).
