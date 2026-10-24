# Operations Runbook

Day-to-day operation of Digital Opportunity Finder in cloud mode (Supabase + a Next.js host such as Vercel). Demo mode needs none of this.

## 1. First-time cloud setup

1. **Back up first.** If the Supabase project already holds v6 data, take a backup (Dashboard → Database → Backups, or `pg_dump`) before running any migration.
2. **Apply migrations in order** in the SQL editor or with the Supabase CLI:
   - `001_private_leads.sql` — only if the project has never had it. It is never edited.
   - `002_workspace_model.sql` — creates the organization model, RLS and functions. It copies existing `leads` rows into `businesses` the first time each owner signs in; the `leads` table is left in place for rollback.
3. **Auth settings** (Dashboard → Authentication):
   - Enable the email provider (magic link and one-time code).
   - Site URL: your production URL. Redirect URLs: `https://<your-domain>/auth/callback` and `http://localhost:3000/auth/callback`.
   - **Decide who may sign up.** Any new user who signs in without a pending invitation gets their own empty workspace and can use metered tools within the daily quotas. For a private agency tool, turn off "Allow new users to sign up" and create teammates from Dashboard → Authentication → Users → Invite, after adding their invitation in Settings → Team.
4. **Environment variables** on the host (never prefix secrets with `NEXT_PUBLIC_`):

   | Variable | Scope | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | public | Project URL. |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `…_ANON_KEY`) | public | Client key; safe in the browser because RLS enforces access. Never use the service-role key here. |
   | `GOOGLE_PLACES_API_KEY` | server | Places API (New). Restrict to that API. |
   | `BRAVE_SEARCH_API_KEY` | server | Optional. |
   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | server | Optional; default model `claude-opus-5-5`. |
   | `DAILY_*_QUOTA`, `*_COST_*_USD` | server | Optional overrides; see `.env.example`. |
   | `DEMO_SERVER_TOOLS` | server | Leave `false` in production. |
   | `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | server | Optional scheduled automation worker (§7). The service-role key bypasses RLS: server env only, never `NEXT_PUBLIC_`. |

5. Deploy, sign in, open **Settings → Agency** to name the workspace, then **Settings → Packages & pricing** to enter your own prices.

## 2. Routine checks

| When | Check |
| --- | --- |
| Daily | Automation Center → **System health** (overdue opt-outs, unknown deliveries, budgets, stuck or failed jobs; docs/MONITORING.md). Analytics → *Estimated API cost* and *Usage by operation* for unexpected spikes. |
| Weekly | Verification queue → *Re-check due*; Overview → *Overdue next actions*. |
| Monthly | Google Cloud billing for project `leadgenerator-512319` against the estimates; review lost/archived prospects for deletion (retention). |
| Quarterly | Restore drill (docs/BACKUPS.md §5); review docs/SECURITY_AUDIT.md §3 open risks. |
| Each release | CI green (typecheck, lint, unit + database tests, build, client bundle scan, E2E, `npm audit --omit=dev`). Deployment steps: docs/DEPLOYMENT.md. |

## 3. Incidents

Serious incidents (a message without consent, a data breach, a leaked secret, runaway cost) follow **docs/INCIDENT_RESPONSE.md**. The entries below are everyday errors.

**Google Places errors.** The Discover page shows the cause without exposing Google's raw message:
- "Places API (New) is not enabled…" → enable it in the Cloud Console for the key's project.
- "Billing is not enabled…" → attach a billing account.
- "…application restrictions block server requests" → the key uses website-referrer restrictions; a server key needs IP addresses (or no application restriction).
- "…restricted to other APIs" → add Places API (New) to the key's API restrictions.
- "Google Places quota or rate limit reached" → Google's quota; raise it in the Cloud Console or wait.
- "Daily discovery_search quota reached (N per 24 hours)" → our own limit (`DAILY_DISCOVERY_QUOTA`), counted over a rolling 24 hours per organization.

**Suspected key leak.** Rotate the key in the provider console immediately, update the host environment, redeploy, then review the provider's usage logs. Keys are never sent to the browser; check that nobody added a `NEXT_PUBLIC_` copy.

**AI report failures.** "rejected the API key" → check `ANTHROPIC_API_KEY`. "declined" or "did not match the report format" → use the rule-based generator; nothing is saved from a failed call.

**User locked out / wrong workspace.** Check `organization_members` for the user. Invitations match on the confirmed email address, lowercased, and are accepted the next time the user opens the app. The app opens a user's oldest membership and has no workspace switcher, so a teammate who signed in before being invited keeps landing in the empty workspace created for them. Fix: after the invitation is accepted, delete their membership in that empty organization (SQL editor, as the project owner), then have them reload.

## 4. Backup and restore

Full procedure, including re-applying opt-outs recorded after the backup: **docs/BACKUPS.md**.

- Supabase daily backups (or point-in-time recovery on paid plans) cover all tables.
- Settings → Data → **Export JSON** gives an owner-level snapshot of one workspace (contains personal data — store securely and delete when done).
- Restoring a single workspace from JSON is not automated; use the backup or re-import with a one-off script reviewed by an engineer.

## 5. Data-subject requests (Act 843)

1. Find the business in Prospects (search by name).
2. **Opt-out:** Contacts tab → *Business-level permission* → *Opted out* (or a contact's actions → *Record opt-out…* for one channel). This blocks every outreach stage and contact activity immediately and, with migration 005, adds a workspace-wide suppression that outlives the record.
3. **Correction:** edit the profile; changes are kept in the audit trail.
4. **Deletion:** delete the prospect (owner/admin). Verifications, activity, tasks, reports, proposals and contact points are deleted with it. Prospects with delivery projects must have those projects resolved first. Consent records go with it; suppression entries (hashes and a masked hint only) are kept so the person is not contacted again — tell the requester this.
5. **Access request:** the prospect's Contacts tab lists every contact detail with its source, purpose and retention date, and the consent history.
6. Record what was done and when in your own request log.

## 6. Rollback

- Application: redeploy the previous build on the host.
- Database: migration 002 is additive. The v6 `leads` table is untouched, so a v6 build still works against the same project. Do not drop new tables without a backup.
- Migration 003: `supabase/rollback/003_automation_infrastructure_down.sql` removes it (tested on PGlite). It deletes the job queue, run log, workflow history and automation settings, so take a backup first. The app works without 003; the Automation Center then shows a "database update required" notice.
- Migration 004: undo any merges you want reversed first (prospect → *Undo merge*), then run `supabase/rollback/004_research_verification_down.sql` (tested on PGlite). It deletes identity decisions, audit findings, agent verification records and score overrides, and leaves merged duplicates archived. Take a backup first. The app works without 004.
- Migration 005: export the suppression list and consent records first (§9), then run `supabase/rollback/005_contact_intelligence_down.sql` (tested on PGlite). Business-level opt-outs are kept and keep blocking outreach. The app works without 005.
- Migration 006: run `supabase/rollback/006_messaging_down.sql` (tested on PGlite). It deletes templates, the outbound queue with its delivery history, eligibility decisions, received messages and webhook events; suppressions caused by replies, bounces and complaints are kept. Take a backup first. Roll back newest first: the 005 rollback refuses to run while 006 is installed. The app works without 006 (the Outreach page then shows a "database update required" notice).
- Migration 008: run `supabase/rollback/008_response_conversion_down.sql` (tested on PGlite). It deletes reply classifications and proposal change requests (with their audit events) and the proposal acceptance guard; received messages, suppressions, proposals and tasks are kept. Roll back newest first: **008 → 007 → 006 → 005**; the 006 rollback refuses to run while 008 is installed. Without 008 replies are still recorded and opt-outs still suppress, but nothing reads what a reply means, and the prospect's Next steps tab shows a "database update required" notice.
- Migration 007: run `supabase/rollback/007_sending_policy_down.sql` (tested on PGlite). It deletes message policies and their audit events, the workspace sending policy and the pause switch, and the database send-policy trigger; messages and decisions are kept (a stored `deferred` decision stays, under a check marked `not valid`). Roll back newest first: **007 → 006 → 005**; the 006 rollback refuses to run while 007 is installed. Without 007 the app keeps the gateway's default sending policy but cannot approve template messages (no policy can cover them), and Outreach → Policies shows a "database update required" notice.

## 7. Automation (migration 003)

### Apply migration 003

The app runs without it. Apply it when you want the Automation Center in cloud mode.

1. **Backup** (Dashboard → Database → Backups, or `pg_dump`).
2. **Inspect current data** in the SQL editor and keep the output:
   ```sql
   select count(*) from public.businesses;
   select stage, website_status, contact_permission, count(*) from public.businesses group by 1, 2, 3 order by 4 desc;
   select to_regclass('public.automation_jobs');   -- null means 003 has not been applied
   ```
3. **Apply** `supabase/migrations/003_automation_infrastructure.sql` as one script. It is additive and re-runnable. Existing businesses get a `workflow_state` derived from their CRM stage once, without changing `updated_at` or writing audit rows. Every existing organization gets settings in *Research only* with the outbound stop engaged.
4. **Verify:**
   ```sql
   select workflow_state, count(*) from public.businesses group by 1 order by 2 desc;
   select organization_id, mode, paused, outbound_stopped from public.automation_settings;
   select public.outbound_available();               -- false in this version
   ```
5. Reload the app and open **Automation Center**. Set budgets (Controls) before enabling any paid automated work.

### Scheduled worker (optional)

Without it, queued jobs run only while a member keeps the Automation Center open ("Keep processing while open") or presses *Process queue now*, and the Worker tile says **This page only**. With it, jobs run on the server whether or not anyone has the app open: the Automation Center only shows their status, bulk research buttons just queue, and the Worker tile says **Background** with the time of the worker's last job (or how many jobs are overdue). To run jobs in the background:

1. Set `CRON_SECRET` (e.g. `openssl rand -hex 32`) and `SUPABASE_SERVICE_ROLE_KEY` on the host and redeploy. `GET /api/cron/automation` returns 503 until both are set, and 401 without the right bearer token.
2. Call it every minute. Vercel Hobby cron runs only once a day, so use Supabase **pg_cron + pg_net** instead:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select vault.create_secret('<the CRON_SECRET value>', 'automation_cron_secret');
   select cron.schedule('automation-worker', '* * * * *', $$
     select net.http_get(
       url := 'https://<your-domain>/api/cron/automation',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'automation_cron_secret')),
       timeout_milliseconds := 60000
     );
   $$);
   ```
   Stop it with `select cron.unschedule('automation-worker');`.
