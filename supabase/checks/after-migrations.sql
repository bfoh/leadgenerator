-- Right after applying 003–008 to a database with existing data. READ ONLY: one SELECT that calls no
-- writing function, so it changes nothing; the SQL editor shows its result because it is the only
-- statement. Every row should say ok: messages to businesses are blocked, every workspace is in
-- Research only with the outbound stop engaged, opted-out businesses are suppressed, no consent was
-- invented, and the append-only records and safety triggers are in place. Rows 3, 8 and 9 describe
-- a fresh upgrade: once the team records consent, queues messages or changes the mode, they differ
-- by design. See docs/MIGRATION_REVIEW.md §3.
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
) checks
order by ord;
