-- Right after applying 003–017 to a database with existing data. READ ONLY: one SELECT that calls no
-- writing function, so it changes nothing; the SQL editor shows its result because it is the only
-- statement. Every row should say ok: messages to businesses are blocked, every workspace is in
-- Research only with the outbound stop engaged, opted-out businesses are suppressed, no consent was
-- invented, and the append-only records and safety triggers are in place. Rows 3, 8 and 9 describe
-- a fresh upgrade: once the team records consent, queues messages or changes the mode, they differ
-- by design. Rows 24–40 inspect the optional later migrations: 011 discovery, the 012–015 Studio
-- chain, the 016 resource ledger and the 017 social research tables. An optional row that says
-- 'not applied' is a recorded gap, not a failure of the migrations that were applied. See
-- docs/MIGRATION_REVIEW.md §3.
select "check", expected, actual, case when expected = actual then 'ok' else 'LOOK AT THIS' end as result
from (
  select 1 as ord, 'messages to businesses are blocked' as "check", 'false' as expected, public.outbound_available()::text as actual
  union all select 2, 'workspaces without automation settings', '0', (select count(*)::text from public.organizations o where not exists (select 1 from public.automation_settings s where s.organization_id = o.id))
  union all select 3, 'workspaces not in Research only', '0', (select count(*)::text from public.automation_settings where mode <> 'research_only')
  union all select 4, 'workspaces with the outbound stop released', '0', (select count(*)::text from public.automation_settings where not outbound_stopped)
  union all select 5, 'workspaces with sending paused or another timezone', '0', (select count(*)::text from public.automation_settings where sending_paused or sending_policy->>'timezone' <> 'Africa/Accra')
  union all select 6, 'opted-out businesses not in the opted-out state', '0', (select count(*)::text from public.businesses where contact_permission = 'opted_out' and workflow_state not in ('opted_out', 'archived'))
  union all select 7, 'opted-out businesses without a suppression', '0', (select count(*)::text from public.businesses b where b.contact_permission = 'opted_out' and not exists (select 1 from public.suppressions s where s.business_id = b.id and s.kind = 'business' and s.lifted_at is null))
  union all select 8, 'consent records (none are created from profiles)', '0', (select count(*)::text from public.consent_records)
  union all select 9, 'messages in the outbound queue', '0', (select count(*)::text from public.outreach_messages)
  union all select 10, 'safety triggers installed', '4', (select count(*)::text from pg_trigger where tgname in ('outreach_messages_send_policy', 'reply_classifications_guard', 'proposal_change_requests_guard', 'proposals_acceptance_guard'))
  union all select 11, 'members can delete suppressions', 'false', has_table_privilege('authenticated', 'public.suppressions', 'delete')::text
  union all select 12, 'members can edit consent records', 'false', has_table_privilege('authenticated', 'public.consent_records', 'update')::text
  union all select 13, 'members can edit gateway decisions', 'false', has_table_privilege('authenticated', 'public.eligibility_decisions', 'update')::text
  union all select 14, 'members can delete message policies', 'false', has_table_privilege('authenticated', 'public.message_policies', 'delete')::text
  union all select 15, 'members can edit reply readings', 'false', has_table_privilege('authenticated', 'public.reply_classifications', 'update')::text
  union all select 16, 'the worker key can create change requests', 'false', has_table_privilege('service_role', 'public.proposal_change_requests', 'insert')::text
  union all select 17, 'signed-out visitors can merge businesses', 'false', has_function_privilege('anon', 'public.merge_businesses(uuid, uuid, text[], text)', 'execute')::text
  union all select 18, 'messaging clock works', 'true', (public.messaging_now() is not null)::text
  union all select 19, 'campaigns using Google Places', '0', case when to_regclass('public.research_campaigns') is null then 'missing 009' else (select count(*)::text from public.research_campaigns where provider_key = 'google_places') end
  union all select 20, 'Ghana districts seeded', '261', case when to_regclass('public.ghana_districts') is null then 'missing 010' else (select count(*)::text from public.ghana_districts) end
  union all select 21, 'Ghana regions seeded', '16', case when to_regclass('public.ghana_regions') is null then 'missing 010' else (select count(*)::text from public.ghana_regions) end
  union all select 22, 'members can edit campaign membership history', 'false', case when to_regclass('public.campaign_target_events') is null then 'missing 009' else has_table_privilege('authenticated', 'public.campaign_target_events', 'update')::text end
  union all select 23, 'members can delete campaign membership history', 'false', case when to_regclass('public.campaign_target_events') is null then 'missing 009' else has_table_privilege('authenticated', 'public.campaign_target_events', 'delete')::text end
  union all select 24, '011 discovery tables installed', 'yes', case when to_regclass('public.discovery_runs') is null then 'not applied' else 'yes' end
  union all select 25, '012 Studio project tables installed', 'yes', case when to_regclass('public.studio_projects') is null then 'not applied' else 'yes' end
  union all select 26, '013 asset vault tables installed', 'yes', case when to_regclass('public.studio_assets') is null then 'not applied' else 'yes' end
  union all select 27, '014 creative direction tables installed', 'yes', case when to_regclass('public.studio_creative_directions') is null then 'not applied' else 'yes' end
  union all select 28, '015 website prototype table installed', 'yes', case when to_regclass('public.studio_website_prototypes') is null then 'not applied' else 'yes' end
  union all select 29, '016 resource ledger installed', 'yes', case when to_regclass('public.business_resource_entries') is null then 'not applied' else 'yes' end
  union all select 30, '016 resource ledger has RLS', 'true', case when to_regclass('public.business_resource_entries') is null then 'not applied' else (select relrowsecurity::text from pg_class where relname = 'business_resource_entries' and relnamespace = 'public'::regnamespace) end
  union all select 31, '016 resource ledger policies', '3', case when to_regclass('public.business_resource_entries') is null then 'not applied' else (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'business_resource_entries') end
  union all select 32, '016 resource ledger triggers', '2', case when to_regclass('public.business_resource_entries') is null then 'not applied' else (select count(*)::text from pg_trigger where tgrelid = to_regclass('public.business_resource_entries') and tgname in ('business_resource_guard', 'business_resource_audit')) end
  union all select 33, 'members can delete or truncate resource entries', 'false', case when to_regclass('public.business_resource_entries') is null then 'not applied' else (has_table_privilege('authenticated', 'public.business_resource_entries', 'delete') or has_table_privilege('authenticated', 'public.business_resource_entries', 'truncate'))::text end
  union all select 34, '017 social research tables installed', 'yes', case when to_regclass('public.business_social_sources') is null or to_regclass('public.business_research_observations') is null then 'not applied' else 'yes' end
  union all select 35, '017 social source references have RLS', 'true', case when to_regclass('public.business_social_sources') is null then 'not applied' else (select relrowsecurity::text from pg_class where relname = 'business_social_sources' and relnamespace = 'public'::regnamespace) end
  union all select 36, '017 research observations have RLS', 'true', case when to_regclass('public.business_research_observations') is null then 'not applied' else (select relrowsecurity::text from pg_class where relname = 'business_research_observations' and relnamespace = 'public'::regnamespace) end
  union all select 37, '017 social research policies', '6', case when to_regclass('public.business_social_sources') is null or to_regclass('public.business_research_observations') is null then 'not applied' else (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('business_social_sources', 'business_research_observations')) end
  union all select 38, '017 social research triggers', '4', case when to_regclass('public.business_social_sources') is null or to_regclass('public.business_research_observations') is null then 'not applied' else (select count(*)::text from pg_trigger where tgrelid in (to_regclass('public.business_social_sources'), to_regclass('public.business_research_observations')) and tgname in ('business_social_source_guard', 'business_social_source_audit', 'business_research_observation_guard', 'business_research_observation_audit')) end
  union all select 39, 'members can delete or truncate social research rows', 'false', case when to_regclass('public.business_social_sources') is null or to_regclass('public.business_research_observations') is null then 'not applied' else (has_table_privilege('authenticated', 'public.business_social_sources', 'delete') or has_table_privilege('authenticated', 'public.business_research_observations', 'delete') or has_table_privilege('authenticated', 'public.business_social_sources', 'truncate') or has_table_privilege('authenticated', 'public.business_research_observations', 'truncate'))::text end
  union all select 40, 'source kind allows social profiles', 'true', case when not exists (select 1 from pg_constraint where conrelid = 'public.businesses'::regclass and conname = 'businesses_source_kind_check') then 'not applied' else (select pg_get_constraintdef(oid) like '%social_profile%' from pg_constraint where conrelid = 'public.businesses'::regclass and conname = 'businesses_source_kind_check')::text end
  union all select 41, 'resource ledger closed to anonymous visitors', '0', case when to_regclass('public.business_resource_entries') is null then 'not applied' else (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name = 'business_resource_entries' and grantee in ('anon', 'PUBLIC')) end
  union all select 42, 'worker keeps the resource ledger without truncate', 'true', case when to_regclass('public.business_resource_entries') is null then 'not applied' else (has_table_privilege('service_role', 'public.business_resource_entries', 'select') and has_table_privilege('service_role', 'public.business_resource_entries', 'insert') and has_table_privilege('service_role', 'public.business_resource_entries', 'update') and has_table_privilege('service_role', 'public.business_resource_entries', 'delete') and not has_table_privilege('service_role', 'public.business_resource_entries', 'truncate'))::text end
) checks
order by ord;