3. Each call processes up to five jobs for each of up to 20 workspaces with due or stalled jobs (longest-waiting first; paused workspaces are skipped), scoped per workspace, and returns counts only.
4. **Check it:** run `supabase/checks/worker-health.sql` (read only). After a few minutes the schedule row says `* * * * *, active`, the runs are `succeeded`, and the worker route answers `200`. A `401` means the Vault secret and `CRON_SECRET` differ; `503` means a variable is missing on the host (redeploy after setting it).

### Acceptance test: research continues with the browser closed

1. Automation Center shows **Worker: Background**. Set a budget for any paid provider the research will use (Controls).
2. Add a prospect named "AUDIT TEST …" with a source URL you control. Press **Automate research** and close the browser straight away (the button only queues work when the background worker is configured).
3. Wait five minutes, then run `supabase/checks/worker-health.sql`. Row "run by the background worker" lists the research agents (business identity, website verification, digital audit, scoring and, if the prospect qualifies, contact research and the report); "run from the app" stays at 0 for them.
4. Open the app again: the prospect's Activity tab marks each run "Background worker", and the verification, audit, score and report are stored. Delete the test prospect afterwards.

### Operating

| Situation | Action |
| --- | --- |
| Something looks wrong | Controls → **Pause automation**. Running jobs finish; nothing new starts. |
| Jobs waiting with "Budget limit" | Expected: the budget for that provider is used up. They resume in the next GMT day or month, or after an owner raises the budget. |
| Job failed (dead letter) | Jobs → Failed → open the job, read the error and run log, fix the cause, then **Retry from the start**. Outbound jobs (future) are never retried. |
| Job stuck in Running | Its lease expires after three minutes and the next claim recovers it (research work is retried; outbound work would be marked "delivery status unknown"). |
| An agent misbehaves | Agents → turn it off. Its jobs wait in the queue. |
| Spend spike | Analytics → estimated API cost; Automation Center → Spend against budgets; lower or clear the provider's budget to stop paid automated work immediately. |

