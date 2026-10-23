# Agent Workflows

How the logical agents, the workflow state machine and the job queue fit together. Code: `src/lib/automation/`.

## 1. Agents

An agent is a typed function `run(context, input) → AgentResult` plus a declaration of what it is allowed to do. The engine — not the agent — checks mode, budget, permissions and suppression before calling it, records the run, applies the proposed workflow transition if it is valid, and enqueues follow-ups.

The brief's diagram groups "AI Opportunity & Proposal Agents"; they are implemented as two job kinds (`opportunity_report`, `proposal_generation`), giving fifteen job kinds for the fourteen logical agents.

| Key | Agent | Minimum mode | Paid providers | May change | Never | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `discovery` | Discovery | Research only — user-initiated, never chained or scheduled | Google Places | Nothing stored except permitted IDs when a person tracks a result | Bulk harvesting, storing restricted fields | Existing UI; job form Phase 3 |
| `business_identity` | Business Identity | Research only | — | Identity confidence; flags possible duplicates | Merges anything (every merge is a person's decision, owner/admin only) | **3 🟡** |
| `website_verification` | Website Verification | Research only | Brave Search (optional) | Verification records (pending review when uncertain), workflow state | Claims absence from search failure alone; replaces a person's recent verification; stores search results | **3 🟡** |
| `contact_research` | Contact Research | Research only | — | Contact points with provenance (verified official website only; profile details as CRM records) | Guesses addresses, uses Google Places / search / social contact fields, enumerates WhatsApp, reads private data, records consent | **4 🟡** |
| `contact_validation` | Contact Validation | Research only | — | Validation results and classifications; fills empty profile phone/email from verified business channels | SMTP probing, test messages, treats a valid detail as permission | **4 🟡** |
| `digital_audit` | Digital Audit | Research only | — | Evidence-backed findings (unreviewed until a person accepts or dismisses them) | Unsupported claims; claims about sales, customers or revenue | **3 🟡** |
| `opportunity_scoring` | Opportunity Scoring | Research only | — | Score fields, qualification state | Use AI for the score; override a human override | **2 ✅** |
| `opportunity_report` | Opportunity Report | Research only | Anthropic (only with a budget) | New report version (12 sections, labelled statements); a research task when evidence is insufficient | Invent facts, figures, owners, prices; recommend contact without permission | **5 🟡** |
| `proposal_generation` | Proposal Generation | Research + proposals | — (deterministic) | Draft proposals from the industry template, recorded needs, latest report and the workspace's packages and add-on prices | Invent or change prices; approve, issue or decide a proposal; draft for opted-out or suppressed businesses | **6 🟡** |
| `outreach_drafting` | Outreach Drafting | Research + proposals | Anthropic (optional, only when asked and within budget) | One message draft per contact and purpose, from an approved, policy-covered template; optionally the one-sentence personal note | Approve, schedule, queue or send; set message policies; change consent or suppressions; write free text outside the personal note | **8 🟡** |
| `permission_approval` | Permission & Approval Gateway | Approval-based outreach | — | Eligibility decisions | Be overridden by another agent; use AI | **7 🟡** — built as the deterministic `checkEligibility` function (not a job): run at preview, approval and dispatch, decisions stored append-only |
| `outreach_execution` | Outreach Execution | Approval-based outreach (each message approved) / Eligible automated outreach | Email / WhatsApp providers | Message status | Send without a passing gateway decision; retry when delivery is uncertain | Not built as an agent: a person presses *Dispatch due messages*, and the server re-runs the gateway (phase 8). Sending to businesses stays off |
| `response_classification` | Response Classification | Research + proposals | Anthropic (optional, only when a person ticks AI, within budget and `DAILY_AI_CLASSIFY_QUOTA`) | Readings of received replies (append-only, version recorded), an opt-out suppression when the AI reads an opt-out, workflow to *response monitoring* or *interested*; queues Follow-Up Planning | Read an opt-out as anything else; replace a person's correction; lift a suppression; close a prospect; answer a reply; treat silence as interest | **9 🟡** |
| `follow_up_planning` | Follow-Up Planning | Research + proposals | — | Tasks for people from the `follow-up-1.0.0` plan (deduplicated against open tasks) | Draft, schedule or send messages; plan anything for opted-out, suppressed or closed prospects | **9 🟡** |
| `sales_intelligence` | Sales Intelligence | Research only | — | Nothing (read-only insights) | Change records | Planned after phase 10. Analytics shows replies by meaning and proposal outcomes from stored records instead |

Every agent declares a `version`. Agent runs record the version, so a decision can be traced to the code that made it.

**What no agent may do** (enforced by `agentStore()` in the engine, whatever an agent's code or a page it read asks for): record or change consent, lift a suppression, delete contact details, prospects, tasks, proposals or milestones, merge or un-merge prospects, change workspace settings or members, change contact permission — except recording an opt-out — or create a proposal in any status but draft, or approve, issue or decide one (status changes other than to draft, and the approval, sent and decision timestamps, are refused). For messages (phase 7), agents may create drafts that name their version, cancel or return them to draft, and record *preview* gateway decisions only; they may not approve, queue, send or record delivery, record or change received messages, manage templates or message policies (phase 8), or delete messages. For replies (phase 9), agents may record readings as `agent` (never as a person's correction, never anything but opt-out for a reply the opt-out rules matched) and may not record or decide proposal change requests. The database adds its own guards (consent needs a signed-in person; suppression lifts need an owner/admin).

## 2. Workflow state machine

`businesses.workflow_state` tracks where a business is in the automation lifecycle. The existing CRM `stage` stays the sales view people work with; the two are linked (§2.3).

### 2.1 States

| Group | States |
| --- | --- |
| Research | `discovered` → `identity_research` → `website_verification` → `contact_research` → `qualification` → `opportunity_report` → `proposal_draft` |
| Outreach | `outreach_eligibility_check` → `human_approval` → `ready_for_outreach` → `contacted` → `response_monitoring` |
| Conversion | `interested` → `meeting` → `negotiation` → `client_won` |
| Holding | `research_incomplete`, `needs_human_review`, `unreachable`, `retry_pending`, `failed` |
| Closed | `not_interested`, `opted_out`, `disqualified`, `archived` |

### 2.2 Transition rules (`checkTransition`)

1. **Opt-out wins.** Any state may move to `opted_out`. While the contact permission is *opted out*, the database forces `opted_out` (or `archived`) and nothing else is accepted. Only a person can move a business out of `opted_out`, and only after the permission is no longer *opted out*.
2. **Research moves are free within the research group** for agents and people (forward to the next step, back for a re-check).
3. **Agents cannot enter the outreach or conversion groups**, except the deterministic gateway (`outreach_eligibility_check` → `human_approval` / `ready_for_outreach`), Outreach Execution (`ready_for_outreach` → `contacted`) and Response Classification (`contacted` / `response_monitoring` → `response_monitoring` / `interested`). Closing a prospect as *not interested* is a person's decision; an opt-out moves the prospect to `opted_out` through the suppression and permission rules, not through the agent.
4. **`ready_for_outreach` and later require recorded permission** with a lawful basis, matching the existing CRM gate.
5. **Holding states** may be entered from any open state by agents or people and left to any research state.
6. **Closed states** are left only by people (`archived` → `discovered`, `not_interested` → `qualification`, `disqualified` → `qualification`).
7. Every change writes a `workflow_transitions` row (from, to, actor type, reason, time) via a database trigger, so a change cannot go unrecorded.

### 2.3 Relationship to the CRM stage

| CRM change (by a person) | Workflow effect (database trigger and demo store) |
| --- | --- |
| Stage → Won | `client_won` |
| Stage → Lost | `not_interested` when interest is "none", otherwise `disqualified` |
| Stage → Archived | `archived` |
| Stage → Discovery meeting / Negotiation | `meeting` / `negotiation` |
| Permission → Opted out | `opted_out` |

The reverse is deliberately narrow: agents may move the CRM stage only from *Research candidate* to *Verification pending* or *Qualified*, through the existing `canEnterStage` gate.

Existing records receive a derived state when migration 003 runs (unverified research candidates become `discovered`, verification pending becomes `website_verification`, qualified becomes `qualification`, and so on). Before the migration is applied, the app derives the same value on read.

## 3. Jobs

| Status | Meaning | Next |
| --- | --- | --- |
| Pending | Waiting for `run_after` (new, retrying or deferred by a budget) | Running, Cancelled |
| Running | Claimed by a worker under a lease | Succeeded, Pending (retry), Failed, Cancelled |
| Awaiting approval | A person must approve before it can run | Pending, Cancelled |
| Succeeded | Finished; result and run recorded | — |
| Failed | Dead-lettered: permanent error or attempts exhausted | Pending (manual retry; never for outbound) |
| Cancelled | Stopped by a person, a mode change, opt-out or the emergency stop | Pending (manual retry; never for outbound) |

Before running, the engine checks, in order:
1. The organization is not paused and the agent is enabled.
2. The mode allows the agent.
3. For outbound agents: the emergency stop is lifted, outbound is available in this build, and the gateway passed.
4. The input validates.
5. The business still exists and is not opted out.
6. Budgets for every paid provider the step may use: an explicit budget must exist, and the estimated cost must fit in today's and this month's remaining amounts.

Failures are classified as retryable (provider 5xx or 429, network, timeout), permanent (validation, permission, policy), budget (deferred to the next window without using an attempt) or uncertain delivery (outbound only; never retried).

## 4. Pipelines

The orchestrator (`followUps`) chains steps deterministically from each result. Steps that are not yet available are listed as manual in the plan shown to the user.

**Research pipeline (Phase 4):** `business_identity` → `website_verification` → `digital_audit` → `opportunity_scoring` → (qualifying prospects only) `contact_research` → `contact_validation` → `opportunity_report`. Without migration 004 the pipeline starts at `opportunity_scoring`; without migration 005 scoring goes straight to the report; without server-side tools (demo without `DEMO_SERVER_TOOLS`) identity is followed directly by scoring, and contact research only tracks the profile's own details.

- **Business Identity** scores identity confidence from the recorded facts (provider ID, source reference, precise location, city and category, a business channel, a verified website, operating status, unresolved duplicates) and looks for possible duplicates in the workspace. An exact or likely duplicate stops the pipeline at `needs_human_review`; the prospect profile offers *Merge…* (owner/admin), *Branch of it*, *Different business* and *Dismiss*. Nothing is merged automatically.
- **Website Verification** follows the brief's 13 steps: up to three planned searches (exact name + city, name variations, Ghana location terms) and one for the most plausible resolving domain — at most four per prospect; DNS probes of the recorded host and six name-derived domains; one robots.txt-respecting homepage check per candidate (at most five), plus up to two domains linked from the business's own site. It classifies the result (nine classifications), scores evidence confidence 0–100 with the factors shown, and records queries, candidates, verdicts, timestamps and agent version — never the search results themselves (Brave terms). Search runs only when it is configured **and** a Brave Search budget is set.
  - It skips (and goes straight to the audit) when a person verified the website in the last 90 days and no re-check is due, unless forced.
  - **Review is required** when evidence confidence is below 75, the classification is *identity uncertain*, *human review required* or *outdated website potential*, a site failure is seen for the first time (a temporary outage is possible), or the result disagrees with a person's verification from the last year. Then the result is stored as *pending review*, never replaces a settled verification (one made or confirmed by a person, or an agent result that needed no review), and the workflow moves to `needs_human_review`; the pipeline stops there. The prospect appears under **Verification queue → Needs review**.
  - Absence conclusions (*no official website discovered*, *social-only presence*) need both web searches and domain checks with confidence ≥ 50, otherwise the result is *insufficient evidence*. The app never states that a business has no website.
- **Digital Audit** turns the verification in force and its site check into findings, each with an ID, category, title, evidence (1–10 items with sources), severity, confidence, a business-impact hypothesis, a recommended solution and a review status. Verified issues (observed directly) are kept separate from growth opportunities (hypotheses). Re-running supersedes unreviewed findings; accepted or dismissed findings are not raised again on the same evidence.
- **Opportunity Scoring** is unchanged from Phase 2. A person's score override (with a written justification of at least 20 characters) is the effective opportunity score; the computed breakdown stays visible, and changes are audited.

- **Contact Research** runs only for prospects scoring is ready to report on (data minimisation). It tracks the profile's phone and email as `crm_record` contact points (with the profile's recorded source, or marked undocumented so they stay "needs review"), then — only if the website status is *verified official* — reads the homepage and at most one same-site contact page it links to (robots.txt first) and records mailto/tel links, the business's own WhatsApp links, JSON-LD contact markup, visible addresses and numbers, and the contact page or form, each with its page URL and extraction method. It does not read the site again within 30 days unless a person asks; details no longer on a page it read are marked *outdated*, not deleted. It never guesses addresses, reads social platforms or checks numbers against WhatsApp. Moves the workflow to `contact_research`.
- **Contact Validation** looks up MX records for the email domains (DNS only), validates each contact point (syntax, domain, E.164 and number type, duplicates across prospects), classifies it (§2 of CONTACT_PERMISSION_MODEL), fills empty profile phone/email from verified business channels, moves the workflow to `qualification`, and in the pipeline queues the report. Classification is never permission: every channel stays "Permission required" until a person records consent.

