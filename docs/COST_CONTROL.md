# Cost Control

The app enforces its own spending limits. Provider billing alerts (for example Google Cloud budget alerts) only notify; they do not stop spending, so they are a second line, not the control.

## 1. Layers

| Layer | What it does | Where |
| --- | --- | --- |
| Per-request rate limit | Bursts per user and operation | `rate-limit.ts` (per server instance) |
| Daily quotas (count) | Max calls per operation per organization per rolling 24 h | `enforceQuota`, `DAILY_*_QUOTA` |
| **Budgets (money)** | Daily and monthly USD limits per provider and in total, per organization | `automation_settings.budgets`, `src/lib/automation/budget.ts` |
| Automation gate | Automated jobs may use a paid provider only when a budget for that provider is set | Engine pre-check |
| Provider-side caps | Hard caps configured at the provider | Google Cloud quotas (requests/day for Places API), Anthropic Console spend limits, Brave plan limits |

## 2. Budgets

- Set in **Automation Center → Controls** by owners and admins. Blank = not set.
- Windows are calendar day and calendar month in Ghana time (GMT, no daylight saving), so a day's budget resets at 00:00 GMT.
- Spend is the sum of `usage_records.estimated_cost_usd` for the provider in the window. Estimates come from the configured unit costs (`*_COST_*_USD`) or, for AI, from token counts × the model's published price.
- **Hard stop:** before any paid call (manual or automated), the estimate is added to the window's spend; if either the daily or monthly budget would be exceeded, the call is refused with a message that names the budget. Automated jobs are deferred to the next window and do not use an attempt.
- **Automation needs an explicit budget.** With no budget set for a provider, manual use continues within quotas, but automated jobs that would call that provider stop with *Set a budget for … to allow automated use*.
- Estimates are conservative upper bounds (for AI: `max_tokens` worth of output). Actual cost is recorded after the call.

## 2a. Paid requests are sent once

The paid-request ledger is in `src/lib/automation/paid-calls.ts`, and the server wrapper is `paidCall` in `src/lib/server/usage.ts`.

- **Recorded before sending.** A zero-cost `<operation>:sent` row holding the request's maximum cost (`metadata.maxCostUsd`, with a `callId` and the `jobId`) is written to `usage_records`. If that write fails, nothing is sent.
- **Settled by the outcome:**

  | Outcome | Row written |
  | --- | --- |
  | Answer arrived | The usual usage row with its actual cost |
  | Answer arrived but cannot be used (cut off, refused by the model, wrong format) | Actual cost, with `metadata.outcome = 'unusable'`; the answer was charged |
  | Provider refused without charging (rate limit, overloaded, invalid request, bad key) | `<operation>:refused` at zero cost |
  | No answer arrived (timeout, dropped connection, worker stopped mid-call) | None: the marker stays open |

- **Open markers count at their maximum cost** in every budget check, manual and automated, and in the Automation Center's spend.
- **No automatic repeats.**
  - The AI SDK's own retries are off (`maxRetries: 0`), because a request that timed out may still have been processed.
  - If a job sent a paid request in an attempt and that attempt failed, the job is not retried automatically, unless the provider refused the request without charge. The job fails with a message saying whether the request was charged or may have been.
  - A job recovered from an expired lease is checked the same way before it runs again.
  - After checking the provider's usage page, a person can **Retry from the start**.
- **Demo mode is not covered.** It runs in the browser and keeps no ledger.

## 2b. Campaign budgets

A research campaign may carry its own monthly ceiling (`research_campaigns.monthly_budget_usd`). It is
an **additional** stop, never a replacement for the per-provider budgets in §2.

- **What counts:** actual cost recorded by agent runs for the campaign's jobs, plus the estimated cost
  of its jobs that are still pending or running (`campaign_spend(campaign_id)`, migration 009).
- **When it is checked:** before a tick adds prospects. Once the ceiling is reached the campaign stops
  starting **new** prospects and says so in its run log. Jobs already queued still finish, and their
  cost is checked against the global budgets as usual.
- **What it cannot do:** raise a provider budget, allow paid work without an Anthropic/Brave budget,
  or bypass the engine's pre-call checks.
- **Selecting prospects is free:** choosing tracked records makes no provider call. Paid work comes
  only from the agents (Brave Search during verification/contact research, Anthropic for an AI
  report), and each of those is metered and budget-checked exactly as before.

## 3. Unit costs (estimates — verify against current price lists)