## 8. Research and verification (migration 004)

### Apply migration 004

The app runs without it (agent verification, identity decisions, merges, audit findings and score overrides are then unavailable, and the research pipeline starts at scoring). It applies with or without 003; the pipeline itself needs 003.

1. **Backup** (as in §7).
2. **Inspect current data** and keep the output:
   ```sql
   select count(*) from public.businesses;
   select count(*), count(distinct business_id) from public.website_verifications;
   select status, count(*) from public.website_verifications group by 1 order by 2 desc;
   select to_regclass('public.identity_links');      -- null means 004 has not been applied
   ```
3. **Apply** `supabase/migrations/004_research_verification.sql` as one script. It is additive and re-runnable. Existing verification rows become person-made records that need no review; no business row is changed.
4. **Verify:**
   ```sql
   select actor_type, review_status, count(*) from public.website_verifications group by 1, 2;   -- all 'user', 'not_required'
   select count(*) from public.businesses where merged_into_id is not null or score_override is not null;  -- 0
   select has_function_privilege('anon', 'public.merge_businesses(uuid, uuid, text[], text)', 'execute');  -- false
   ```
5. Reload the app. Prospect profiles show **Identity**, **Digital audit** and **Manual override**; the Verification queue gains **Needs review**.

### Enable web search (optional, paid)

