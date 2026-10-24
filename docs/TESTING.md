# Testing

How the product is tested, what each requirement in the engineering brief is tested by, and how live provider checks are kept small and opt-in.

## 1. Suites

| Command | What runs | Network | Cost |
| --- | --- | --- | --- |
| `npm test` | Vitest: unit tests (`tests/unit`) and database tests (`tests/db`, the real migrations on PGlite with a stub of Supabase's auth schema and roles) | **Blocked.** `tests/setup/no-network.ts` makes any fetch to a host other than this machine fail, so a missing fake can never reach a paid API | $0 |
| `npm run test:e2e` | Playwright on a production build in demo mode: workflows, accessibility (axe, light and dark), keyboard use and security headers and endpoints on desktop Chrome; phone layouts on a Pixel 7 profile | The test server runs with every key blank; replies, sends and research tools are simulated | $0 |
| `npm run check` | Typecheck, lint, `npm test`, then the production build, which ends with the client bundle scan (the browser bundle contains no key format, service-role token or configured secret value; Vercel builds run it too) | Blocked | $0 |
| `LIVE_INTEGRATION=1 npm run test:live` | `tests/live`: one free model lookup, one AI reply reading of a made-up message, one AI report for a fictional business, one Brave query, one Places Text Search each in Accra and Kumasi, and a free website and MX check of a site we control. Nothing stored, nothing sent | Real providers, keys from `.env.local` | Capped (§4) |

CI (`.github/workflows/ci.yml`) runs `check`, `npm audit --omit=dev --audit-level=high` and the E2E suite with every key, secret and `LIVE_INTEGRATION` blanked. It never runs the live checks.

Simulation: the AI is replaced by a fake SDK (`tests/unit/fake-anthropic.ts`, or the mock in `reports.test.ts`); providers by mocked fetch (`messaging-server.test.ts`, `places.test.ts`); Supabase by an in-memory stand-in (`fake-supabase.ts`) or PGlite; the E2E server by the demo store and `SIMULATE_EXTERNAL_TOOLS=true` (`src/lib/server/providers/simulated-research.ts`).

## 2. Requirement traceability

Every test the brief asks for, and where it is. File paths are under `tests/`; names are the test titles.

**Consent and messaging**

| Requirement | Tests |
| --- | --- |
| No consent blocks sending | `unit/messaging` "blocks a message without consent, even to a verified channel"; `unit/contacts` "no consent blocks sending, even for a verified channel"; `unit/sending-policy` "writes nothing without consent, for a suppressed address, or without a covering policy" |
| Opt-out blocks | `unit/messaging` "blocks a message after an opt-out, and the suppression wins over the earlier consent"; `unit/contacts` "opt-out blocks sending…"; `db/contacts` "follows a business opt-out, on update and on insert, without duplicates"; `e2e/contacts` "written consent makes email eligible; an opt-out suppresses it workspace-wide"; `e2e/conversion` "an opt-out reply cannot be read as anything else" |
| Restricted source blocks persistence | `unit/contacts` "refuses restricted sources: Google Places, search results and social platforms"; `db/contacts` "record who added them, and refuse restricted sources and missing provenance"; `unit/places` (only the Place ID is storable) |
| Expired permission blocks | `unit/messaging` "blocks a message once consent has expired"; `unit/contacts` "expired permission blocks sending" |
| Eligible message reaches the queue | `unit/messaging` "lets an eligible sandbox message reach the queue, and records each decision"; `e2e/outreach` "a consenting sandbox recipient gets an approved, queued, simulated message; a prospect never does" |
| Duplicate jobs do not resend | `unit/automation` "deduplicates by idempotency key"; `db/automation` "is idempotent per workspace and key", "rejects a finish from a worker whose lease is gone"; `unit/messaging` "refuses a second message with the same text to the same recipient"; `db/messaging` "cannot be queued twice with the same text for the same recipient"; `unit/messaging-server` "sends a queued sandbox message once…", "marks an uncertain send as delivery unknown and never retries it"; `unit/job-reliability`, `db/job-reliability` (soak, below) |
| Webhook deduplication | `unit/messaging-server` "process each Resend event once and move delivery only forward", "process WhatsApp statuses and replies once…"; `db/messaging` "are written once per provider event, only by the server" |
| Template status validation | `unit/messaging` "checks the template's status and version", "validates templates"; `db/messaging` "take WhatsApp status only from the server; a sync never re-enables a disabled template", "need a person to approve email templates…" |
| Sender configuration errors | `unit/messaging` "reports sender configuration errors" |

**Security**

| Requirement | Tests |
| --- | --- |
| Cross-tenant isolation | `db/rls` "blocks inserting into another organization", "silently affects zero rows when updating or deleting another organization's data", "prevents attaching rows to another organization's business via forged IDs"; every `db/*` suite's "other workspaces" cases; `db/job-reliability` "lets only the scheduled worker claim across workspaces, and an owner only their own" and the soak's cross-workspace refusals |
| Unauthorized worker actions | `unit/monitoring` "refuses callers without the exact cron secret before touching the database", "is off (503) until the cron secret is configured"; `db/contacts` "cannot be lifted by an automated worker", "…never by automated workers"; agent store refusals in `unit/contacts`, `unit/messaging`, `unit/sending-policy`, `unit/responses` |
| API key protection | `e2e/security` "status endpoint exposes configuration booleans, never secrets", "messaging endpoints … expose no secrets"; the client bundle scan in `npm run build` (CI and every Vercel build); `unit/places` (key sent in a header, never in a URL); `unit/monitoring` "redact contact details and secrets" |
| SSRF protection | `unit/safe-fetch` (private, loopback, link-local and metadata addresses; redirects re-checked); `e2e/security` "website checks refuse private network targets" |
| Webhook verification | `unit/messaging-server` "verifies Svix signatures (Resend) with the published test vector", "verifies Meta signatures and verify tokens in constant time", "signs unsubscribe links per message and rejects tampering"; `e2e/security` "messaging endpoints refuse unsigned webhooks, bad tokens…" |
| Injection handling | Prompt injection: `unit/verification` "ignores instructions in page text…", `unit/reports` "keeps instructions in recorded text as quoted data" and the AI classifier test (the wrapper cannot be closed), `unit/responses` "treat an opt-out as an opt-out whatever else the reply says". Request forgery: `e2e/security` "server tools reject cross-origin writes". SQL: every query is parameterised (PostgREST or `$n`); interpolated filters validate UUIDs first |
| Audit integrity | `db/rls` (members cannot delete audit events); `unit/workflow` "records verification corrections in the audit trail"; audit cases in `db/automation`, `db/messaging`, `db/sending-policy`, `db/conversion`; append-only tables (`consent_records`, `eligibility_decisions`, `channel_events`, `reply_classifications`) refuse update and delete in their suites |

**Workflows**

| Requirement | Tests |
| --- | --- |
| Discovery → proposal | `e2e/workflow` "research → verification → qualification → report → proposal → CRM"; `unit/verification` "runs identity → verification → audit → scoring → report end to end on simulated providers"; `e2e/proposals` |
| Proposal → outreach draft | `unit/sending-policy` "drafts a proposal message only once a person has approved the proposal", "writes one draft for a contact with consent and a covered template, and never a second" |
| Consent rejection | `e2e/workflow` "contact permission unlocks outreach stages and opt-out blocks them"; the consent rows above |
| Approved outreach | `e2e/outreach` (approval, queue, dispatch, quiet hours, pause) |
| Inbound reply classification | `unit/responses`; `unit/messaging-server` (webhook replies read as the server); `db/conversion`; `e2e/conversion` |
| Meeting opportunity | `e2e/conversion` (meeting request → alert → Next steps → meeting brief); `unit/responses` meeting brief cases |
| Won client conversion | `e2e/conversion` (change request → agreed → revised, approved, issued → accepted → project → Won); `db/conversion` acceptance guard |

**Phase 10 additions**

| Area | Tests |
| --- | --- |
| Worker time limits and paid requests | `unit/automation` "worker time limits and paid requests": every job fits its lease, no job starts unless it can finish before the runner stops, a paid request with no answer or an answered one is never repeated (in the attempt or after a lease expiry), a request refused without charge is retried, the ledger outranks the error, an unreadable ledger stops retries, and open requests count at their maximum cost against budgets. `unit/paid-requests`: both routes' 300 s limit and start windows, AI clients with `maxRetries: 0` and timeouts under their agents', each SDK failure's billing, charged unusable answers, the ledger written before sending (nothing sent if it cannot be written) and settled by the outcome, and manual budgets counting open requests. `db/automation`: a recovered job comes back marked `timeout`, and ledger rows are insert-only for members and the worker |
| Research campaigns (rules) | `unit/campaigns`: 16 regions and 261 districts with source metadata (260 verified records + Guan), provider declarations (only tracked records is campaign-ready; Google Places refuses unattended/CRM use; placeholders claim nothing), scope matching by region/district/town/industry, consent and record-state exclusions, daily/weekly/monthly schedules across month and year boundaries, status transitions, progress, target reconciliation, and the campaign input schema. `unit/campaign-lifecycle`: the six derived phases, edit locks during a run, read-only terminal campaigns, and the safe auto-completion rule. `unit/campaign-orchestrator`: single-region, multi-region and nationwide batches; district/town/industry filters; batch and daily quotas; campaign budget; paused queue and paused campaign; dedup within and across campaigns; repeated and racing ticks; scheduled-run claiming; failed, vanished and approval-waiting jobs; queued-membership resume; auto-completion; empty audiences. `unit/campaign-mapping`: row ↔ domain mapping. |
| Research campaigns (database) | `db/campaigns`: the district seed equals the verified TypeScript list (261/16); district-only and region-only records; district/region consistency; many-to-many membership with per-campaign state and append-only history; RLS for members, researchers, owners and outsiders; campaign lifecycle; Google Places refused by check; campaign job attribution (including a target from another prospect); `campaign_spend` and cross-workspace hiding; migration re-application on a populated and a pre-009 database; SECURITY DEFINER/search-path metadata; rollback guards for town-less records and clean re-application. `db/staging-acceptance`: backup, preflight, 009, 010, all 23 post-migration checks, campaign + district-only prospects, queued research, browser closed, completed jobs and progress, zero paid/outbound rows, and a rollback of a disposable copy. |
| Job reliability | `unit/job-reliability` (demo queue, 4 seeds) and `db/job-reliability` (SQL queue, 2 seeds, two workspaces): random claims, finishes, crashes, cancellations, deferrals and stale leases; after every step no job is held twice, attempts never pass the limit, a job succeeds at most once and is never claimed again, terminal states stay terminal, per-workspace concurrency holds; everything ends terminal |
| Cost | `unit/cost`: a hostile reply (20,000 `<` and emoji) stays within the reserved input bound for every priced model; an oversized evidence pack is refused before any AI call; quotas are finite; normal test runs cannot reach Anthropic, Google, Brave, Resend or Meta |
| Migrations | `db/migrations`: RLS on every table, pinned `search_path` on every security-definer function, no destructive statements, a rollback per migration; a 002 database with records upgraded to 008, rolled back to the exact 002 schema and re-applied twice with records unchanged; the pre-production script runs read-only |
| Monitoring | `unit/monitoring`: alert levels and order; log redaction and HTTPS-only forwarding |
| Accessibility | `e2e/accessibility`: every profile tab, the proposal editor and print views (light and dark), the skip link, dialog focus trap and return, tab arrow keys, reduced motion |

## 3. Writing tests

- New provider code gets a fake: mock fetch per test (`vi.stubGlobal('fetch', …)`) or inject the SDK fake. The network guard tells you when one is missing.
- Database rules get a PGlite test that runs as the role that should be refused (`as`, `asServiceRole` in `tests/db/harness.ts`).
- Fixed time: `vi.useFakeTimers({ toFake: ['Date'], now })` in unit tests, `page.clock.install` in Playwright.
- E2E tests run in demo mode. Never point them at a cloud project.

## 4. Live checks (opt-in, budget-capped)

`tests/live/providers.live.test.ts` checks that the real integrations still work. It is not part of `npm test`, `check` or CI, and does nothing unless `LIVE_INTEGRATION=1`.

- **Budget.** Each check reserves its worst-case cost before calling and is skipped if the reservation would pass `LIVE_BUDGET_USD` (default $0.15, hard cap $0.50 in `tests/live/budget.ts`). The run prints what was reserved.
- **Keys** come from `.env.local`, which wins over shell variables, so a stray exported key cannot pick the paying account. A check whose key is missing is skipped.
- **The AI report check** reserves US$0.22 (its worst case), so it runs only when `LIVE_BUDGET_USD` leaves room for it (0.30 runs everything); at the default it is skipped.
- **The website check** runs only when `LIVE_SITE_URL` names a site the agency controls (for example this app's `/privacy` page). It is free.
- **Nothing is stored and nothing is sent.** Sandbox sending (to the agency's own test recipients) is checked by a person in the app (runbook §12), never by an automated test.
- **Approval.** Live checks spend real money. Run them only with the owner's approval, and record the date, budget and result in the release notes.

```bash
LIVE_INTEGRATION=1 LIVE_BUDGET_USD=0.15 npm run test:live
```
