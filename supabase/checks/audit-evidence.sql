-- Production evidence for the acceptance audit (docs/PRODUCTION_ACCEPTANCE_AUDIT.md). READ ONLY: one
-- SELECT that calls no writing function, so it changes nothing; the SQL editor shows its result
-- because it is the only statement. It returns counts and dates only: no names, email addresses,
-- phone numbers or message text. Run it in the SQL editor after migrations 001–008.
select section, metric, value
from (
  select 1 as ord, 'auth' as section, 'accounts (confirmed)' as metric, (select count(*) || ' (' || count(email_confirmed_at) || ')' from auth.users) as value
  union all select 2, 'auth', 'latest sign-in (date)', (select coalesce(max(last_sign_in_at)::date::text, 'never') from auth.users)
  union all select 3, 'workspaces', 'workspaces / members / open invitations', (select count(*) from public.organizations) || ' / ' || (select count(*) from public.organization_members) || ' / ' || (select count(*) from public.organization_invitations where accepted_at is null)
  union all select 4, 'workspaces', 'workspaces with a priced package or add-on', (select count(*)::text from public.organizations where jsonb_path_exists(settings, '$.packages[*].lineItems[*].defaultUnitPrice ? (@ != null)') or jsonb_path_exists(settings, '$.addOns[*].unitPrice ? (@ != null)'))
  union all select 5, 'crm', 'prospects (fictional demo / with a Place ID)', (select count(*) || ' (' || count(*) filter (where name like 'DEMO ·%') || ' / ' || count(places_place_id) || ')' from public.businesses)
  union all select 6, 'crm', 'prospects by stage', (select coalesce(string_agg(stage || ' ' || n, ', ' order by stage), 'none') from (select stage, count(*) n from public.businesses group by stage) s)
  union all select 7, 'research', 'website checks by status', (select coalesce(string_agg(status || ' ' || n, ', ' order by status), 'none') from (select status, count(*) n from public.website_verifications group by status) s)
  union all select 8, 'research', 'contact details by source / validated', (select coalesce(string_agg(source_type || ' ' || n, ', ' order by source_type), 'none') from (select source_type, count(*) n from public.contact_points group by source_type) s) || ' / ' || (select count(*) from public.contact_points where validated_at is not null)
  union all select 9, 'reports', 'opportunity reports by generator', (select coalesce(string_agg(generator || ' ' || n, ', ' order by generator), 'none') from (select generator, count(*) n from public.opportunity_reports group by generator) s)
  union all select 10, 'proposals', 'proposals by status', (select coalesce(string_agg(status || ' ' || n, ', ' order by status), 'none') from (select status, count(*) n from public.proposals group by status) s)
  union all select 11, 'automation', 'jobs by status', (select coalesce(string_agg(status || ' ' || n, ', ' order by status), 'none') from (select status, count(*) n from public.automation_jobs group by status) s)
  union all select 12, 'automation', 'agent runs (latest date)', (select count(*) || ' (' || coalesce(max(started_at)::date::text, 'never') || ')' from public.agent_runs)
  union all select 13, 'automation', 'workspaces paused / outbound stop engaged / with budgets', (select count(*) filter (where paused) || ' / ' || count(*) filter (where outbound_stopped) || ' / ' || count(*) filter (where budgets is not null and budgets <> '{}'::jsonb) from public.automation_settings)
  union all select 14, 'messaging', 'consent granted / withdrawn', (select count(*) filter (where status = 'granted') || ' / ' || count(*) filter (where status = 'withdrawn') from public.consent_records)
  union all select 15, 'messaging', 'active suppressions', (select count(*)::text from public.suppressions where lifted_at is null)
  union all select 16, 'messaging', 'outbound messages by status', (select coalesce(string_agg(status || ' ' || n, ', ' order by status), 'none') from (select status, count(*) n from public.outreach_messages group by status) s)
  union all select 17, 'messaging', 'replies received / AI readings', (select count(*) from public.inbound_messages) || ' / ' || (select count(*) from public.reply_classifications)
  union all select 18, 'usage', 'paid calls in the last 30 days by provider (US$ estimated)', (select coalesce(string_agg(provider || ' ' || n || ' ($' || round(usd, 3) || ')', ', ' order by provider), 'none') from (select provider, count(*) n, sum(estimated_cost_usd) usd from public.usage_records where created_at > now() - interval '30 days' group by provider) s)
  union all select 19, 'audit', 'audit log entries (latest date)', (select count(*) || ' (' || coalesce(max(created_at)::date::text, 'never') || ')' from public.audit_events)
) evidence
order by ord;
