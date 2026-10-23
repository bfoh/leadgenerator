-- Pre-production inspection (phase 10). READ ONLY: run it in the Supabase SQL editor before applying
-- migrations 003–008 to a project that already holds data, and keep the output with the change
-- record. It changes nothing (the transaction is read only and rolled back) and returns one table:
-- section, check, value, what it means. It needs migration 002; every later migration is optional.
-- See docs/MIGRATION_REVIEW.md for how to read the result.

begin transaction read only;

select section, "check", value, meaning from (
  -- Which migrations are installed (by an object each one creates).
  select 1 as ord, 'installed' as section, m.name as "check", case when to_regclass(m.marker) is null then 'no' else 'yes' end as value, m.meaning
  from (values
    ('001 private leads (v6)', 'public.leads', 'Legacy table; 002 copies it into businesses on each owner''s first sign-in and leaves it in place.'),
    ('002 workspace model', 'public.businesses', 'Required for everything below.'),
    ('003 automation', 'public.automation_jobs', 'Job queue, workflow states (derived once from the CRM stage).'),
    ('004 research and verification', 'public.identity_links', 'Identity decisions, audit findings, score overrides.'),
    ('005 contact intelligence', 'public.contact_points', 'Contact points, consent records, suppressions (opted-out businesses are suppressed).'),
    ('006 messaging', 'public.outreach_messages', 'Templates, gateway decisions, messages, replies, webhook events.'),
    ('007 sending policy', 'public.message_policies', 'Message policies, quiet hours, limits, pause switch.'),
    ('008 replies and conversion', 'public.reply_classifications', 'Reply readings, change requests, acceptance guard.')
  ) as m(name, marker, meaning)

  union all select 2, 'database', 'Postgres version', current_setting('server_version'), 'Supabase runs 15 or later.'
  union all select 2, 'database', 'businesses table size', pg_size_pretty(pg_total_relation_size('public.businesses')), 'Migration 003 rewrites every business row once (workflow state backfill); size gives the lock time.'
  union all select 2, 'database', 'pg_cron and pg_net', (select coalesce(string_agg(extname, ', '), 'neither') from pg_extension where extname in ('pg_cron', 'pg_net')), 'Only needed for the optional scheduled worker (runbook §7).'

  union all select 3, 'workspaces', 'organizations', count(*)::text, 'Each gets automation settings when 003 is applied.' from public.organizations
  union all select 3, 'workspaces', 'members by role', coalesce((select string_agg(role || ': ' || n, ', ' order by role) from (select role, count(*) n from public.organization_members group by role) r), 'none'), 'Owners and admins approve, decide and lift suppressions.'
  union all select 3, 'workspaces', 'signed-up users without a workspace', count(*)::text, 'They get an empty workspace on next sign-in unless invited first.' from auth.users u where not exists (select 1 from public.organization_members m where m.user_id = u.id)

  union all select 4, 'records', 'businesses', count(*)::text, 'Kept unchanged by every migration (tested on a copy of this shape).' from public.businesses
  union all select 4, 'records', 'businesses opted out', count(*)::text, '003 sets their workflow to opted_out; 005 adds a suppression for each. Nothing can contact them.' from public.businesses where contact_permission = 'opted_out'
  union all select 4, 'records', 'businesses with permission on the profile', count(*)::text, 'No consent record is created from this: a person records consent (with evidence) before any message (Act 843).' from public.businesses where contact_permission = 'granted'
  union all select 4, 'records', 'businesses with a phone or email on the profile', count(*)::text, 'Not messaged by anything; the Contact Research agent tracks them as CRM records with their source.' from public.businesses where phone is not null or email is not null
  union all select 4, 'records', 'businesses in outreach stages', count(*)::text, 'Derived into outreach workflow states; agents cannot move them further.' from public.businesses where stage in ('introduction_requested', 'contact_authorized', 'proposal_sent', 'discovery_meeting', 'negotiation')
  union all select 4, 'records', 'website verifications', count(*)::text, '004 marks them as made by people.' from public.website_verifications
  union all select 4, 'records', 'proposals by status', coalesce((select string_agg(status || ': ' || n, ', ' order by status) from (select status, count(*) n from public.proposals group by status) p), 'none'), 'Issued proposals stay decidable after 008.'
  union all select 4, 'records', 'approved or sent proposals without an approval time', count(*)::text, '008 checks agreed changes against the approval time; with no change requests these are unaffected.' from public.proposals where status in ('approved', 'sent') and approved_at is null
  union all select 4, 'records', 'open tasks', count(*)::text, null from public.tasks where completed_at is null
  union all select 4, 'records', 'audit events', count(*)::text, 'Append-only; migrations add events only for later changes.' from public.audit_events
) checks
order by ord, section, "check";

rollback;
