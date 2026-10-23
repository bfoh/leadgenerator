# Monitoring

What to watch, where it shows, and when to act. Incidents: docs/INCIDENT_RESPONSE.md.

## 1. Signals

| Signal | Where | Act when |
| --- | --- | --- |
| **System health** (Automation Center → Overview): overdue opt-out confirmations, deliveries of unknown status, budgets at 80 % and 100 %, jobs stuck past their lease, failed jobs, failed messages, change requests waiting more than two days, jobs awaiting approval, pause switches | In the app, from stored records (`src/lib/domain/monitoring.ts`) | Any *Act now* item: the same day. *Check* items: within a working day |
| Estimated API cost and usage by operation | Analytics | A day well above the usual |
| Provider spend | Anthropic Console, Google Cloud billing, Brave dashboard | It disagrees with Analytics by more than a few cents |
| Server errors | Host logs: one JSON line per event (`request_error`, `api_unexpected_error`, `webhook_failed`, `cron_organization_failed`, `unsubscribe_failed`, `usage_record_failed`) | Any `webhook_failed` or `cron_organization_failed`; repeated `request_error` on one route |
| Error alerts | `ERROR_REPORT_URL` (optional): every error event above is posted, redacted, to an HTTPS webhook (team chat, alerting service) | As it arrives |
| Configuration | `/api/status` (booleans only) and `/api/messaging/status` (signed in) | After every deploy: the expected integrations show as configured |
| Scheduled worker | Host cron logs; the Automation Center run log | No runs for longer than the schedule interval while jobs are queued |
| Database | Supabase → Reports (CPU, connections, disk) and Logs | Disk above 80 %, or connection errors |

**Logs contain no personal data or secrets.** Strings are redacted (email addresses, phone numbers, key-like tokens). Request errors log the route, method, error name and digest, never the message, query string or headers. Do not add logging that bypasses `logEvent` (`src/lib/server/log.ts`).

## 2. Thresholds

The System health thresholds are in `src/lib/domain/monitoring.ts`. Change the code and this table together.

| Alert | Level | Rule |
| --- | --- | --- |
| Opt-out not confirmed on time | Act now | An open *Confirm the opt-out…* task past its due date (due the day the reply arrives) |
| Delivery unknown | Act now | Any message in *delivery unknown* |
| Budget used up | Act now | Spend ≥ 100 % of a daily or monthly limit |
| Budget near limit | Check | Spend ≥ 80 % |
| Jobs stopped mid-run | Check | Running with an expired lease |
| Failed jobs / messages | Check | Any |
| Change requests waiting | Check | Open for more than two days |
| Jobs awaiting approval, pauses | Note | Any |

## 3. Daily, weekly, monthly

The runbook §2 lists the routine checks. In short:
- **daily:** System health and the inbox's *Needs attention*;
- **weekly:** the verification queue and overdue next actions;
- **monthly:** provider bills against Analytics, and retention review.

## 4. Not built

There are no uptime probes or paging. Use the host's uptime checks on `/login` (or `/api/status`), and point `ERROR_REPORT_URL` at a channel someone reads. There is also no metrics store: System health computes from records each time the page is opened.
