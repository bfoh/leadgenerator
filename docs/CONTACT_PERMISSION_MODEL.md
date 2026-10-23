# Contact Permission Model

Discovering a contact detail and being allowed to use it for marketing are different facts, stored separately and shown separately. A publicly listed phone number or email address is **not** permission to send direct marketing (Act 843 s.40 as reported; see OUTREACH_COMPLIANCE §1).

Status: **implemented in phase 4** (migration `005_contact_intelligence.sql`, `src/lib/domain/contacts.ts`, `src/lib/data/contact-services.ts`; demo mode mirrors every database rule in `LocalStore`). The per-business fields (`contact_permission`, `lawful_basis`, `permission_evidence`, `opted_out_at`) stay as the summary: a granted consent record fills them when nothing was recorded yet, and a full opt-out sets them. Gateway checks 1 and 5–7 (§5) belong to phase 7; no message can be sent in this version.

## 1. Contact points (Phase 4, `contact_points`)

| Field | Purpose |
| --- | --- |
| `id`, `organization_id`, `business_id` | Identity and tenancy |
| `type` | `email`, `phone`, `whatsapp`, `contact_form`, `contact_page` (social profiles stay on the business record; postal addresses are not contact points) |
| `value`, `normalized_value` | As found, and canonical (lower-cased email; E.164 phone via libphonenumber) |
| `scope` | `business` (general line, info@) or `person` (stored only where lawful, with a named role and a documented purpose) |
| `source_type`, `source_url`, `source_provider`, `source_licence`, `source_note` | `business_submitted`, `directly_provided`, `business_website` (needs the page URL), `crm_record`, `authorized_directory` / `licensed_dataset` / `enrichment_provider` (need the provider and its licence, through a configured integration only). Restricted sources — Google Places contact fields, search results, social platforms — are not valid source types: the app refuses them and the database check excludes them. Every row must carry a URL, provider or note |
| `value_hash`, `domain_hash`, `hint` | SHA-256 of the suppression key (`email:…`, `phone:+233…`, `domain:…`) and a masked hint, so suppression and logs never need the value |
| `acquired_at`, `acquired_by`, `agent_version`, `job_id` | Stamped by the database (`auth.uid()`); an automated worker must name its agent version. Provenance can never be edited |
| `classification` | See §2 |
| `validation` | Syntax, MX and E.164 results with time; never SMTP probing or test messages |
| `purpose` | Why we hold it (research, responding to an enquiry, client relationship) |
| `retention_until` | Deadline after which it is deleted or re-reviewed |
| `last_seen_at`, `last_reviewed_at`, `review_note` | Last time the source still published it; a person's review |

WhatsApp is its own contact type and is recorded only when the business itself states it (a WhatsApp button on its own site, a business-declared profile, or the business messaging us). A mobile number is never assumed to be on WhatsApp, and numbers are never checked against WhatsApp by enumeration.

Email addresses are recorded only as found. No address is ever guessed or predicted (the app does not produce suggestions either). Addresses that are not role addresses (info@, sales@…) get scope "not confirmed" and need a person's review, because they may identify an individual.

Retention: each row gets `retention_until` from the workspace setting (Settings → Contact data, default 365 days, 30–1,095). A person can extend one row with a reason (at most three years ahead); owners and admins can delete rows past their date from the Contacts page. Consent history and suppression entries survive deletion (the consent row keeps only the masked hint).

## 2. Classifications

| Classification | Meaning | Usable for marketing? |
| --- | --- | --- |
| `VERIFIED_BUSINESS_CHANNEL` | Published by the business itself on a source it controls, and validated | Only with a consent record for that channel |
| `SOURCE_CONFIRMED` | Found on a permitted source, matches the business identity | Only with consent |
| `UNVERIFIED` (shown as "Needs review") | Found but not yet validated or matched, an address on another company's domain, a duplicate of another prospect's detail, scope unknown, or an undocumented CRM detail | No |
| `INVALID` | Fails syntax/MX/E.164 | No |
| `OUTDATED` | Superseded or failed re-validation | No |
| `PERMISSION_REQUIRED` | Valid; no consent on file (the default for every usable contact point) | No |
| `OPTED_OUT` | The recipient asked not to be contacted on this channel | Never |
| `SUPPRESSED` | On the organization suppression list (by value, domain or business) | Never |

