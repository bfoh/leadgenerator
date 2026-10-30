-- READ ONLY pre-apply inspection for the whole chain 001–018, including the storage side of 013, the
-- 016 resource ledger, the 017 social research tables and the 018 privilege lockdown. Prepared 26 October
-- 2026 for the Resource Collector staging review and extended on 30 October 2026 for 017–018; NOT yet run
-- against production. (The file name still ends at 016; the chain below runs to 018.)
--
-- One SELECT that calls no writing function: no DDL, no DML, no `set`, no temp table. It is safe to
-- paste into the production SQL editor or to run through psql inside a read-only transaction. It changes
-- nothing, and it returns one table: section, check, value, what it means.
--
-- Requires migration 002, like supabase/checks/preflight.sql: the counts below read 002-era tables.
-- Rows for later migrations use catalogs (to_regclass, pg_policies, pg_trigger) or storage rows, so a
-- project that has only 002 returns 'missing' rather than failing. Sections:
--   1 chain        which of 001–017 are installed (object markers, not CLI history)
--   2 database     role, privilege, version, size, extensions, Storage, current load
--   3 objects      RLS, policy and trigger shape of every table this chain owns
--   4 storage      the private studio-assets bucket and its four object policies
--   5 records      the existing data the migrations will touch or must leave alone
--   6 impact       rewrite and size estimates for the apply window
--   7 gates        the go/no-go rows: baseline present, no gaps, order of what remains
-- See docs/PRODUCTION_MIGRATION_PREFLIGHT.md for how to run it and what to keep with the change record.
-- After applying, run supabase/checks/after-migrations.sql.