Report conditions: the pipeline queues `opportunity_report` when the business is active, scores in the *qualify* band or above, has a conclusive website verification (not *unverified* or *insufficient evidence*), and has no report since its latest verification.

**Opportunity Report (Phase 5, `report-2.0.0`).** Collects the evidence pack — profile, identity confidence, non-rejected verifications and technical checks, open or accepted audit findings, social presence, contact channels summarised by type, source, validation and consent (never the addresses or numbers), business-level permission, the score, and the team's commercial notes — then checks readiness: website position verified, verification evidence present, and research confidence at or above the workspace minimum (Settings → Agency → Automatic reports, default 50). If research is insufficient it writes no report: it records what is missing, moves the workflow to `research_incomplete` and opens one task, *Complete research before an opportunity report*. A person can still ask for a report (Reports tab, or the agent with `force`), and the gaps then appear as limitations.

The report has twelve sections (business overview, research summary, website findings, contact channel assessment, digital presence, opportunities, recommended solution, implementation phases, expected benefits, limitations, evidence references, next commercial action). Every statement carries one label — verified fact, evidence-supported finding, recommendation, assumption or unknown — and the deterministic validator (`validateReport`) runs on every version, whoever wrote it:
- facts and findings must cite evidence that exists; uncited ones move to limitations;
- a fact or finding about revenue, customer or staff numbers, years in operation, conversion rates, software in use, the owner, budget, prices, awards or reviews is removed unless its cited evidence mentions the same thing; recommendations and assumptions may not state those either unless the evidence does, and no section may contain monetary amounts or guaranteed results;
- "no website" may be said only when documented checks found none, and only hedged;
- summaries that break these rules are replaced with the rule-based summary;
- the next action is limited to what the research and recorded permission allow (`allowedNextActions`): no proposal or discovery call without permission, nothing but *do not pursue* or *review* for opted-out or suppressed businesses;
- evidence references and the confidence summary are computed, never written by the model.