Stored classifications are the first five; `PERMISSION_REQUIRED`, `OPTED_OUT` and `SUPPRESSED` are derived for display (`contactStatus`) from consent records, the business opt-out and the suppression list, so they can never be stale.

Validation (`validateContactPoint`, Contact Validation agent): email syntax and domain normalisation (IDN to punycode), MX lookup by DNS only (`found`, `no_mx_but_resolves` → risky, null MX / no domain → invalid, lookup error → temporary, nothing concluded), duplicates across prospects; phone parsing with libphonenumber (Ghana default) to E.164 with landline / mobile / toll-free; mailbox deliverability is "skipped — no authorised provider". A validation counts as current for 90 days.

## 3. Consent records (Phase 4, `consent_records`, append-only)

| Field | Purpose |
| --- | --- |
| `contact_point_id` / `business_id`, `channel` | What the consent covers (email and WhatsApp are separate) |
| `status` | `granted`, `withdrawn` |
| `lawful_basis` | `consent` (prior written consent for direct marketing), `business_initiated` (they asked us), `existing_relationship` (current client, related services) |
| `evidence` | Form submission ID, signed note, email thread reference, screenshot reference — what a regulator would ask to see |
| `captured_via`, `captured_at`, `captured_by` | How and when, and who recorded it |
| `wording` | The consent text the recipient agreed to |
| `expires_at` | Optional re-confirmation date |

Rules:
- Consent records are written only by signed-in people with the owner, admin or sales role; the database refuses inserts without a user (service role included). No agent may create, edit or withdraw one (the engine also hands agents a store that refuses it).
- Act 843 s.40: a grant with basis `consent` for direct marketing must be captured in writing (web form, email, WhatsApp message, written document) and record the wording — checked by the form and by a database constraint.
- Records are never edited; a withdrawal is a new row. The latest row per channel wins.
- Approving a campaign is **not** evidence that the recipient opted in.

## 4. Suppression (Phase 4, `suppressions`)

Organization-wide entries by hashed value (email, phone — shared by phone and WhatsApp), email domain, or business; only the hash and a masked hint are kept, so an entry outlives the contact details it blocks. Added automatically by the database when a withdrawal is recorded (matching contact points on that channel) and when a business is opted out (the business and every contact value), and manually from the Contacts page. Businesses already opted out before migration 005 were backfilled. Suppression:
- takes precedence over every agent recommendation and every mode;
- is checked by the gateway and again by the provider adapter immediately before a send;
- is never deleted (no delete privilege for any role); lifting is owner/admin only, needs a reason and a granted, current consent record created after the entry that covers the same contact and channel (checked by the `guard_suppression` trigger), and is audited. Agents cannot lift entries.

## 5. Eligibility decision (gateway)

`checkEligibility(business, contactPoint, channel, messageKind, now)` returns `eligible` or a list of reasons. All must pass:

