# Deployment Guide

How to deploy Digital Opportunity Finder to a Next.js host (Vercel is assumed) with Supabase. Day-to-day operation is in docs/RUNBOOK.md, and first-time Supabase setup is in RUNBOOK §1.

## 1. Environments

| Environment | Database | Keys | Purpose |
| --- | --- | --- | --- |
| Local demo | None (browser storage) | None needed | Development, E2E tests, demos. Labelled "Demo" in the app |
| Preview / staging | A separate Supabase project (or a branch) restored from a production backup | Sandbox keys, small budgets | Migration rehearsal (docs/MIGRATION_REVIEW.md §3), release checks |
| Production | The live project | Production keys, budgets set | The agency's work |

Never point local development or tests at the production project.

## 2. Prerequisites

- Node 20.9 or later (CI uses 22). `npm ci` installs the exact pinned versions.
- A Supabase project with migrations 001–008 (the production project has them since 2026-10-23). A new project applies them in order following docs/MIGRATION_REVIEW.md, then runs `supabase/checks/after-migrations.sql`.
- A host project with the repository connected.
- **Automation defaults to Research only.** Messages to businesses are blocked in this version whatever keys are set. Only the agency's own sandbox recipients can receive anything.

## 3. Environment variables

Set these in the host's settings for each environment. Never prefix a secret with `NEXT_PUBLIC_`. `.env.example` has comments and defaults for every variable.

| Group | Variables | Notes |
| --- | --- | --- |
| Public (browser) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `…_ANON_KEY`) | RLS protects the data. The CSP allows the browser to call only this Supabase origin |
| Discovery and research | `GOOGLE_PLACES_API_KEY`, `BRAVE_SEARCH_API_KEY` (optional) | Server only. Restrict the Places key to Places API (New) |
| AI (optional) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Paid work also needs a budget set in Automation Center → Controls |
| Quotas and prices | `DAILY_*_QUOTA`, `*_COST_*_USD` | Optional overrides |
| Scheduled worker (optional) | `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | The service-role key bypasses RLS. Server only; used only by the worker, webhooks, unsubscribe and dispatch routes |
| Messaging sandbox (optional) | `APP_URL`, `MESSAGING_TEST_RECIPIENTS`, `MESSAGING_ORGANIZATION_ID`, `MESSAGING_UNSUBSCRIBE_SECRET`, `RESEND_API_KEY`, `MESSAGING_EMAIL_FROM`, `MESSAGING_EMAIL_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` | Runbook §12 |
| Monitoring (optional) | `ERROR_REPORT_URL` | HTTPS webhook that receives redacted error events (docs/MONITORING.md) |
| Must stay off in production | `DEMO_SERVER_TOOLS`, `SIMULATE_EXTERNAL_TOOLS` | Both are ignored when Supabase is configured. Leave them unset |

## 4. Deploy

1. **Release checks** on the commit you will deploy: CI green, which covers:
   - `npm run check` (typecheck, lint, unit and database tests, build, client bundle scan);
   - `npm audit`;
   - the E2E suite.
2. **Database:** if the release needs a migration, apply it first (it is additive, and the old build keeps working), following docs/MIGRATION_REVIEW.md §3.
3. **Deploy** through the host, from the main branch or by promoting the checked preview.
4. **Smoke test** (§6).
5. **Scheduled worker** (only once migration 003 is applied, and only if wanted): runbook §7. It uses Supabase pg_cron and pg_net every two minutes, because the Vercel Hobby plan's cron runs only once a day.
6. **Webhooks** (messaging sandbox only): point Resend at `https://<domain>/api/webhooks/email` and Meta at `https://<domain>/api/webhooks/whatsapp` with the matching secrets (runbook §12).
7. **Email domain** (sandbox sending only): verify the sending domain in Resend with SPF, DKIM and a DMARC record before any test send.

## 5. Security settings to confirm after the first deploy

- Supabase → Authentication: sign-ups **off** for a private agency tool; redirect URLs set to the production domain only, plus localhost for development.
- Supabase → API: the service-role key is set only on the host, never in the repository or the browser.
- `curl -sI https://<domain>/login` shows `content-security-policy` with `default-src 'self'`, `strict-transport-security` and `x-frame-options: DENY`.
- `https://<domain>/api/status` shows only booleans and the expected integrations.
- Budgets: set a monthly limit for every paid provider you configured (Automation Center → Controls).

## 6. Smoke test (about ten minutes, no paid calls)

1. Sign in with a magic link; the workspace opens; the Overview loads without errors.
2. Prospects: add a research candidate with a source URL, then delete it.
3. Automation Center → Overview: System health loads, and the mode is *Research only*.
4. Outreach → Setup: says that messages to businesses are off.
5. Analytics loads; Settings → Team lists the members.
6. If the worker is configured: `curl -s -o /dev/null -w '%{http_code}' https://<domain>/api/cron/automation` returns `401`.
7. The host's logs show no `request_error` events since the deploy.

## 7. Roll back

- **Application:** promote the previous deployment in the host. Every build works with the migrations already applied.
- **Database:** rollbacks run newest first (runbook §6, docs/MIGRATION_REVIEW.md). Restoring a backup follows docs/BACKUPS.md §4, which re-applies opt-outs.