Without a key the agent still checks recorded websites and name-derived domains, and the result is usually *insufficient evidence* for prospects with no recorded site.

1. Read the Brave terms notes in DATA_PROVIDER_POLICY_MATRIX (transient use; the team-member agreement in 4(c); which plan you hold).
2. Set `BRAVE_SEARCH_API_KEY` (and `BRAVE_COST_PER_SEARCH_USD` if your plan's price differs) on the host and redeploy. Never paste the key into the browser or a chat.
3. Automation Center → Controls → set a **Brave Search** daily and monthly budget. Automated verification does not search until a budget exists. Each prospect uses at most 4 queries.
4. Try one prospect first: profile → Website verification → **Run automated verification**, then read the evidence and factors before running a batch.

### Operating

| Situation | Action |
| --- | --- |
| Prospects stuck in *Needs human review* | Verification queue → Needs review → open each → **Confirm** or **Reject** (a rejection needs a reason). Identity pauses are resolved on the Overview tab's Identity card. Then run research again. |
| An agent result is wrong | Verification: **Reject** it with the reason; rejected results never count. Audit finding: **Dismiss** it with the reason; it is not raised again on the same evidence. |
| Two records are the same business | Owner/admin: Identity card → **Merge…**. Contact restrictions carry over and are not lifted by undo. **Undo merge** restores the duplicate. |
| A site is down | The first failure always waits for review (it may be temporary). Re-run after a day; a failure seen again after 20 hours counts as persistent. |

## 9. Contact intelligence (migration 005)

### Apply migration 005

The app runs without it (the Contacts tab then shows only the business-level permission panel, and the research pipeline goes from scoring to the report). It applies with or without 003 and 004; the contact agents need 003.

1. **Backup** (as in §7).
2. **Inspect current data** and keep the output:
   ```sql
   select contact_permission, count(*) from public.businesses group by 1 order by 2 desc;
   select count(*) filter (where phone <> '') as phones, count(*) filter (where email <> '') as emails from public.businesses;
   select to_regclass('public.contact_points');      -- null means 005 has not been applied
   ```
3. **Apply** `supabase/migrations/005_contact_intelligence.sql` as one script. It is additive and re-runnable. No existing row is changed; every business already opted out gets a business-wide suppression entry. Profile phone and email values are **not** copied into contact points — a person chooses *Track with provenance* on each prospect, and undocumented values stay "Needs review".
4. **Verify:**
   ```sql
   select count(*) from public.suppressions;   -- equals the number of opted-out businesses
   select count(*) from public.contact_points; -- 0
   select has_table_privilege('authenticated', 'public.suppressions', 'delete');      -- false
   select has_table_privilege('authenticated', 'public.consent_records', 'update');   -- false
   ```
5. Reload the app. Prospect profiles show a **Contacts** tab, and the sidebar has **Contacts** (details, filters, suppression list). Set the retention period in Settings → Agency → Contact data.

### Operating

| Situation | Action |
| --- | --- |
| Someone asks not to be contacted | Their contact's actions → **Record opt-out…** (one channel) or the business-level permission → *Opted out* (everything). A suppression is added automatically. If you only have their number or address, Contacts → Suppression list → **Add to suppression list**. |
| Someone gives written consent | Contact actions → **Record consent…**: how it was given, the evidence reference, the wording they agreed to. A phone call alone is not written consent for direct marketing (Act 843 s.40). |
| A suppression was added by mistake | Owner/admin only: record the person's new written consent first, then Suppression list → **Lift…** with a reason. Without newer consent the lift is refused. |
| Contact details past their retention date | Contacts → filter *Past retention date* → **Delete … past retention** (owner/admin), or **Keep longer…** on one row with a reason. |
| A contact detail looks wrong | Its actions → **Review details**: correct the scope, mark it outdated, add a note. Provenance cannot be edited; delete and re-add with the right source instead. |
| Mail-server lookups | DNS only, free; limited by `DAILY_MX_LOOKUP_QUOTA` (default 300 per workspace per day). Mailboxes are never probed. |

## 10. Opportunity reports (phase 5)

No migration: reports keep using `opportunity_reports`; new versions store the twelve-section format and earlier versions are converted when displayed.

| Situation | Action |
| --- | --- |
| A prospect sits in *Research incomplete* with the task "Complete research before an opportunity report" | Open its Reports tab: the notice lists what is missing (website verification, evidence, research confidence). Complete it, then run research again; or press **Rule-based report** to write one anyway (the gaps appear as limitations). Close the task when done. |
| Too many or too few automatic reports | Settings → Agency → **Automatic reports** → minimum research confidence (default 50). The Opportunity Report agent can also be switched off in Automation Center → Agents. |
| Enable AI-assisted automatic reports | Set an **Anthropic** budget in Automation Center → Controls. The server checks the configured model first (Models API, free) and refuses before any paid call if it is unavailable. Change the model with `ANTHROPIC_MODEL` and redeploy. |
| "The daily AI report quota is used up" in a run | Automatic runs wrote the rule-based report instead. Raise `DAILY_AI_REPORT_QUOTA` if needed. |
| A report shows "unsupported statements were removed" | Open **Show what was removed** to see the text. Record a source for anything true (on the profile or verification), then regenerate; never paste invented figures back in. |

## 11. Proposals (phase 6)

No migration: proposal content and organization settings are JSON. Settings saved earlier load with the add-on price list and empty branding.

| Situation | Action |
| --- | --- |
| Before relying on automatic drafts | Settings → Packages: enter your rates for each package line and in the **Add-on price list**. Until then drafts say "To be quoted" and cannot be approved. Settings → Agency: agency name (required for approval), logo and accent colour. |
| Turn automatic drafting on | Automation Center → Controls → **Research + proposals** mode. The Opportunity Report agent then queues the Proposal Generation agent whenever a report supports a proposal. Switch the agent off in Automation Center → Agents to stop it. |
| A prospect has a report but no automatic draft | Open the run in Automation Center → Run log: the summary lists why (report older than the latest website check, low confidence, next step not a proposal, an open proposal already exists, opt-out or suppression). Create one by hand from the prospect's Proposals tab if appropriate. |
| The draft's package looks wrong | The editor's **How this draft was prepared** lists the reasons. Usually the recorded *service needs* are missing or vague: update them on the prospect and create a new draft (withdraw the old one), or pick another package in the Proposals tab; the recommendation stays on record. |
| "This proposal has expired" | Revise as draft, set a new **Valid until** date, save and approve again before marking it sent. |
| Client replies to a sent proposal | Open the proposal → **Client response** → record what they said. Price or scope changes go through *Revise as draft* and a new approval. |
| PDF | **Print / PDF** opens the branded print view; use the browser's *Save as PDF* (the file is named after the proposal). Drafts print with a DRAFT banner. |

## 12. Messaging (migration 006, phase 7) — sandbox only

Messages to businesses are **not possible in this version**: the gateway blocks them, `public.outbound_available()` returns false, the outreach modes cannot be selected and the emergency stop cannot be lifted. The only recipients are the agency's own test addresses in `MESSAGING_TEST_RECIPIENTS` (cloud) or Outreach → Setup (demo). Demo mode simulates every send in the browser.

### Apply migration 006

Needs 005. It applies with or without 003 and 004. **Do not apply to production without a backup and the owner's explicit approval.**

1. **Backup** (as in §7).
2. **Inspect:**
   ```sql
   select to_regclass('public.contact_points');    -- must not be null (005 applied)
   select to_regclass('public.outreach_messages'); -- null means 006 has not been applied
   select source, count(*) from public.suppressions group by 1;
   ```
3. **Apply** `supabase/migrations/006_messaging.sql` as one script. It is additive and re-runnable. It changes no existing row; the only change to an existing object is the wider `suppressions.source` check (adds `inbound_opt_out`, `provider_event`).
4. **Verify:**
   ```sql
   select public.outbound_available();                                                     -- false
   select has_table_privilege('authenticated', 'public.eligibility_decisions', 'update');   -- false
   select has_table_privilege('authenticated', 'public.channel_events', 'insert');          -- false
   select count(*) from public.outreach_messages;                                           -- 0
   ```
5. Reload the app. The sidebar has **Outreach** (Messages, Inbox, Templates, Setup), and email/WhatsApp contact points have **Draft a message…** in their actions menu.

### Set up sandbox sending (optional)

Only with the agency's own mailbox and phone. Nothing here enables messages to businesses.

1. **Email (Resend):** verify a dedicated subdomain (e.g. `outreach.yourdomain.com`) with SPF, DKIM and DMARC (`p=quarantine`). Set `RESEND_API_KEY`, `MESSAGING_EMAIL_FROM`, optionally `MESSAGING_EMAIL_REPLY_TO`. Add a webhook to `APP_URL/api/webhooks/email` for the events sent, delivered, delivery delayed, bounced, complained, failed, suppressed and (for inbound) received; put its signing secret in `RESEND_WEBHOOK_SECRET`. Open and click tracking stay off.
2. **WhatsApp (Cloud API):** in Meta's app dashboard, set the callback URL `APP_URL/api/webhooks/whatsapp`, your own `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field. Set `WHATSAPP_ACCESS_TOKEN` (a system-user token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`. Write templates in WhatsApp Manager (named parameters such as `{{business_name}}`, and an opt-out line such as "Reply STOP to opt out"), then **Outreach → Templates → Sync WhatsApp templates**.
3. **Common:** `MESSAGING_UNSUBSCRIBE_SECRET` (32+ random characters), `APP_URL` (https), `MESSAGING_ORGANIZATION_ID` (the workspace that files replies), `MESSAGING_TEST_RECIPIENTS` (agency addresses/numbers only), and `SUPABASE_SERVICE_ROLE_KEY`. Redeploy.
4. **Check:** Outreach → Setup lists any missing setting per channel (names only, never values). Then: create a test prospect, record one of the test addresses as a contact point *Given to us directly*, record written consent, validate, draft from an approved template, approve, queue and **Dispatch now**. Confirm the delivered webhook moves it to *Delivered*, and that replying STOP from the test mailbox suppresses the address.

### Operating

| Situation | Action |
| --- | --- |
| "Delivery unknown" | The provider call timed out or failed without an answer. It is **never retried automatically**. Check the Resend dashboard or WhatsApp Manager for the message (Resend: tag `message_id`; WhatsApp: the callback data is the message ID). Webhooks that arrive later still move it to sent or delivered. |
| A message is blocked at approval or dispatch | Open it: the gateway checklist names every failed check (consent, suppression, contact validation, template, sender settings, duplicate, approval). Fix the cause and draft again; nothing can override the gateway. |
| An opt-out reply arrives | The sender is suppressed on every channel automatically and a task asks a person to confirm it and record the withdrawal on the prospect. Nothing is answered automatically. |
| A bounce or complaint | The recipient is suppressed automatically (a complaint on every channel). Do not lift it without new written consent. |
| Webhook returns 401 | The signing secret or app secret does not match the provider's; rotate both together. 503 means the secret is not configured. Providers retry for some time, and events are deduplicated, so a fixed secret catches up. |
| Templates show "Not found in your WhatsApp Business Account" | Create it in WhatsApp Manager with exactly that name and language, then synchronise. A template a person disabled stays disabled after a sync. |
| Unsubscribe link | Each email carries a signed per-message link and RFC 8058 one-click headers. The link page shows the same answer whether or not the message exists. |

## 13. Sending policies (migration 007, phase 8) — sandbox only

Phase 8 adds the rules every send must pass on top of the phase 7 gateway: **approved-message policies** (an owner's or admin's standing approval of one approved template version, with a daily cap and an expiry), a **workspace sending policy** (time zone, quiet hours, sending days, daily limits per channel, per-recipient spacing and caps, approval age), a **pause switch** that holds every dispatch, and the **Audit** tab. The database enforces the same rules again when a message moves to sending. Messages to businesses stay impossible, as in §12.

### Apply migration 007

Needs 003 and 006. **Do not apply to production without a backup and the owner's explicit approval.**

1. **Backup** (as in §7).
2. **Inspect:**
   ```sql
   select to_regclass('public.automation_settings'); -- must not be null (003)
   select to_regclass('public.outreach_messages');   -- must not be null (006)
   select to_regclass('public.message_policies');    -- null means 007 has not been applied
   select status, count(*) from public.outreach_messages group by 1;  -- approved/queued messages need a policy after 007
   ```
   Approved or queued template messages from before 007 have no covering policy. After applying, create the policies first (step 5), or they are refused at dispatch.
3. **Apply** `supabase/migrations/007_sending_policy.sql` as one script. It is additive and re-runnable. Changes to existing objects: five new columns on `automation_settings` (defaults filled in), and the eligibility-decision outcome check now also allows `deferred` (dispatch stage only).
4. **Verify:**
   ```sql
   select sending_policy->>'timezone', sending_paused from public.automation_settings;          -- Africa/Accra, false
   select has_table_privilege('authenticated', 'public.message_policies', 'delete');            -- false
   select tgname from pg_trigger where tgname = 'outreach_messages_send_policy';                 -- one row
   select public.messaging_now() is not null;                                                   -- true
   ```
5. Reload the app. **Outreach → Policies** shows the pause switch, the next sending window, message policies and the sending policy form. Create a policy for each approved template you use (*New policy → Approve policy*). **Outreach → Audit** shows decisions and changes.

### Operating

| Situation | Action |
| --- | --- |
| Approval fails with "No active message policy covers…" | An owner or admin creates a policy for that template version (Outreach → Policies). Editing a template creates a new version, which needs a new policy. |
| A queued message shows "Waiting" | A timing rule applies: quiet hours, a non-sending day, the daily limit, the policy's daily cap, recipient spacing, or a requested time. The message stays queued with a new due time; press **Dispatch due messages** (cloud) or **Simulate due messages** (demo) once it is due. Nothing is sent early, and nothing dispatches by itself in this version. |
| Something looks wrong with sending | **Pause all sending** (Outreach → Policies), with a reason. Every dispatch waits, sandbox included. Resuming needs a new reason; both are in the Audit tab. The outbound emergency stop (Automation Center) is separate and stays engaged. |
| A policy should stop | Pause it (reversible) or revoke it (final). Policies are never deleted. A policy expires after its term (at most 180 days). |
| "Approved more than 14 days ago" | Cancel the message and approve a fresh draft; the approval age limit is in the sending policy. |
| The database refuses a send the app allowed | The trigger re-checks under a lock (two dispatchers at once, clocks that disagree). Read the error, which names the rule; do not work around it. |

### Outreach Drafting agent

Available from **Research + proposals** mode. On a prospect's Contacts tab, **Draft with the agent** writes at most one draft: it chooses a contact with consent on file and an approved, policy-covered template using the gateway's own checks, and stops with the reasons when none qualifies. It cannot approve, queue, send, or set policies. The optional AI personal note (`{{personal_note}}`) needs `ANTHROPIC_API_KEY`, an Anthropic budget (Automation Center → Controls) and the `DAILY_AI_NOTE_QUOTA` quota; it cites recorded evidence, is checked against the note rules, and is discarded (the tokens are still recorded) when it fails them.

## 14. Replies and conversion (migration 008, phase 9)

Phase 9 reads what each received message means and turns it into work for people: **reply classifications** (deterministic rules on every reply as it arrives; optional AI reading on request; a person's correction), **interested-lead alerts** (Overview and the inbox's *Needs attention* filter), **CRM updates** (interest level, last interaction, an alert task), the prospect's **Next steps** tab (follow-up plan, meeting brief, open change requests) and **proposal change requests** that only owners and admins decide. Nothing replies, schedules a message, lifts a suppression or agrees commercial terms by itself.

### Apply migration 008

Needs 002 and 006. **Do not apply to production without a backup and the owner's explicit approval.**

1. **Backup** (as in §7).
2. **Inspect:**
   ```sql
   select to_regclass('public.inbound_messages');          -- must not be null (006)
   select to_regclass('public.reply_classifications');     -- null means 008 has not been applied
   select status, count(*) from public.proposals group by 1;
   select count(*) from public.proposals where approved_at is not null and status not in ('approved', 'sent', 'accepted', 'declined', 'withdrawn');  -- expect 0
   ```
   008 adds a trigger to `proposals`: from then on the database stamps `approved_at` itself when a proposal is approved and refuses any other change to it (clearing it on revision is still allowed). Existing values are not touched.
3. **Apply** `supabase/migrations/008_response_conversion.sql` as one script. It is additive and re-runnable. Existing replies are not classified retroactively: run the Response Classification agent on a prospect (rules only, free) to read them.
4. **Verify:**
   ```sql
   select has_table_privilege('authenticated', 'public.reply_classifications', 'update');   -- false (append-only)
   select has_table_privilege('service_role', 'public.proposal_change_requests', 'insert'); -- false (people only)
   select tgname from pg_trigger where tgname in ('reply_classifications_guard', 'proposal_change_requests_guard', 'proposals_acceptance_guard');  -- three rows
   ```
5. Reload the app. Received messages show what they mean in **Outreach → Inbox**; the prospect has a **Next steps** tab; issued proposals show **Discussion and change requests**.

### Operating

| Situation | Action |
| --- | --- |
| A reply is read wrongly | Inbox or Next steps → **What does it mean?** → choose the intent → *Save reading*. The correction is kept with the earlier readings (append-only) and updates the task and interest level. |
| Someone wants to correct an opt-out | Not possible: a reply that matched the opt-out rules stays an opt-out, in the app and in the database. If the business later asks to hear from you again, record new consent; an owner or admin lifts the suppression against it (§9). |
| The AI read a reply as an opt-out | The sender was suppressed at once (source "added by an agent"). Changing the reading does not lift it; an owner or admin lifts it against new consent if it was a mistake. |
| *Read with AI* is missing | It needs `ANTHROPIC_API_KEY`, automation set up (migration 003), an Anthropic budget (Automation Center → Controls), the `DAILY_AI_CLASSIFY_QUOTA` quota, and an open prospect. Webhook replies are never sent to the AI. |
| "Decide the open change request before recording acceptance" | An owner or admin opens the proposal → *Discussion and change requests* → **Agree** or **Decline**, with a note. Sales can record and withdraw requests, not decide them. |
| "An agreed change is not in the proposal yet" | *Revise as draft*, put the change in, *Approve*, *Mark as sent*; then record acceptance. Acceptance is checked against the approval time the database stamped, so the change must be approved after it was agreed. |
| The follow-up plan suggests stopping | The prospect had the sending policy's maximum unanswered follow-ups. Leave it, or mark the prospect lost; the gateway would block another follow-up anyway. |
| Preparing a call or visit | Next steps → **Open the meeting brief** (printable). It lists only statements the report supports with evidence, the website position as recorded, the conversation and the issued proposal; unknowns become questions. It is internal: do not share it. |

### Agents

- **Response Classification** (`response-classification-1.0.0`, from Research + proposals mode): reads up to three replies per run that need it (no reading yet, or a rules reading that is unclear or under 70%), with the rules or, when a person ticks AI, the AI classifier (`reply-ai-1.0.0`, contact details masked before sending). It never reads again a person's correction or an opt-out, and may move the workflow only to *response monitoring* or *interested* (closing is a person's decision). It queues Follow-Up Planning after.
- **Follow-Up Planning** (`follow-up-planning-1.0.0`, from Research + proposals mode): adds the plan's tasks that are not open yet. Tasks only; free.

