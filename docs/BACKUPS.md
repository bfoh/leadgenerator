# Backups and Restore

The database holds personal data (contact details, consent records, replies). Backups are personal data too: keep them encrypted, access-limited and no longer than needed.

## 1. What is backed up

| Data | Backed up by | Notes |
| --- | --- | --- |
| Everything in Postgres (workspaces, prospects, research, consent, suppressions, messages, proposals, audit) | Supabase daily backups (Pro plan and above; seven days on Pro) and optional point-in-time recovery (PITR add-on) | Check the plan: the free plan has no downloadable backups |
| Auth users | Same (the `auth` schema) | |
| Application code | Git and the host's deployments | Redeploy the previous build to roll back |
| Configuration | Host environment variables | Keep a record of names and where each secret lives, never the values, in the team's password manager |
| Demo mode | The browser only | Settings → Data → **Export JSON** |

## 2. Before every migration or risky change

1. Take a manual backup: Supabase → Database → Backups (or note the PITR timestamp).
2. Also take a logical dump that you control, encrypted at rest:
   ```bash
   pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=custom --file="dof-$(date -u +%Y%m%dT%H%MZ).dump"
   ```
   `DATABASE_URL` is the direct connection string (Supabase → Connect). Never commit it, and never paste it into chat.
3. Write down the time. A restore loses every change after it (see §4).

## 3. Schedule and retention

| What | When | Keep |
| --- | --- | --- |
| Supabase automatic backups | Daily (plan) | Per plan (seven days on Pro) |
| Manual `pg_dump` | Before each migration; monthly otherwise | 90 days, then delete. Act 843 limits keeping personal data longer than needed |
| Restore drill | Quarterly | A one-line record of date, backup used and result |

## 4. Restoring

**Opt-outs must survive a restore.** A backup from before someone opted out does not know that they did. Restoring it as it is would make them contactable again. Before restoring:

1. Pause sending (Outreach → Policies → *Pause all sending*) and pause automation.
2. While the current database is still readable, export what changed since the backup time `T`:
   ```sql
   -- Read only. Keep the output with the incident record.
   select organization_id, kind, value_hash, business_id, channel, hint, reason, source, created_at
     from public.suppressions where created_at >= 'T';
   select organization_id, business_id, contact_point_id, contact_hint, channel, status, created_at
     from public.consent_records where created_at >= 'T' and status = 'withdrawn';
   select organization_id, id, name, opted_out_at
     from public.businesses where opted_out_at >= 'T';
   ```
   If the database is not readable, collect the opt-outs from provider records instead: Resend suppressions and unsubscribes, and WhatsApp opt-outs since `T`.
3. Restore: Supabase → Database → Backups → *Restore* (or PITR to a timestamp). To restore a dump into a fresh project:
   ```bash
   pg_restore --no-owner --no-privileges --dbname="$NEW_DATABASE_URL" dof-<time>.dump
   ```
4. **Re-apply every opt-out from step 2** before resuming. Record each as an opt-out in the app (Contacts → *Record opt-out…*, or the business-level permission), so the suppression list and the audit trail show it.
5. Check: row counts look right (run `supabase/checks/preflight.sql`), sign in, open a prospect, and confirm the re-applied opt-outs are suppressed. Then resume.

**One workspace only.** There is no per-workspace restore. Restore into a separate project and copy the needed rows with a script that an engineer reviews. Never overwrite another workspace's data.

## 5. Restore drill (quarterly)

Restore the latest backup into a scratch Supabase project, point a preview deployment at it, and run the smoke test in docs/DEPLOYMENT.md §6. Then delete the scratch project and its backups. Record the date and the time it took.