| Provider / operation | Default estimate | Variable |
| --- | --- | --- |
| Google Places Text Search (field mask includes `websiteUri`) | $0.035 | `PLACES_COST_PER_SEARCH_USD` |
| Google Places Details | $0.02 | `PLACES_COST_PER_DETAILS_USD` |
| Brave Search query | $0.005 | `BRAVE_COST_PER_SEARCH_USD` |
| Anthropic `claude-sonnet-5-5` | $2 / $10 per million input / output tokens; for the seeded research records the evidence pack is ~3,000 characters (under 1k tokens) plus a ~1k-token system prompt, and the rule-based version of a report is ~8,000 characters (~2k tokens), so an AI report is expected around 2–6k input and 2–5k output tokens (≈ $0.02–0.06; not yet measured against the live API). Estimated up front at $0.22 (30k input + 16k output, the upper bound) | built-in price table |
| Anthropic Models API (model check before each AI report, cached 10 minutes) | $0 | — |
| Website check, DNS probe, robots.txt fetch, identity check, digital audit, rule-based report, scoring, proposal drafting (deterministic, no AI) | $0 | — |
| Contact page read (homepage + one contact page; counts toward `DAILY_WEBSITE_CHECK_QUOTA`), MX lookup (DNS; `DAILY_MX_LOOKUP_QUOTA`, default 300), phone and email validation | $0 | — |
| Licensed contact data providers | None connected; each would need its own budget before automated use | — |
| Messaging (phase 7, sandbox only): template sync, webhooks, unsubscribe | $0 | — |
| AI personal note (`ai_note`, Outreach Drafting agent, optional) | Anthropic tokens. Budget check reserves 20k input + 1k output tokens (about $0.10 with claude-opus-5-5); a typical note is ~3–6k input and under 100 output tokens (about $0.01–0.03). Quota `DAILY_AI_NOTE_QUOTA` (default 40 per workspace per 24 h). Off unless a person ticks *Write the personal note with AI*; usage is recorded even when the note fails the checks and is discarded. |
| Reply classification by rules (`reply-rules-1.0.0`, every reply including webhooks), follow-up planning, meeting briefs, change requests | $0 | — |
| AI reply reading (`ai_classify`, Response Classification agent or *Read with AI*, optional) | Anthropic tokens. Budget check reserves 16k input + 600 output tokens per reply (about $0.08 with claude-opus-5-5; the agent reserves for its 3 replies per run). That is a hard upper bound: replies are cut to 12,000 bytes after escaping and a token covers at least one byte. A typical short reply is ~1–2k input and under 200 output tokens (about $0.01). Quota `DAILY_AI_CLASSIFY_QUOTA` (default 100 per workspace per 24 h). Contact details are masked before the text is sent; webhook replies are never sent to the AI; not yet measured against the live API. |
| Resend email / WhatsApp Cloud API messages | Not metered here: sandbox sends go only to the agency's own test recipients. Resend and Meta bill per their plans (WhatsApp charges per delivered template message by category and country); check both before phase 8 | — |

**Per prospect:** the Website Verification agent sends at most 4 Brave queries (≈ $0.02 at the default estimate), and only when a Brave Search budget is set; the job's estimate is checked against the budget before it runs. The rest of the research pipeline, including contact research and validation, is free unless an Anthropic budget enables AI-assisted reports.

## 4. Recommended starting budgets

| Provider | Daily | Monthly |
| --- | --- | --- |
| Google Places | $2 | $25 |
| Brave Search | $0.50 | $10 |
| Anthropic | $1 | $15 |
| Total | $3 | $40 |

Also set Google Cloud API quotas for Places API (New) — for example 200 Text Search requests per day — which Google enforces as a real cap, and an Anthropic workspace spend limit.

## 5. Monitoring

- Automation Center → Overview shows today's and this month's spend against each budget.
- Analytics → *Estimated API cost* and *Usage by operation* show history. Usage recorded by automated work carries the job ID in its metadata.
- Agent runs record each provider call with its estimated cost.

## 6. Autonomous discovery (milestone 3B)

The only connector is the offline synthetic provider: **cost 0**, no external request, no usage row.
A real provider must not be enabled until it has a declaration cost model, a campaign discovery
spend cap (`research_campaigns.discovery_spend_cap_usd`, checked against `discovery_runs.spend_usd`),
and — if it charges per call — a paid-request ledger entry and a hard provider budget. The campaign’s
monthly budget also includes discovery spend, so a research budget cannot be silently consumed by
acquisition. No paid discovery call has been made.

## 7. Tests never spend money

CI and the E2E suite blank every paid key (including `RESEND_API_KEY` and `WHATSAPP_ACCESS_TOKEN`); messaging tests mock every provider call and demo mode simulates sends. Unit tests use simulated providers; the E2E server sets `SIMULATE_EXTERNAL_TOOLS=true`, so web search, DNS and website checks come from a labelled simulated world and nothing leaves the machine. Unit and database tests also run with the network blocked (`tests/setup/no-network.ts`): a test that forgets its fake fails instead of calling a provider.

**Estimates are upper bounds (phase 10).** Every AI call checks, before sending, that the bytes it sends (system prompt, message and output schema) fit the input tokens its budget check reserved, and refuses otherwise (`src/lib/server/ai/input-bound.ts`). `tests/unit/cost.test.ts` proves it with a hostile reply and an oversized evidence pack, for every priced model.

**Live checks** (`LIVE_INTEGRATION=1 npm run test:live`, docs/TESTING.md §4) are opt-in, never run in CI, reserve each call's worst case against `LIVE_BUDGET_USD` (default $0.15, hard cap $0.50), store nothing and send nothing. A full run is roughly: model lookup $0, one AI reading up to $0.08 (typically about $0.01), one Brave query $0.005, one Places Text Search about $0.03. Run them only with the owner's approval.