1. The workspace mode allows the message kind, and the emergency stop is lifted.
2. The business is not opted out, disqualified, archived or suppressed; the contact point is not suppressed or opted out.
3. A current `granted` consent record exists for this channel (or the message is a reply inside an inbound conversation the recipient started, within the channel's service window).
4. The contact point's classification is usable and its validation is current.
5. Channel rules: WhatsApp business-initiated messages use an approved template; email has a working unsubscribe link and the sending domain passes SPF/DKIM/DMARC.
6. Frequency and timing: not within quiet hours (default 19:00–08:00 Ghana time and Sundays), not more than one unanswered message in the cooling-off window, no duplicate of a message already sent.
7. A human approved this message (approval-based mode) or the message kind is eligible for automation (eligible automated mode).

The decision is stored with its inputs so it can be audited later.

Phase 4 implements checks 2–4 as `channelEligibility()` (shown on the Contacts tab with its reasons).

**Phase 7 (built).** `checkEligibility(message, context)` in `src/lib/domain/messaging.ts` (gateway version `gateway-1.0.0`) runs every check above except quiet hours and frequency caps (phase 8), for one drafted message: mode and emergency stop; message state; business (opt-out, closed, merged); suppression (business, address, email domain); consent for the channel and contact point, or a free-text reply inside the window opened by a provider-received message (WhatsApp 24 hours, email 14 days; replies logged by a person never open a window); the contact point (unchanged since drafting, usable classification, validated within 90 days, permitted data rights); template (approved, same version, valid) or a reply inside the window; sender configuration; duplicates (same text already queued or sent to the recipient); and approval by an owner or admin. It is deterministic and pure: the browser runs it at preview and approval, the server runs it again at dispatch, and no agent or person can override it.

Every evaluation is stored in `eligibility_decisions` (append-only: stage, outcome, reasons, the individual checks, the inputs, the content and recipient hashes, actor). The database enforces the link: a message can only be approved against an eligible approval-stage decision for its exact content, made by the approving person within the hour, and only the server can move it to *sending*, against an eligible dispatch decision made within ten minutes.

**Phase 8 (built).** Gateway `gateway-1.1.0` adds check 6 and the policy layer.

- **Message policy.** Every message that is not a reply inside the window needs an active *message policy*: an owner's or admin's standing approval of that exact approved template version. A policy has a daily cap (1–50) and an expiry (at most 180 days). A person still approves each message.
- **Frequency.**
  - A follow-up needs an earlier message to the recipient.
  - At most `maxUnansweredFollowUps` follow-ups are sent without a reply (default 2). This limit blocks the message.
  - Messages to one recipient are at least `recipientMinGapDays` apart (default 7), with at most `recipientMax30Days` in 30 days (default 3). These rules make the message wait.
  - Replies are exempt from all of these.
- **Volume.** The daily limit per channel (default 20 each) and the policy's daily cap are counted in the workspace's local day, over messages that reached sending.
- **Schedule.** The pause switch, a requested time, quiet hours (default 19:00–08:00 Africa/Accra; they must always cover 22:00–06:00) and sending days (default Monday to Saturday).
- **Approval age.** An approval older than `approvalMaxAgeDays` (default 14) blocks dispatch.

Timing and volume rules never block a message. At dispatch they record a `deferred` decision, and the message stays queued with its due time moved to the next allowed instant. A pause holds it until a person resumes sending. At preview and approval the same rules appear as information ("At dispatch: … would wait").

The database applies the same rules again when a message moves to *sending*, under an advisory lock (`enforce_send_policy`, migration 007). So two dispatchers, or a client with a wrong clock, cannot exceed a limit.

*Sandbox exception.* In this version the mode check is waived only for the agency's own test recipients (server environment `MESSAGING_TEST_RECIPIENTS`; demo settings), so sending, delivery tracking and replies can be tested end to end. Every other check still applies to them, including consent and suppression. Messages to businesses fail the mode check: `public.outbound_available()` is false, the outreach modes cannot be selected and the emergency stop cannot be lifted.

*Received messages.* Replies from provider webhooks (or logged by a person) run deterministic opt-out rules (STOP, UNSUBSCRIBE, "do not contact", "remove me"…). An opt-out suppresses the sender on every channel at once (database trigger) and creates a task for a person to confirm and record the withdrawal. Bounces and complaints suppress the recipient (a complaint on every channel); WhatsApp error 131050 (the person stopped marketing messages) suppresses the number for WhatsApp.

*Reply readings (phase 9, migration 008).* Each reply also gets a reading of what it means (rules on arrival; optionally the AI; a person's correction). Opt-out comes first: the database refuses any reading but *opt-out* for a reply the opt-out rules matched, an AI *opt-out* reading suppresses the sender too, and no correction lifts a suppression (only an owner or admin can, as before). A reading never records consent: "interested" or "send me the proposal" is a task for a person, who records consent separately if it was given.

## 6. How the UI keeps the two facts apart

- Contact details appear under **"Discovered contact details"** with their source (and source page link), who or which agent recorded them, validation checks and retention date. The status badge is "Permission required" until a consent record exists, and a separate data-rights badge shows whether the source permits keeping it.
- The Contacts summary shows: Email available/unavailable, Phone available/unavailable, Source verified/needs review, Data rights permitted/restricted/unknown, Email outreach eligible/blocked (with the reasons), WhatsApp opted in/not opted in, last validation, and "Sending to businesses: not available in this version".
- The row actions are review, record consent, record opt-out, keep longer and delete, plus (phase 7, email and WhatsApp points) **Draft a message…**. A draft is never a send: the message dialog shows the gateway's checklist, and approval, queueing and dispatch are separate steps for people with those roles.
- The prospect header continues to show the permission badge, and opted-out prospects carry a red "do not contact" notice.
