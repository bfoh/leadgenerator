-- Pre-production inspection (phase 10). READ ONLY: run it in the Supabase SQL editor before applying
-- migrations 003–016 to a project that already holds data, and keep the output with the change
-- record. It is one SELECT that calls no writing function, so it changes nothing, and it returns one
-- table: section, check, value, what it means. (No transaction wrapper: the SQL editor shows only
-- the last statement's result.) It needs migration 002; every later migration is optional, including
-- the Studio chain (012–015) and the resource ledger (016). The `installed` rows are object markers,
-- not the CLI's history: apply through the SQL editor and the markers are the only evidence.
-- See docs/MIGRATION_REVIEW.md for how to read the result.

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
    ('008 replies and conversion', 'public.reply_classifications', 'Reply readings, change requests, acceptance guard.'),
    ('009 research campaigns', 'public.research_campaigns', 'Campaign membership, history, run log and campaign job attribution (needs 003).'),
    ('010 region records', 'public.ghana_districts', '261 districts, 16 regions, optional town and district-level records.'),
    ('011 autonomous discovery', 'public.discovery_runs', 'Discovery runs, provider records and events; campaign runs can enqueue jobs (needs 003 and 009).'),
    ('012 Studio brand intelligence', 'public.studio_projects', 'Studio projects, observations and reviews; the concept workspace.'),
    ('013 Studio asset vault', 'public.studio_assets', 'Asset vault, event history, Brand Kits and approvals; also provisions the private studio-assets bucket.'),
    ('014 Studio creative direction', 'public.studio_creative_directions', 'Creative briefs, directions and reviews.'),
    ('015 Studio website prototypes', 'public.studio_website_prototypes', 'Prototype versions bound to a direction and a Brand Kit.'),
    ('016 independent business resources', 'public.business_resource_entries', 'Independent, permissioned facts for one prospect; additive, so it is optional for the vault.')
  ) as m(name, marker, meaning)

  union all select 2, 'database', 'Postgres version', current_setting('server_version'), 'Supabase runs 15 or later.'
  union all select 2, 'database', 'businesses table size', pg_size_pretty(pg_total_relation_size('public.businesses')), 'Migration 003 rewrites every business row once (workflow state backfill); size gives the lock time.'
  union all select 2, 'database', 'pg_cron and pg_net', (select coalesce(string_agg(extname, ', '), 'neither') from pg_extension where extname in ('pg_cron', 'pg_net')), 'Only needed for the optional scheduled worker (runbook §7).'
  union all select 2, 'database', 'Supabase CLI history table', case when to_regclass('supabase_migrations.schema_migrations') is null then 'absent' else 'present' end, 'Migrations run through the SQL editor leave no CLI history. If absent, the installed rows above (object markers) are the only evidence of the production state, so keep this output with the change record.'

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
