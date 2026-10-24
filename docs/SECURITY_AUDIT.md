# Security Audit (Phase 10)

Date: 2026-10-23. Scope: the Next.js application (pages, route handlers, proxy), the Supabase schema (migrations 001–008, RLS, functions, triggers), the agents and their tool gateway, the CI pipeline and the browser bundle. Method: code review of every route handler and security-relevant module, a review of each migration, automated checks added to the suite (below), and `npm audit`. This is an internal review, not a third-party penetration test.

## 1. Controls verified

| Area | Control | Evidence |
| --- | --- | --- |
| Authentication | The proxy (`src/proxy.ts`) sends signed-out visitors to `/login`; every route handler authenticates itself. User routes call `requireContext` (Supabase user, workspace membership, role capability). The exceptions use their own proof: `/api/status` (configuration booleans only), webhooks (provider signatures), `/api/messaging/unsubscribe` (per-message signed token, rate limited), `/api/cron/automation` (`CRON_SECRET`, constant-time compare) | Route review; `e2e/security`; `unit/monitoring` |
| Authorization | Role capabilities in `src/lib/domain/permissions.ts`, enforced again by RLS and guard triggers in the database (the UI only mirrors them) | `db/rls` and every `db/*` suite |
| Tenant isolation | Every table carries `organization_id` with RLS; composite foreign keys stop rows being attached to another workspace's records; the worker's service-role client is scoped to one organization per run | `db/rls`, `db/job-reliability` |
| Agent authority | `agentStore()` refuses consent, suppression lifts, deletions, approvals, sends, templates, policies, corrections and change requests; database guards repeat the person-only rules (consent needs a signed-in user; suppression lifts need an owner or admin) | `unit/*` agent-store cases, `db/contacts` |
| Request forgery | Non-GET requests with a foreign `Origin` are refused; Supabase cookies are SameSite | `e2e/security` "server tools reject cross-origin writes" |
| SSRF | `safeFetch` resolves and checks every address (private, loopback, link-local, metadata), re-checks redirects, caps size and time | `unit/safe-fetch`, `e2e/security` |
| Secrets | Keys are read only in `server-only` modules; the only public variables are the Supabase URL and publishable key; `/api/status` returns booleans; the browser bundle is scanned for key formats, service-role tokens and the configured secret values (`scripts/check-client-bundle.mjs`, run by `npm run build`, so in `check`, CI and every Vercel build against that deployment's real values) | `scripts/check-client-bundle.mjs` (passed: 149 files, the two configured secret values not present) |
| Webhooks | Resend (Svix) and Meta (HMAC-SHA256) signatures verified in constant time before parsing; events recorded once per provider event ID | `unit/messaging-server`, `db/messaging` |
| Injection | Queries are parameterised; the one interpolated PostgREST filter validates a UUID first. Retrieved web text, evidence and replies are wrapped as data with `<` escaped, and system prompts say not to follow instructions inside; AI output is schema-validated and reconciled with deterministic rules (an opt-out can never be overruled) | `unit/verification`, `unit/reports`, `unit/responses` |
| Audit | Audit triggers on business records; append-only tables refuse update and delete; members cannot delete audit events | `db/*` suites |
| Headers | HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy, and (new) a CSP with `default-src 'self'` and `connect-src` limited to the app and Supabase | `e2e/security` "security headers are set" |
| Logging | Server logs are structured JSON with emails, phone numbers and key-like tokens redacted; request errors log route, method, error name and digest only | `src/lib/server/log.ts`, `src/instrumentation.ts`, `unit/monitoring` |
| Dependencies | Exact version pins; `npm audit`: 0 vulnerabilities (production and development) on 2026-10-23; CI fails on high severity | CI |
| Paid APIs in tests | Network blocked in unit and database tests; E2E and CI run with keys blank; live checks opt-in and capped | `tests/setup/no-network.ts`, `unit/cost`, `docs/TESTING.md` §4 |

## 2. Findings in this audit

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| S-1 | Medium | **AI cost bound could be exceeded.** The reply classifier capped text at 10,000 characters *before* escaping `<` into a six-character sequence, so a hostile reply could send about 60,000 characters against a reservation of 6,000 tokens; evidence packs had no size check at all. A budget hard stop could be overshot. | **Fixed.** Text is cut to 12,000 UTF-8 bytes after escaping; reservations are true upper bounds (a token covers at least one byte); every AI call checks the byte bound before sending and refuses otherwise (`src/lib/server/ai/input-bound.ts`). `unit/cost`. |
| S-2 | Medium | **CSP did not restrict sources.** The policy set only `frame-ancestors`, `base-uri`, `form-action` and `object-src`, so injected script could have loaded code from or sent data to any origin. | **Fixed.** `default-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'` plus the Supabase origin, no `unsafe-eval` in production (`next.config.ts`). |
| S-3 | Low | **Unredacted error text in logs.** Unexpected API errors logged 200 characters of the error message, which can contain personal data from a provider or the database. | **Fixed.** Structured logs with redaction; the Next request-error hook logs no message text. |
| S-4 | Low | **CI blanked only some secrets.** Messaging, worker and service-role variables were not blanked, so a repository secret added later could have reached a test run. | **Fixed.** Every server secret and `LIVE_INTEGRATION` blanked in CI. |
| S-5 | Info | No automated check that secrets stay out of the browser. | **Added** `npm run check:bundle` to `check` and CI. |
| A-1 | Accessibility | Dialogs did not return focus to what opened them (they open from state, and an autofocused field skips Radix's own handling). | **Fixed** in `src/components/ui/dialog.tsx`; `e2e/accessibility`. |

## 3. Open risks

| ID | Severity | Risk | Recommendation |
| --- | --- | --- | --- |
| R-1 | Medium | **Rate limits are per server instance** (in memory). On a serverless host each instance has its own counters. Paid work is still bounded by database-backed daily quotas and budgets. | Add edge rate limiting (host firewall or a shared store) before opening sign-up or adding users outside the agency. |
| R-2 | Medium | **Open sign-up.** With Supabase sign-ups on, anyone can create a workspace and use metered tools within the quotas. | Turn off "Allow new users to sign up" and invite teammates (runbook §1). |
| R-3 | Low | **`'unsafe-inline'` scripts in the CSP.** Needed for Next's bootstrap and the theme script without nonces (nonces would make every page dynamic). Mitigated by React escaping, no HTML rendering of stored text, and `connect-src` limits. | Revisit with Next's hash-based (SRI) CSP once it is stable. |
| R-4 | Low | **Supabase session cookies are readable by page script** (the browser client needs them). An XSS could use the session. | Same mitigations as R-3; keep `dangerouslySetInnerHTML` limited to the static theme script (it is today). |
| R-5 | Low (closed) | **Production schema unverified.** Closed on 2026-10-23: the owner applied 003–008 to the live project, and `supabase/checks/after-migrations.sql` passed there (opt-outs suppressed, outbound blocked, append-only privileges and safety triggers in place). A probe with the public key was refused on every new table. | For later migrations, follow `docs/MIGRATION_REVIEW.md` §3. |
| R-6 | Info | **No third-party test.** | Commission a penetration test before real outbound messaging is turned on. |
| R-7 | Info | **Webhook endpoints are not rate limited**; signature checks run first and are cheap, and unsigned requests are refused. | Covered by R-1. |

## 3a. Scheduled worker review (2026-10-24, before activation)

Scope: `GET /api/cron/automation`, the service-role client, and everything the worker can reach. Done before the owner sets `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.

| Question | Answer | Evidence |
| --- | --- | --- |
| Can it be called without authorization? | No. It returns 503 until Supabase, `CRON_SECRET` and the service-role key are all set. After that it needs `Authorization: Bearer <CRON_SECRET>`, compared in constant time; anything else gets 401 before the database is touched. | `unit/monitoring` "refuses callers without the exact cron secret before touching the database", "is off (503)…"; production returns 503 today |
| What does it reveal? | Counts only (`organizations`, `processed`, outcomes). Errors are generic; unexpected ones are logged by error name. Logs pass through `redact`. | Route review; `fail()` in `src/lib/server/http.ts` |
| Where can the service-role key appear? | Only in `src/lib/supabase/service.ts` (`server-only`) and the routes that need it. Never in `/api/status` (booleans only) or any response. The build fails if its value, a service-role JWT or an `sb_secret_` key reaches the browser. | `scripts/check-client-bundle.mjs` in `npm run build`; production chunks scanned 2026-10-24 (only the anon JWT) |
| Are workspace boundaries explicit? | Yes. The route lists workspaces with due jobs (skipping paused ones) and runs each separately. `SupabaseStore` and `SupabaseAutomationStore` add `organization_id = <workspace>` to every read, update and delete, and force it on every insert (patches cannot change it). The queue functions are called with that workspace (`p_org`), never the cross-workspace form, and a job is finished only with its own lease token. | Static check of every `.from()`/`.rpc()` in the stores and server tools; `db/automation`, `db/job-reliability` |
| Can privileged access bypass business rules? | No. Agents get `agentStore()`, which refuses consent, suppression lifts, deletions, merges, approvals, sends, templates and settings. The database repeats the person-only rules, with no signed-in user for the worker: consent "is recorded by a signed-in person", merges need an owner or admin, and reply corrections need a person. `service_role` has no privilege to edit consent, delete suppressions, change message policies or gateway decisions, or create change requests. Paid automated calls need a budget (hard stop) and count against quotas. Messages to businesses stay blocked by `outbound_available()`. | `unit/*` agent-store cases; `db/contacts`, `db/messaging`, `db/conversion`; `after-migrations.sql` rows 11–16 on production |
| What else does the service-role key switch on? | Message dispatch, WhatsApp template sync, unsubscribe links and provider webhooks. Each also needs its own credentials (Resend or WhatsApp keys, sender, webhook and unsubscribe secrets) and answers 503 or reports sender issues without them. Dispatch also needs a signed-in member who may approve outreach. | `senderConfigIssues()`; webhook and unsubscribe route guards |

Result: no blocking issue. One change made: the bundle scan now runs in every build, including Vercel's.

**Follow-up after activation (2026-10-24): time limits and repeated paid requests.**
- *Finding:* the worker route was stopped at 60 s while AI steps may take 120 s. A paid request cut off by the platform went unrecorded and was retried, and the AI SDK also retried timed-out requests on its own.
- *Fix:*
  - Both job routes allow 300 s and start a job only if the slowest job can finish in time.
  - SDK retries are off.
  - Every paid AI request goes through the paid-request ledger (COST_CONTROL §2a): recorded before sending, open requests counted at their maximum cost, and no automatic retry after a request that was or may have been charged.
- *Tests:* `unit/automation` "worker time limits and paid requests", `unit/paid-requests`, `db/automation` "hands a recovered job back marked as timed out…" and "paid-request ledger".
- *The worker's privileges are unchanged.* The ledger rows are ordinary inserts in its own workspace, and `usage_records` stays insert-only for members.

**Research campaigns (milestone 2, migration 009).**
- *Scope:* campaign routes and worker ticks. Each query is scoped to the caller's organization; the
  worker uses the service-role client per organization. No route returns another workspace's rows.
- *Authorization:* `GET`/preview/run need `automation.run`; create/edit/delete need
  `automation.manage` (owners/admins). RLS repeats both checks. Membership history is append-only at
  grant and policy level. A PATCH refuses any field change on a completed or cancelled campaign, and
  refuses scope/schedule changes while a batch is researching (name, quotas and budget stay editable).
- *Input and output:* bodies are size-limited and schema-validated (scope arrays, region names,
  district codes, schedule combinations, provider); errors are mapped without record contents. The
  provider is immutable after creation, so a saved campaign cannot be repointed.
- *Consent:* the eligibility filter and the engine both refuse opted-out prospects; merged, archived
  and inactive records are excluded. No outbound path is added.
- *Provider boundary:* a campaign may use only a provider declared for unattended discovery + CRM
  processing. Google Places is refused by the application **and** by a database check, so a bug or a
  direct insert cannot turn user-initiated discovery into scheduled harvesting.
- *Spend:* `campaign_spend` runs with the caller's rights (RLS applies) and is informational; every
  paid call still passes the global budget checks.
- *Queue integrity:* campaign jobs carry both the campaign and the membership; the 009 enqueue function
  refuses a membership that belongs to another campaign **or another prospect**. Only a newly created
  job is counted in the run log when two ticks race; an existing job re-attaches a stranded membership.
- *Residual risk:* a campaign can queue work faster than the worker drains it; the daily quota and
  batch size bound this, and the queue's own concurrency/lease rules still apply. Two simultaneous
  manual ticks are not claimed like scheduled runs; unique membership and idempotency keys prevent
  duplicate work, and the next tick re-reads the daily quota.
- *Tests:* `unit/campaigns`, `unit/campaign-lifecycle`, `unit/campaign-orchestrator`,
  `unit/campaign-mapping`, `db/campaigns` (RLS, append-only history, provider refusal, job attribution,
  spend, migration re-application, cross-workspace isolation, rollbacks).

## 4. Re-running the audit

Each release: `npm run check` (includes the bundle scan), `npm audit`, the E2E suite, and a review of any new route handler against §1 (authentication, role, origin, rate limit, input schema, error mapping, no secrets in responses or logs).
