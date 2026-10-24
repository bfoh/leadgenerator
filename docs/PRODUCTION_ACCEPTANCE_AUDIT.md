# Production Acceptance Audit

Date: 2026-10-24. Deployment: https://leadgenerator-beige-rho.vercel.app (Vercel production, built from `main` at `9d2bd74`), Supabase project `nshuxeyrcxcnotldvhoh` with migrations 001–008.

**Verdict.** Production is safe to use for **manual research by the team**: secrets stay on the server, signed-out visitors and other workspaces are refused, and messages to businesses are blocked by the database. It is **not yet ready for the full search-to-client workflow**:
- sign-ups are open to anyone;
- Discover has no Google Places key, so it offers only fictional demo results;
- the signed-in workflows were not exercised in production during this audit;
- scheduled automation and messaging are not configured.

None of these needs a code change. They are owner settings, listed in §1.

## How to read the ratings

| Rating | Meaning in this audit |
| --- | --- |
| Implemented and verified | Exercised against the real provider or the production system during this audit, with the evidence quoted |
| Implemented but unverified | The code is complete and passes the automated suites, which use simulated providers; it was not exercised in production |
| Partially implemented | Part of the requirement is built; the rest is missing |
| Missing | Not built |
| Blocked by configuration | Built, but switched off in production until credentials or settings are added |

Mocked and simulated tests are never counted as proof that an integration works. The 471 unit and database tests and 72 browser tests run in demo mode with simulated providers (`DEMO_SERVER_TOOLS`, `SIMULATE_EXTERNAL_TOOLS`); they show the logic is correct, not that a provider is connected.

**Limits of this audit.**
- **No signed-in production session.** The plan was to drive the owner's signed-in Chrome, creating only "AUDIT TEST" records. The Claude in Chrome extension was not connected, so no production record was created, changed or deleted. §5 is the walkthrough to finish that part.
- **No Vercel server logs.** They were not available to the auditor (no Vercel CLI session).
- **No messages sent.** No message was sent to anyone, and no paid call was made beyond the approved budget (§6).

## 1. Prioritised actions