AI-assisted reports run only with an Anthropic budget, within the server's daily AI report quota. The server first checks the configured model with the Models API (free; refuses before any paid call if the model is gone or lacks structured outputs), sends the pack as data inside an escaped wrapper, and validates the structured output with Zod and then `validateReport`. When the quota is used up, automatic runs write the free rule-based report instead; an explicit AI request is retried later. Reports saved before Phase 5 are converted for display and never rewritten.

**Proposal Generation (Phase 6, `proposal-1.0.0`).** When a report is saved, the report agent checks whether it supports a proposal and, if so, queues `proposal_generation` with that report; in *Research only* mode the engine records the step as skipped. The agent is deterministic (no AI, no paid provider) and drafts only when all of these hold — otherwise it records why and changes nothing:
- the business has not opted out, is not suppressed, is not inactive and is not won, lost or archived;
- there is a report, written after the latest website check, with medium or high confidence, whose next action is not *complete website verification*, *complete the research*, *review manually* or *do not pursue*;
- no draft, approved, sent or accepted proposal exists for the business (no duplicates);
- the workspace has at least one package.
A person may ask for a draft with `force`, which overrides only the report-quality conditions, never opt-outs, suppression or duplicates.

The plan (`planProposal`, `src/lib/domain/proposal-templates.ts`) picks the sector template from the category (fashion, bridal, furniture, beauty, hospitality, food, auto, events, creative, fitness, education, professional, general) and reads the team's recorded *service needs* (free text matched to needs such as online selling, payments, booking, catalogue, inventory, quotes, delivery, ordering, content, automation, app, reminders, accounts, WhatsApp):
- the package is the sector's routine package (Starter Website or Business Website Plus) unless a recorded need asks for more: online selling → Ecommerce; an app or automation → Mobile Application or Business Automation only when the business already has a verified website (otherwise a roadmap); a need for managed content, catalogue, booking, quotes or accounts → at least Business Website Plus; a budget recorded as *limited* → Starter Website with the rest listed for later;
- add-ons come only from the workspace's price list (Settings → Packages → Add-on price list): an add-on a recorded need asks for is a quoted line; up to three sector add-ons are offered as optional lines (outside the totals); add-ons the package already covers are not quoted twice; add-ons missing from the price list are left out and listed;
- every choice carries a reason. The reasons, the template, the report version and the add-on decisions are stored in the draft's `basis` and shown in the editor as *How this draft was prepared*; they are never printed. A person's own package choice is recorded next to the recommendation.