with chain(ord, name, marker, meaning) as (
  values
    (1, '001 private leads', 'public.leads', 'Legacy table, never edited; 002 copies it into businesses on each owner''s first sign-in.'),
    (2, '002 workspace model', 'public.businesses', 'Baseline: organizations, membership, RLS, audit log, usage ledger.'),
    (3, '003 automation infrastructure', 'public.automation_jobs', 'Job queue, automation settings, one workflow-state backfill of every business.'),
    (4, '004 research and verification', 'public.identity_links', 'Identity decisions, audit findings, score overrides.'),
    (5, '005 contact intelligence', 'public.contact_points', 'Contact points, consent records, suppressions.'),
    (6, '006 messaging', 'public.outreach_messages', 'Templates, gateway decisions, messages, replies, webhook events.'),
    (7, '007 sending policy', 'public.message_policies', 'Policies, quiet hours, limits and the pause switch (needs 006).'),
    (8, '008 replies and conversion', 'public.reply_classifications', 'Reply readings, change requests, acceptance guard (needs 006).'),
    (9, '009 research campaigns', 'public.research_campaigns', 'Campaigns, membership history, run log (needs 003).'),
    (10, '010 region records', 'public.ghana_districts', '261 districts and 16 regions; optional town and district records.'),
    (11, '011 autonomous discovery', 'public.discovery_runs', 'Runs, provider records and events (needs 003 and 009).'),
    (12, '012 Studio brand intelligence', 'public.studio_projects', 'Studio projects, observations and reviews.'),
    (13, '013 Studio asset vault', 'public.studio_assets', 'Vault, event history, Brand Kits, approvals, private studio-assets bucket.'),
    (14, '014 Studio creative direction', 'public.studio_creative_directions', 'Creative briefs, directions and reviews.'),
    (15, '015 Studio website prototypes', 'public.studio_website_prototypes', 'Prototype versions bound to a direction and a Brand Kit.'),
    (16, '016 business resources', 'public.business_resource_entries', 'Independent, permissioned resource facts for one prospect.'),
    (17, '017 social research intelligence', 'public.business_social_sources', 'Permitted social profile references and research observations (needs 002).'),
    (18, '018 resource ledger privileges', 'public.business_resource_entries@privileges', 'Privileges only: takes delete and truncate back from members on the 016 ledger. Present once members can no longer truncate it.')
),
installed as (
  select ord, name, marker, meaning,
    -- 018 creates nothing, so its marker is a privilege probe rather than an object name. The subquery
    -- returns no row (and this reads false) on a project where 016 has not been applied, instead of
    -- raising an error for a missing relation.
    case
      when marker = 'public.business_resource_entries@privileges' then coalesce((select not has_table_privilege('authenticated', 'public.business_resource_entries', 'truncate') from pg_class where oid = to_regclass('public.business_resource_entries')), false)
      else to_regclass(marker) is not null
    end as present
  from chain
),
objects(name, short, meaning) as (
  values
    ('public.organizations', 'organizations', '002: the workspace every row is scoped to.'),
    ('public.organization_members', 'organization_members', '002: role per user; owners and admins approve and revoke.'),
    ('public.businesses', 'businesses', '002: prospects. 003 rewrites each row once to derive its workflow state.'),
    ('public.audit_events', 'audit_events', '002: append-only activity log; every later migration appends to it.'),
    ('public.usage_records', 'usage_records', '002: insert-only spend ledger behind quotas and budgets.'),
    ('public.suppressions', 'suppressions', '005: an opted-out business is suppressed and cannot be contacted.'),
    ('public.consent_records', 'consent_records', '005: recorded by a person, never invented from a profile field.'),
    ('public.message_policies', 'message_policies', '007: pause switch, quiet hours, limits (needs 006).'),
    ('public.ghana_districts', 'ghana_districts', '010: seeded geography.'),
    ('public.discovery_runs', 'discovery_runs', '011: autonomous discovery (needs 003 and 009).'),
    ('public.studio_projects', 'studio_projects', '012: one website concept per prospect.'),
    ('public.studio_assets', 'studio_assets', '013: vault rows for uploaded files and their five permissions.'),
    ('public.studio_brand_kits', 'studio_brand_kits', '013: versioned Brand Kit behind every concept.'),
    ('public.studio_creative_directions', 'studio_creative_directions', '014: direction bound to a Brand Kit version.'),
    ('public.studio_website_prototypes', 'studio_website_prototypes', '015: prototype versions; publishReady stays false.'),
    ('public.business_resource_entries', 'business_resource_entries', '016: independent resource ledger; Google content is refused at the boundary.'),
    ('public.business_social_sources', 'business_social_sources', '017: social profile references with a retention basis and verification status.'),
    ('public.business_research_observations', 'business_research_observations', '017: observations with a source and a verified state; no platform content.')
)
select section, "check", value, meaning from (
  -- 1. Which migrations are installed, by an object each one creates (018 changes no object, so it probes
  -- the privilege it revokes instead).
  select 1 as ord, 'chain' as section, i.name as "check",
         case when i.present then 'present' else 'missing' end as value, i.meaning
  from installed i

  -- 2. The database and the role running this inspection.
  union all select 2, 'database', 'PostgreSQL version', current_setting('server_version'), 'Supabase runs 15 or later; no file in this chain needs a newer version.'
  union all select 2, 'database', 'connected as', session_user || ' (effective role ' || current_user || ')', 'Migrations must run as the project owner; a read-only pass should show a different role.'
  union all select 2, 'database', 'can create objects in public', case when has_schema_privilege(current_user, 'public', 'CREATE') then 'yes' else 'no' end, 'A read-only role says no. This is the only privilege row that matters for a read-only inspection.'
  union all select 2, 'database', 'database size', pg_size_pretty(pg_database_size(current_database())), 'Context for the backup and the expected apply duration.'
  union all select 2, 'database', 'Supabase CLI history table', case when to_regclass('supabase_migrations.schema_migrations') is null then 'absent' else 'present' end, 'If absent, the chain rows above are the only evidence of what is installed; keep this output.'
  union all select 2, 'database', 'pg_cron and pg_net', coalesce((select string_agg(extname, ', ' order by extname) from pg_extension where extname in ('pg_cron', 'pg_net')), 'neither'), 'Only the optional scheduled worker uses these.'
  union all select 2, 'database', 'Supabase Storage schema', case when to_regclass('storage.buckets') is null then 'absent' else 'present' end, '013 provisions the private bucket only when Storage exists; absent means assets cannot be stored yet.'
  union all select 2, 'database', 'other sessions open', (select count(*)::text from pg_stat_activity where state is not null and pid <> pg_backend_pid()), 'Apply in a quiet window; 003 rewrites every business row once.'
  union all select 2, 'database', 'requests or transactions running over 5 minutes', (select count(*)::text from pg_stat_activity where xact_start is not null and xact_start < now() - interval '5 minutes' and pid <> pg_backend_pid()), 'A long request can hold the locks 003 and 013 need; wait for zero.'

  -- 3. Shape of each table the chain owns: RLS, policies, triggers (catalogs only, so a missing table is safe).
  union all select 3, 'objects', o.short,
    case when to_regclass(o.name) is null then 'missing'
      else 'RLS ' || case when (select relrowsecurity from pg_class where oid = to_regclass(o.name)) then 'on' else 'OFF' end
        || ' · ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = o.short) || ' policies'
        || ' · ' || (select count(*) from pg_trigger where tgrelid = to_regclass(o.name) and not tgisinternal) || ' triggers'
    end, o.meaning
  from objects o

  -- 4. The private bucket 013 provisions, and its policies (skipped on a project without Storage).
  union all select 4, 'storage', 'studio-assets bucket',
    case when to_regclass('storage.buckets') is null then 'Storage absent - 013 skips the bucket'
      else coalesce(nullif(btrim(regexp_replace((query_to_xml('select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = ''studio-assets''', false, true, ''))::text, '\s+', ' ', 'g')), ''), 'missing - uploads would fail after 013')
    end, '013 creates it private, 25 MiB, images plus PDF, plain text, MP4 and fonts; <public>false</public> is the only safe value.'
  union all select 4, 'storage', 'studio-assets object policies',
    case when to_regclass('storage.objects') is null then 'Storage absent'
      else (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'studio_assets_storage_%')
    end, 'Four policies (read, insert, update, delete) keyed on the organization in the first path segment.'

  -- 5. Existing data the migrations will touch, or must leave exactly as it is.
  union all select 5, 'records', 'organizations', count(*)::text, 'Each gets automation settings when 003 is applied.' from public.organizations
  union all select 5, 'records', 'members by role', coalesce((select string_agg(role || ': ' || n, ', ' order by role) from (select role, count(*) n from public.organization_members group by role) r), 'none'), 'Owners and admins approve, decide and lift suppressions.'
  union all select 5, 'records', 'signed-up users without a workspace', count(*)::text, 'They get an empty workspace on next sign-in unless invited first.' from auth.users u where not exists (select 1 from public.organization_members m where m.user_id = u.id)
  union all select 5, 'records', 'businesses', count(*)::text, 'Kept unchanged in count by every migration; 003 rewrites each row once.' from public.businesses
  union all select 5, 'records', 'businesses opted out', count(*)::text, '005 adds a suppression for each; nothing can contact them.' from public.businesses where contact_permission = 'opted_out'
  union all select 5, 'records', 'businesses carrying place IDs', count(*)::text, 'The existing column the Resource Collector saves a verified Place ID into.' from public.businesses where places_place_id is not null
  union all select 5, 'records', 'website verifications', count(*)::text, '004 marks existing verifications as made by people.' from public.website_verifications
  union all select 5, 'records', 'proposals by status', coalesce((select string_agg(status || ': ' || n, ', ' order by status) from (select status, count(*) n from public.proposals group by status) p), 'none'), 'Issued proposals stay decidable after 008.'
  union all select 5, 'records', 'approved or sent proposals without an approval time', count(*)::text, '008 compares change requests against this time; zero is the clean case.' from public.proposals where status in ('approved', 'sent') and approved_at is null
  union all select 5, 'records', 'open tasks', count(*)::text, 'Not touched by this chain.' from public.tasks where completed_at is null
  union all select 5, 'records', 'audit events', count(*)::text, 'Append-only; migrations add events, never edit them.' from public.audit_events
  union all select 5, 'records', 'usage records this month', count(*)::text, 'Budgets for manual paid calls are checked against these rows.' from public.usage_records where created_at >= date_trunc('month', now())

  -- 6. Where the apply time will go.
  union all select 6, 'impact', 'businesses table size', pg_size_pretty(pg_total_relation_size('public.businesses')), '003 rewrites every business row once (workflow-state backfill); size gives the lock time.'
  union all select 6, 'impact', 'five largest public tables', coalesce((select string_agg(tbl || ' ' || size, ', ' order by bytes desc) from (select c.relname as tbl, pg_size_pretty(pg_total_relation_size(c.oid)) size, pg_total_relation_size(c.oid) bytes from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by pg_total_relation_size(c.oid) desc limit 5) t), 'none'), 'The largest tables dominate any index build in a later migration.'
  union all select 6, 'impact', 'files still to apply', (select count(*)::text from installed i where not i.present), 'Each row above that reads missing is one file still to apply, in order.'

  -- 7. Go/no-go.
  union all select 7, 'gates', '002 baseline present', case when to_regclass('public.businesses') is null then 'NO - apply 002 first and nothing else' else 'yes' end, 'Everything in this chain needs 002; 001 is only for a project that still holds the legacy leads table.'
  union all select 7, 'gates', 'gaps in the installed chain', coalesce((select string_agg(i.name, ', ' order by i.ord) from installed i where not i.present and exists (select 1 from installed j where j.ord > i.ord and j.present)), 'none'), 'An object whose migration never ran means an unknown state: stop and review before applying anything.'
  union all select 7, 'gates', 'next file to apply', coalesce((select name from installed where not present order by ord limit 1), 'none - chain complete'), 'Apply one file at a time, in this order, and re-run this inspection after each file.'
) checks
order by ord, section, "check";