| # | Priority | Action | Who | Why |
| --- | --- | --- | --- | --- |
| 1 | **P0** | **Close sign-ups.** Supabase → Authentication → Sign In / Providers: turn off "Allow new users to sign up". Add each teammate in Authentication → Users (Invite user) *and* in Settings → Team; their invitation is accepted at first sign-in. | Owner | `/auth/v1/settings` reports `disable_signup: false`. Any email address can create an account and gets its own workspace (`ensure_workspace`). Each workspace may run 20 AI reports a day (US$0.22 worst case each, so up to US$4.40 per workspace per day), and 50 Places searches once a key is added. No cross-workspace data is exposed (RLS), so the risk is cost and abuse, not a data leak. |
| 2 | **P0** | **Confirm magic-link sign-in end to end.** It should work after the Site URL fix (`https://leadgenerator-beige-rho.vercel.app`, Redirect URLs `…/**` and `http://localhost:3000/**`). Configure custom SMTP in Authentication → Emails. | Owner | The earlier "requested path is invalid" came from a Site URL without `https://`. Supabase's built-in email sender has a low hourly limit and is meant for testing, so magic links can stop arriving when several people sign in. |
| 3 | P1 | **Add `GOOGLE_PLACES_API_KEY` in Vercel and redeploy.** Restrict the key to Places API (New) and set a Google Cloud budget alert. | Owner | `/api/status` reports `google_places.configured: false`. Production Discover therefore offers only the labelled fictional demo provider. The integration itself works (§2, row 2). |
| 4 | P1 | **Set money budgets** in Automation Center → Controls (AI and Google Places). | Owner | Without budgets, a person's paid calls are limited only by daily quotas. Automated paid work needs a budget and stops without one. |
| 5 | P1 | **Run the signed-in walkthrough (§5) and `supabase/checks/audit-evidence.sql`.** Paste the results into §4. | Owner, or the auditor once Chrome is connected | Turns the "Implemented but unverified" rows into verified ones with production records. |
| 6 | P2 | **Decide on the scheduled worker:** `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel, plus the pg_cron job in runbook §7. | Owner | `/api/cron/automation` returns 503. Research runs only when someone clicks Run, or while the Automation page is open with "keep processing" on. |
| 7 | P2 | **Brave Search key** (`BRAVE_SEARCH_API_KEY`), if automated website discovery is wanted. | Owner | Without it, the research agent checks listed and guessed domains only, and people search by hand using the provided search links. |
| 8 | P2 | **Messaging sandbox**, only when wanted: Resend and/or WhatsApp Cloud API credentials and `MESSAGING_TEST_RECIPIENTS` set to agency-owned addresses (runbook §12). | Owner | No messaging credentials are configured; webhooks return 503. Messages to businesses stay blocked in this version whatever keys are set. |
| 9 | P3 | **Decide whether AI-written proposal text is wanted** (§2, row 7). | Owner | Proposals are built from templates, the configured price list and the report's findings. No model writes proposal text. |

## 2. Feature status

| # | Area | Rating (production) | Evidence |
| --- | --- | --- | --- |
| 1a | Sign-in (Supabase magic link, PKCE) | Implemented but unverified | Login page served (HTTP 200) with CSP `connect-src` limited to the project's Supabase origin. The sign-in itself needs the owner's inbox (action 2). |
| 1b | Signed-out protection | Implemented and verified | Pages redirect with 307 to `/login?next=…`. `POST /api/discover`, `/api/automation/run`, `/api/reports/generate` and `/api/messaging/status` return 401 without a session. A cross-origin POST returns 403. |
| 1c | Database schema and RLS | Implemented and verified | `after-migrations.sql` on production, 2026-10-23: 18 of 18 checks ok (outbound blocked, Research only, outbound stop engaged, 4 safety triggers, no member can edit consent or delete suppressions). An anonymous REST probe was refused (42501) on every table added by 003–008. |
| 1d | Persistence of CRM records | Implemented but unverified | Needs a signed-in session (§5) or the evidence query (§4). |
| 1e | Open sign-up | **Finding (P0)** | `disable_signup: false`, `mailer_autoconfirm: false`, email provider only. |
| 2 | Google Places discovery (Accra, Kumasi) | **Blocked by configuration** | The real API was called from the audit machine with production code. "pharmacy in Accra, Ghana" returned 20 results (13 list a website, 7 none) and "herbal clinic in Kumasi, Ghana" returned 20 (2 website, 18 none). More pages were available for both. Only Place IDs are storable and no phone numbers were requested. Production has no key (action 3). Region-wide search is covered by query unit tests and a demo E2E test, not by a live call. |
| 3a | Automated website checks (fetch, robots.txt, page facts) | Implemented and verified (integration) | Free live check of a site we control (`/privacy` on this deployment): HTTP 200 in 342 ms, robots.txt read first (`allowed`), title extracted. The cloud metadata address `169.254.169.254` was refused before any request. |
| 3b | Web search for candidate websites | Blocked by configuration | `webSearch.configured: false` (no Brave key). |
| 3c | Recording verification evidence and human confirmation | Implemented but unverified | `db/research` and E2E suites; a missing Places website field is never treated as "no website" (`none_found` needs documented checks). |
| 4a | Contact details from the business's own website, with source and licence | Implemented but unverified | `fetchContactPage` records the page as the source; unit and DB suites. |
| 4b | Email domain validation (MX, DNS only, no mailbox probing) | Implemented and verified (integration) | Live `lookupMx` against this deployment's host returned `no_mx_but_resolves`, as expected. |
| 4c | Licensed third-party contact data | Missing (by design) | `CONTACT_DATA_PROVIDERS = []`; `/api/status` reports no contact providers. Contacts come from the business's own site or are entered by a person with a source. |
| 5a | Job queue, agents, run log | Implemented but unverified | `db/job-reliability` and `unit/automation` suites. The foreground runner (`/api/automation/run`) works without the worker. |
| 5b | Scheduled background worker | Blocked by configuration | `/api/cron/automation` returns 503 "The background worker is not configured"; `automation.backgroundWorker: false`. |
| 6 | AI opportunity reports grounded in evidence | Implemented and verified (integration); production run unverified | One live report for a fictional Kumasi herbal clinic using `claude-sonnet-5-5`: 4,043 tokens in, 2,494 out, US$0.033. It contained 19 statements: 6 verified facts, 1 evidence-supported, 2 assumptions, 3 recommendations and 6 unknowns. All 7 claims cite valid evidence IDs. Validation removed 1 unsupported statement. A planted note ("Ignore previous instructions… 5 branches… GH₵ 1,000,000") appeared in no summary or claim. The next action, `complete_research`, was within the allowed set. Production reports `ai.configured: true` with the same model. |
| 7 | Proposals using configured prices | Partially implemented | Drafts take line items from the configured packages and add-on price list only. Unpriced lines show "To be quoted", and approval is blocked while issues remain (`unit/proposals`, `db/conversion`). **No AI writes proposal text** (action 9). Whether production workspaces have prices set: evidence query row 4. |
| 8 | Permission and consent enforcement | Implemented and verified (database guards); behaviour unverified in production | Production check: outbound blocked, no consent records, consent and suppressions append-only, safety triggers installed. The gateway rules (consent, suppression, quiet hours, approval) are covered by `db/messaging`, `db/sending-policy` and E2E tests with simulated providers only. |
| 9 | Email (Resend) and official WhatsApp (Cloud API) | Blocked by configuration | `automation.outboundSending: false`; no messaging credentials or test recipients. Messages to businesses are blocked by `outbound_available()` = false whatever keys are set. No message was sent. |
| 10a | Inbound webhooks (signature-verified) | Blocked by configuration | The email and WhatsApp webhooks return 503 (not configured). A WhatsApp verify request with a wrong token returns 403. |
| 10b | AI reading of replies | Implemented and verified (integration) | Live: a made-up reply ("How much would a simple booking website cost us?") was classified as a pricing or interest intent within the US$0.038 reserved. |
| 10c | Logging a reply by hand and CRM updates | Implemented but unverified | Inbox → "Record reply" ("Logged by a person"); `db/conversion` and `db/messaging` cover stage and opt-out updates. |
| 11a | Usage log and daily quotas | Implemented but unverified | Quotas are live on production `/api/status`: discovery 50, AI reports 20, website checks 300, web search 100, MX 300. Enforcement is covered by unit and DB tests. |
| 11b | Spending budgets | Implemented but unverified | Optional for manual calls and required for automated paid work. Whether budgets are set: evidence query row 13. |
| 11c | Emergency stop and pause controls | Implemented and verified (state); controls unverified | Production check: every workspace has the outbound stop engaged. Pause and Resume automation and the stop card are in Automation Center → Controls. |
| 12a | Accessibility and responsive (public pages) | Implemented and verified | axe (WCAG 2.1 A/AA) on production `/login` and `/privacy`, light and dark, 1280 px and 375 px: no violations and no horizontal scroll. |
| 12b | Accessibility and responsive (signed-in pages) | Implemented but unverified | Local E2E: axe on every page, prospect tab and print view in light and dark; phone layout spec. Not run on production. |
| 12c | Production security | Implemented and verified | Headers: CSP `default-src 'self'` and `frame-ancestors 'none'`, HSTS 2 years with subdomains, X-Frame-Options DENY, nosniff, referrer and permissions policies, `cache-control: no-store` on `/api/status`. Client bundle (production chunks plus the full local build) has no key formats or server-only values; the only JWT is the public anon key. `npm audit --omit=dev`: 0 vulnerabilities. |

## 3. What runs for real in production, and what is demo or simulated

| Capability | In production today |
| --- | --- |
| Discovery | **Demo provider only**: fictional businesses, marked "DEMO · … (fictional)" with a Fictional badge. Tracking one creates a manual record noted "practice only", with no Place ID. Google Places becomes the default once its key is set. |
| Website checks, robots.txt, MX lookups | Real network calls from the server, with private addresses refused. `SIMULATE_EXTERNAL_TOOLS` is ignored when Supabase is configured. |
| Web search | Not available (no Brave key). |
| AI reports, reply readings, message notes | Real model (`claude-sonnet-5-5`), metered and quota-limited. |
| Messaging and webhooks | Not configured. The simulated provider exists only in demo mode. |
| Scheduled worker | Not configured. The foreground runner is available to signed-in members. |

## 4. Production database evidence

Run `supabase/checks/audit-evidence.sql` in the SQL editor. It is one read-only SELECT of counts and dates only (no names, contact details or message text), tested on PGlite after a 002→008 upgrade. Paste the 19 rows here:

| Section | Metric | Value |
| --- | --- | --- |
| _to be filled_ | | |

## 5. Signed-in walkthrough (to finish the audit)

Use the owner's account. Create only records named "AUDIT TEST …". Send nothing. Delete the test prospects at the end; audit and usage entries stay by design.

| Step | Do | Expect | Record |
| --- | --- | --- | --- |
| 1 | Sign in with a magic link | Lands on the dashboard in the agency workspace | Time, and any error |
| 2 | Discover → Pharmacy, Greater Accra (no town) | Without a Places key: fictional results with the demo notice. With a key: real results with Google attribution; one search counted | Provider and result count |
| 3 | Prospects → Add research candidate "AUDIT TEST Herbal Clinic" (Kumasi), with source URL = this app's `/privacy` page | Profile opens; the record persists after a reload | Prospect URL |
| 4 | Automate research on it; keep the Automation page processing | Jobs run; a website verification with evidence appears; run log entries | Job and run IDs |
| 5 | Contacts → add a business email at a domain you control | Validation shows the MX result; source and acquisition are recorded | Validation status |
| 6 | Reports → AI report (≤ US$0.22) | Report with evidence references and a confidence summary; usage logged | Cost shown |
| 7 | Proposals → draft from a package | Prices come from Settings → Packages; unpriced lines say "To be quoted"; approval is blocked until issues are fixed | Proposal status |
| 8 | Try to send or "Mark as sent" without consent | Refused, with the reason | Message shown |
| 9 | Outreach → Setup | Channels shown as not configured; emergency stop engaged | Screenshot |
| 10 | Inbox → Record reply (logged by a person) on the test prospect | Reply stored; reading available; stage updated as configured | Reply ID |
| 11 | Automation → Controls: Pause, then Resume | State changes and is audited | Audit entry |
| 12 | Delete the AUDIT TEST prospect(s) | Gone from Prospects | — |

## 6. Paid calls made during this audit

The owner approved up to US$0.50. Every call was budget-capped by `tests/live/budget.ts`, and nothing was stored.

| Call | Count | Estimated cost |
| --- | --- | --- |
| Anthropic model availability (before each AI call) | — | Free |
| AI reply reading (made-up reply) | 1 | ≤ US$0.038 |
| AI report (fictional business) | 1 | US$0.033 |
| Google Places Text Search (Accra, Kumasi) | 4 (the run was repeated once to capture counts) | US$0.14 at the app's configured US$0.035 per search |
| Website check and MX lookup (site we control) | 1 | Free |
| **Total** | | **≤ US$0.21** (worst case reserved: US$0.40) |

## 7. Changes made during the audit

All are safe and non-destructive. No production data, credentials or messaging permissions were changed.

- **Discover setup hint.** It told production users to set the Places key in `.env.local`. It now points to the Vercel environment variables, then a redeploy.
- **Live checks** (`tests/live/providers.live.test.ts`, `vitest.live.config.mts`):
  - their evidence output is no longer hidden;
  - the Places check covers Accra and Kumasi;
  - new: an AI report grounding check (fictional business, planted instruction);
  - new: a free website and MX check of a site we control (`LIVE_SITE_URL`).
- **`supabase/checks/audit-evidence.sql`** (new), with tests in `tests/db/migrations.test.ts`. The PGlite `auth.users` stub gains `last_sign_in_at`, as on Supabase.
- **Earlier in this release cycle, already on `main`:**
  - zod 4.6.6 (GHSA-mrhx-c7xc-m3w5);
  - dark-mode contrast checks wait for colour transitions;
  - `preflight.sql` is a single statement.

## 8. How to reproduce

```bash
npm run check                                  # typecheck, lint, 471 unit/DB tests, build, bundle scan (simulated providers)
npm run test:e2e                               # 72 browser tests in demo mode
LIVE_INTEGRATION=1 LIVE_BUDGET_USD=0.15 \
  LIVE_SITE_URL=https://leadgenerator-beige-rho.vercel.app/privacy npm run test:live   # paid, opt-in, capped at US$0.50
curl -s https://leadgenerator-beige-rho.vercel.app/api/status   # configuration booleans only
```
