# Outreach Compliance

Rules every outbound message must satisfy, and how the platform enforces them. **Outbound sending is disabled in this build**; this document is the specification the Phase 7–8 code must meet before it can be switched on. Engineering reading only — have Ghanaian counsel confirm before the first live campaign.

## 1. Legal basis in Ghana

- **Data Protection Act, 2012 (Act 843), section 40** — reported by multiple legal guides as requiring the **prior written consent** of the data subject before their personal data is used, obtained or provided for direct marketing, with a right to require a controller to stop. Business contact details that identify a person (a sole trader's mobile, a named manager's email) are personal data. *Verify against the official text from the Data Protection Commission.*
- **Electronic Communications Regulations, 2011 (L.I. 1991)** and **Electronic Transactions Act, 2008 (Act 772) s.50** — reported as requiring subscriber consent before unsolicited direct-marketing email, text or calls, sender identification, a free opt-out route and disclosure of where the sender obtained the details on request. Secondary sources report significant fines and possible imprisonment for continuing after a stop request; the figures differ between sources. *Verify.*
- **Registration** — controllers processing personal data must register with the Data Protection Commission. The agency should confirm its registration covers prospect research and marketing.
- Sources reviewed 2026-10-22: [Chambers Advertising & Marketing 2025 — Ghana](https://gpg-pdf.chambers.com/Advertising-and-Marketing-2025/161/), [LexAfrica, August 2026](https://lexafrica.com/2026/08/ghana-direct-marketing-privacy-the-obligations-on-businesses-and-the-rights-of-consumers/), [Mondaq — Direct Marketing and Privacy](https://www.mondaq.com/privacy-protection/1818138/direct-marketing-and-privacy), [Data Protection Africa factsheet](https://dataprotection.africa/wp-content/uploads/2019/10/Ghana-Factsheet.pdf). One source cites a 2025 draft bill that would replace Act 843; it is not law at the time of writing.

**What this means for the product:** public availability is not permission. The first marketing message to a prospect requires a consent record for that channel, or the prospect must have contacted the agency first. Cold outreach to discovered contacts is not a supported workflow. The recommended route to a first conversation is permission-seeking that does not itself rely on the discovered channel — an introduction through a referral, in-person visit, a reply to an enquiry the business posted, or the business filling in the agency's own contact form.

## 2. Provider policies (summary; details in DATA_PROVIDER_POLICY_MATRIX)

- Email providers prohibit unsolicited mail: Resend explicitly forbids cold outreach and scraped or purchased lists, requires explicit opt-in, unsubscribe honoured within 7 days, complaints < 0.08 %, bounces < 4 %.
- WhatsApp: number given by the person **and** opt-in permission; approved templates for business-initiated messages; free-form only within 24 h of their last message; respect opt-outs on or off WhatsApp. Only the official Cloud API.
- Gmail/Yahoo: SPF, DKIM, DMARC with alignment; one-click unsubscribe for marketing; complaint rate < 0.3 %.

## 3. Non-negotiable controls

| Control | Implementation |
| --- | --- |
| No send without a passing eligibility decision | `checkEligibility` (CONTACT_PERMISSION_MODEL §5) in the engine **and** in the provider adapter |
| Suppression precedence | Checked at decision time and immediately before the API call |
| Emergency stop | Organization flag; claim function skips outbound jobs; adapters refuse; owner-only to lift with a reason |
| No duplicates | Idempotency key per message stored before the API call; provider idempotency headers where supported; unique index on `(organization_id, dedupe_key)` |
| Uncertain delivery is never retried | Lease expiry or timeout after the request left our server marks the message *delivery unknown* for a person to check |
| Rate limits | Per-organization daily send caps (start: 20 email, 20 WhatsApp), per-recipient cooling-off (7 days), provider rate limits |
| Quiet hours | Default 19:00–08:00 Ghana time (GMT) and Sundays; replies to inbound messages are exempt within the service window |
| Sender identity | Every message names the agency, the person, and how to opt out; email includes a postal address and List-Unsubscribe headers |
| Opt-out processing | Deterministic keyword rules (STOP, UNSUBSCRIBE, "don't contact", and Twi/Ga/Ewe equivalents agreed with the team) suppress immediately; the classifier can add, never remove |
| Silence is not interest | No reply → follow-up *task for a person*, never an automatic second message without a new decision |
| No evasion | No rotating inboxes, domains or numbers to avoid limits; no unofficial WhatsApp automation; no `wa.me` links opened in bulk |
| Records | Each send stores the decision, approver, template, content hash, provider message ID and status events |

## 4. Message quality rules

Drafts (human- or AI-written) must:
- be addressed to the business and reference only verified facts or evidence-supported findings, never guesses presented as facts;
- say who we are, why we are contacting them and how we found them (source disclosure);
- make one clear, low-pressure ask (permission for a short conversation), with an easy way to decline;
- avoid claims about revenue, competitors or "lost customers" that the evidence does not support, urgency tricks, and prices not set in the agency's packages;
- be short (email ≤ 150 words; WhatsApp templates as approved by Meta);
- be written in clear English suitable for a Ghanaian business audience.

## 5. Modes

| Mode | What may happen automatically |
| --- | --- |
| Research only (default) | Research agents, scoring, reports. No drafts addressed to recipients. |
| Research + proposals | Plus proposal drafts and follow-up tasks. Nothing leaves the workspace. |
| Approval-based outreach | Plus message drafts and gateway decisions; each message is sent only after a person approves it. |
| Eligible automated outreach | Plus automatic sending of approved message kinds to recipients with a current consent record, within caps and quiet hours. |

In this build only the first two modes can be selected; the outreach modes are shown with the reasons they are unavailable.

## 5a. What phase 7 built (sandbox only)

| Control | Status in this version |
| --- | --- |
| Eligibility decision before every send | Built: `checkEligibility` at approval (browser) and again on the server at dispatch, stored append-only; the database refuses approval or dispatch without a matching decision. |
| Suppression precedence | Built: checked by the gateway at approval and dispatch; replies, bounces and complaints add suppressions automatically. |
| Emergency stop | Engaged and cannot be lifted in this version; messages to businesses fail the gateway. Sandbox test recipients are the only exception. |
| No duplicates | Built: dedupe key per queued message (unique index), compare-and-set on *queued → sending*, Resend `Idempotency-Key`, webhook events recorded once per provider event ID. |
| Uncertain delivery never retried | Built: timeouts, connection failures, 5xx and Resend 409 mark the message *delivery unknown* for a person to check. |
| Sender identity and unsubscribe | Built for email: footer with sender, agency, postal address and a signed per-message unsubscribe link; `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) headers. WhatsApp templates must contain an opt-out line. |
| Opt-out processing | Built: deterministic keyword and phrase rules; local-language equivalents still to be agreed with the team. Phase 9: a reply the rules read as an opt-out can only ever be read as an opt-out (the database refuses any other reading, from a person or the AI); an AI opt-out reading adds a suppression; a later correction never lifts one. |
| Replies and follow-ups | Built (phase 9): every reply is read (rules; optionally the AI with contact details masked) and becomes a task for a person. Nothing is answered automatically; the follow-up plan creates tasks only, and no reply is read as interest from silence. |
| Commercial terms | Built (phase 9): a client's requested changes (price, scope, timeline, payment, contract terms) are recorded and decided only by owners or admins with a note; an agreed change must go into a revised proposal that is approved and issued again before acceptance can be recorded. Custom contracts stay outside the app. |
| Templates | Built: email templates approved by owners/admins; WhatsApp status only from Meta (synchronised); editing content returns a template to draft. |
| Message policies | Built (phase 8): every template message needs an owner's or admin's active policy for that template version, with a daily cap and an expiry; policies cannot be deleted, revoking is final, every change is audited. Agents cannot create or change them. |
| Rate limits, quiet hours, cooling-off | Built (phase 8): daily limit per channel, policy daily cap, quiet hours (must cover 22:00–06:00) and sending days in the workspace time zone, at least 7 days between messages to one recipient, at most 3 in 30 days, at most 2 unanswered follow-ups (defaults). A message caught by a timing rule waits in the queue; the database re-checks every rule at sending. |
| Pause | Built (phase 8): one switch holds every dispatch, sandbox included; resuming needs a recorded reason. Separate from the emergency stop. |
| AI-written content | Built (phase 8), optional: the drafting agent may ask the model for one personal sentence citing recorded evidence; it is checked (no prices, links, contact details, figures, website-absence claims, guarantees or pressure) and the whole message is still approved by a person and checked by the gateway. The AI cannot choose recipients, templates or channels. |
| Audit trail | Built: Outreach → Audit lists every gateway decision, message, template and policy change and every change to the sending controls. |
| Automatic sending | **Not built**; every message needs a person's approval and a person to queue and dispatch it. |

## 6. Before enabling outbound (checklist)

- [ ] Counsel review of this document and the consent wording.
- [ ] Data Protection Commission registration confirmed.
- [ ] Sending domain with SPF, DKIM, DMARC (`p=quarantine` recommended) verified; dedicated subdomain for outreach.
- [ ] WhatsApp Business Account verified; templates approved.
- [ ] Webhook signature secrets configured; delivery and complaint events tested in sandbox.
- [ ] Consent capture form live with stored wording.
- [ ] Owner lifts the emergency stop with a recorded reason.