The draft's content is assembled deterministically: an executive summary, an evidence-based problem statement (the report summary plus its cited website and presence findings in client wording; verification logs, recorded fields, scores, notes and contact or permission lines stay internal), opportunities from the report, the recommended solution with what is included, optional and planned for later, deliverables, exclusions, phases, a timeline only from configured phase durations, the quotation, 50/50 payment milestones, hosting and support lines, sector assumptions and questions to confirm in discovery. Prices are configured prices or *To be quoted*; totals are computed in code. The workflow moves to `proposal_draft`. Approval, issue and the client's decision remain with people.

**Outreach Drafting (Phase 8, `outreach-drafting-1.0.0`).** Runs only when a person asks: *Draft with the agent* on a prospect's Messages card, with a purpose (introduction, follow-up, proposal) and an optional AI note. It is never chained from another agent. It reads the prospect's contact points, approved templates, message policies, consent records, suppressions and message history. For each email or WhatsApp contact point and each approved template for the purpose, it runs `checkEligibility` in memory on what the draft would be. It keeps the pairs that pass the business, suppression, consent, contact, template, policy and frequency checks. Mode, sender, timing and approval are left to approval and dispatch.
- It writes nothing, and records why, when:
  - the business opted out;
  - no pair passes (it reports the closest candidate's failures, such as "No email consent on file." or "No active message policy covers …");
  - a draft, approved or queued message with the same purpose already exists for that contact;
  - for a proposal message, no proposal has been approved or issued.
- Without the AI step, only templates without `{{personal_note}}` can be drafted.
- With the AI step (ticked by a person; it needs an Anthropic budget and the `DAILY_AI_NOTE_QUOTA` quota):
  - the server sends the evidence pack as data inside an escaped wrapper;
  - the model returns `{insufficient, note, evidenceIds}`;
  - `groundNote` keeps only cited evidence IDs that exist and applies the note rules;
  - a note that fails is discarded, and its usage is still recorded.
- `draftMessage` checks the note again, so even a faulty tool cannot put a rule-breaking sentence in a draft.
- The draft names the agent version. Approval, scheduling, queueing and dispatch stay with people and the gateway.

Scoring moves the workflow (only from research or holding states): unverified or inconclusive website → `website_verification`; inactive business → `needs_human_review`; *Research needed* band → `research_incomplete`; otherwise → `qualification`. A successful report moves it to `opportunity_report`.

Each follow-up's idempotency key is `{trace}:{agent}:{business}`, so a replayed step cannot enqueue a second copy.

## 5. Inspecting a run

The Automation Center lists jobs and agent runs. The job inspector shows the job's input and result, attempts, timing, errors, its runs (agent version, decision, duration, cost, model) and the other jobs in the same pipeline. The run log adds confidence, provider calls and token counts. On the prospect profile, the Activity tab's *Workflow and agents* card shows the workflow history (with who or what moved it, and why) and the agent runs for that prospect.
