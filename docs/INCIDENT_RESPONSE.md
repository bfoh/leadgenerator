# Incident Response

For anything that harms the people whose data we hold, sends something it should not, leaks a secret, or spends money unexpectedly. Day-to-day errors (a provider rejecting a key, a quota reached) are in the runbook §3.

## 1. Severity

| Level | Examples | Respond |
| --- | --- | --- |
| **SEV-1** | A message reached a business without consent or after an opt-out; personal data exposed outside the workspace; a server secret (service-role key, provider key) exposed; unexplained paid usage climbing | Immediately, any hour |
| **SEV-2** | Opt-out confirmation tasks overdue; a delivery stuck as *unknown*; a webhook signing failure spike; a budget used up unexpectedly; a migration failed part-way | Same working day |
| **SEV-3** | One agent failing repeatedly; a page broken for one role; slow queue | Next working day |

## 2. First fifteen minutes (SEV-1 and SEV-2)

1. **Stop the harm.**
   - Messaging: Outreach → Policies → **Pause all sending** (holds every dispatch, sandbox included). The emergency stop for messages to businesses is already engaged and cannot be lifted in this version.
   - Automation: Automation Center → Controls → **Pause automation** (no queued job runs).
   - Leaked key: rotate it in the provider console now (§4), then update the host environment and redeploy.
   - Suspected breach through an account: remove the member (Settings → Team) and revoke their sessions (Supabase → Authentication → Users → sign out).
2. **Name an incident lead** (owner or admin) and open a written log: times, what was seen, what was done. Do not copy personal data into chat tools.
3. **Preserve evidence.** Do not delete records. Export the relevant Outreach → Audit entries, job and run logs, and host logs for the window.
4. **Decide notification** (§3) within the first day.

## 3. Personal data breaches (Ghana Data Protection Act, 2012 — Act 843)

A breach is unauthorised access to, or disclosure, loss or alteration of, personal data: contact details, consent records, replies. Act 843 requires the data controller to notify the **Data Protection Commission** and the affected people as soon as reasonably practicable after discovering it. The notice should say what happened, what data, and what is being done. *Verify the current procedure and any deadline with the Commission or counsel; this is not legal advice.*

- Record: what data, how many people, from when to when, how it was found, the cause, and the fix.
- Messages sent without consent or after an opt-out are also a direct-marketing breach (L.I. 1991, Act 772): stop sending (above), apologise to the recipient, record their opt-out (Contacts → *Record opt-out…*) so they are suppressed everywhere, and report it with the incident.

## 4. Playbooks

**Key or secret leaked** (in a commit, a log, a screenshot, the browser):
| Secret | Rotate in | Then |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API (roll the service-role / secret key) | Update the host, redeploy; review Database → Logs for queries made with it |
| `ANTHROPIC_API_KEY` | Anthropic Console → API keys | Check Console usage for the window |
| `GOOGLE_PLACES_API_KEY` | Google Cloud → Credentials (regenerate; keep API and IP restrictions) | Check billing for the window |
| `BRAVE_SEARCH_API_KEY` | Brave Search API dashboard | Check usage |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Resend → API keys / Webhooks | Check sent emails for the window |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta Business → System users / App settings | Check message history in WhatsApp Manager |
| `CRON_SECRET`, `MESSAGING_UNSUBSCRIBE_SECRET` | Generate a new random value (`openssl rand -hex 32`) | Update the scheduler with the new cron secret. Old unsubscribe links stop verifying: people can still reply STOP, which is processed |

**A message went to someone it should not have.** Pause sending. Find the message (Outreach → Audit): the gateway decision shows every check and who approved it. Record the opt-out or correct the consent record. Work out how it passed (wrong consent evidence, wrong contact point, sandbox list containing a real business). Treat it as SEV-1 and follow §3.

**Opt-out not honoured** (a reply asked to stop but the person was contacted again). Check that the reply is recorded as an opt-out and that a suppression exists (Contacts → Suppressions). If the words were not recognised (for example, a local-language reply), record the opt-out by hand and add the phrase to the opt-out rules with the team. SEV-1 if a message followed it.

**Delivery unknown.** Never resend from the app. Check in the provider dashboard (Resend or WhatsApp Manager) whether it arrived, and record what you found as a note in the prospect's activity. A later provider webhook updates the status if it arrives; the queue never retries these.

**Unexpected cost.** Look at Analytics → Estimated API cost and Automation Center → System health. Pause automation, lower or remove the provider's budget (Controls), and compare with the provider's own usage page. Budgets are hard stops for automated work, and every AI call reserves its worst case before it starts.

**Failed migration.** Each file runs as one transaction, so nothing is half-applied. Leave the app on the current build (it works without the migration), read the error, and follow docs/MIGRATION_REVIEW.md §3 step 7. Restore from backup only with the owner's approval.

**Webhook signature failures.** A spike in 401s on `/api/webhooks/*` means a wrong secret after rotation, or someone probing. Check that the secret in the host matches the provider. Unsigned requests are refused and nothing is processed.

**Worker stuck or failing.** System health shows stuck and failed jobs. Research jobs whose lease expired are retried on the next run; outbound jobs are failed as uncertain and never retried. Check the cron schedule and `CRON_SECRET`, and the host logs (`cron_organization_failed` events).

## 5. After the incident

Within five working days, write a short review: timeline, impact (people, records, money), cause, what stopped it, and changes, each with an owner and date. Add a test that would have caught it. Keep reviews with the change records. No blame: the goal is a better system.