## 15. Operations (phase 10)

| Need | Where |
| --- | --- |
| Deploy, environment variables, smoke test, roll back | docs/DEPLOYMENT.md |
| Apply migrations 003–008 to a database with data (backup, read-only preflight `supabase/checks/preflight.sql`, staging, approval) | docs/MIGRATION_REVIEW.md |
| What to watch and when to act; log events; `ERROR_REPORT_URL` | docs/MONITORING.md |
| Serious incidents, key rotation, breach notification | docs/INCIDENT_RESPONSE.md |
| Backups, restore, restore drill | docs/BACKUPS.md |
| Test suites, requirement traceability, live checks with a budget | docs/TESTING.md |
| Security controls, findings and open risks | docs/SECURITY_AUDIT.md |
| Accessibility coverage and gaps | docs/ACCESSIBILITY.md |

### Common operations

- **Failed job:** Automation Center → Jobs → *Failed*: read the error, fix the cause (key, quota, budget, missing research), then *Retry*. Outbound work is never retried from the queue.
- **Stuck job** (running past its lease): the next queue run recovers it. Research work is retried; outbound work fails as uncertain. If it keeps happening, check the worker's time limit and host logs (`cron_organization_failed`).
- **Delivery unknown:** check the provider dashboard, then note the outcome on the prospect; never resend from the app (docs/INCIDENT_RESPONSE.md §4).
- **Budget used up:** paid automated work stops until the next day or month. Raise the limit only after checking why (Analytics → *Usage by operation*).
- **Rotating a secret:** docs/INCIDENT_RESPONSE.md §4 lists where each one is rotated.
- **Team changes:** add members by invitation (Settings → Team) before they sign in. To remove one, delete the membership and sign them out in Supabase → Authentication.
- **Retention:** Contacts lists details past their retention date; review monthly and delete what is no longer needed (§5).

