-- READ ONLY pre-apply inspection for migration 020 (visual asset acquisition) on production
-- PostgreSQL 17. Prepared 31 October 2026 for the release preparation of
-- feature/google-business-resource-collector; NOT yet run against production.
--
-- One SELECT that calls no writing function: no DDL, no DML, no `set`, no temp table, no `do` block.
-- Safe to paste into the production SQL editor (the editor shows its single result) or to run through
-- psql inside a read-only transaction:
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$PRODUCTION_READONLY_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/checks/preflight-020-visual-acquisition.sql
--
-- Every object is probed with to_regclass / to_regprocedure / catalogs, so this runs unchanged on a
-- project where 020 is absent (the normal case), on one where an earlier draft of 020 was applied,
-- and on one where 020 is already installed. Sections:
--   1 prerequisites  what 020 stands on, as object markers rather than CLI history
--   2 ordering       whether 020 is the next file, and what follows it (nothing)
--   3 target state   whether 020's tables already exist, and in which shape
--   4 existing data  the rows the apply must leave exactly as they are
--   5 impact         where the apply time goes, and what it rewrites (nothing existing)
--   6 neighbours     privileges and RLS on the tables 020 points at but does not change
--   7 gates          the go/no-go rows: baseline, prerequisites, target absent, next action
--
-- After applying, run supabase/checks/verify-020-visual-acquisition.sql. The release sequence is
-- docs/RELEASE_VISUAL_ASSET_ACQUISITION.md; recovery is §7 of that document.

select 1 as ord, 'prerequisites' as section, '002 workspace model' as "check",
  case when to_regclass('public.businesses') is null then 'missing' else 'present' end as value,
  'Organizations, membership, RLS helpers and the audit log every later migration rests on.' as meaning
union all select 1, 'prerequisites', '002 audit trigger helper', case when to_regprocedure('public.audit_row_change()') is null then 'missing' else 'present' end, '020 attaches the shared audit trigger; its own guard stops the apply if this helper is absent.'
union all select 1, 'prerequisites', '002 organisation membership helper', case when to_regprocedure('public.is_org_member(uuid)') is null then 'missing' else 'present' end, 'The read policies call it.'
union all select 1, 'prerequisites', '002 organisation role helper', case when to_regprocedure('public.has_org_role(uuid,text[])') is null then 'missing' else 'present' end, 'The write policies call it: owner, admin, researcher or sales.'
union all select 1, 'prerequisites', '012 Studio projects', case when to_regclass('public.studio_projects') is null then 'missing' else 'present' end, 'A candidate belongs to one vault; the composite foreign key points here.'
union all select 1, 'prerequisites', '013 Studio asset vault', case when to_regclass('public.studio_assets') is null then 'missing' else 'present' end, '020 stores no file of its own: a stored candidate points at one of these rows.'
union all select 1, 'prerequisites', '016 resource ledger', case when to_regclass('public.business_resource_entries') is null then 'missing' else 'present' end, 'The kit reads this ledger beside the visual files; 020 does not change it.'
union all select 1, 'prerequisites', '017 social research', case when to_regclass('public.business_social_sources') is null then 'missing' else 'present' end, 'Read only, as a chain marker: 020 follows 017.'
union all select 1, 'prerequisites', 'Supabase Storage schema', case when to_regclass('storage.buckets') is null then 'absent' else 'present' end, 'Absent means 013 could not provision the private studio-assets bucket, so no authorized copy can be stored yet.'

union all select 2, 'ordering', 'chain marker 002', case when to_regclass('public.businesses') is null then 'missing' else 'present' end, 'Order is proven by object markers, because the repository keeps no CLI history.'
union all select 2, 'ordering', 'chain marker 012', case when to_regclass('public.studio_projects') is null then 'missing' else 'present' end, 'A gap here is an unknown schema state: stop before applying 020.'
union all select 2, 'ordering', 'chain marker 013', case when to_regclass('public.studio_assets') is null then 'missing' else 'present' end, '020 declares 013 as a prerequisite and raises its own exception without it.'
union all select 2, 'ordering', 'chain marker 016', case when to_regclass('public.business_resource_entries') is null then 'missing' else 'present' end, 'The release needs it; 020 itself applies without it.'
union all select 2, 'ordering', '019 Studio privileges', case when to_regclass('public.studio_asset_events') is null then 'unknown' when has_table_privilege('authenticated', 'public.studio_assets', 'truncate') then 'not hardened' else 'hardened' end, '019 takes TRUNCATE away from members on the Studio tables; 020 follows it with the same shape.'
union all select 2, 'ordering', '020 target tables', case when to_regclass('public.visual_asset_candidates') is null and to_regclass('public.visual_asset_candidate_events') is null then 'both absent' when to_regclass('public.visual_asset_candidates') is not null and to_regclass('public.visual_asset_candidate_events') is not null then 'both present' else 'only one present - an interrupted or partial draft; review before applying' end, 'Both should be absent before the first apply, and both present afterwards.'
union all select 2, 'ordering', 'file after 020', 'none - 020 is the newest file in the chain', '020 is the last migration in the repository; nothing waits behind it.'


union all select 3, 'target state', 'public.visual_asset_candidates', case when to_regclass('public.visual_asset_candidates') is null then 'missing' else 'present' end, 'Candidate images, their source page and the rights decision.'
union all select 3, 'target state', 'public.visual_asset_candidate_events', case when to_regclass('public.visual_asset_candidate_events') is null then 'missing' else 'present' end, 'Append-only history of discovery, import, request, rejection and approval.'
union all select 3, 'target state', 'named checks on candidates', case when to_regclass('public.visual_asset_candidates') is null then 'missing' else (select count(*)::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidates') and conname in ('visual_candidates_import_check', 'visual_candidates_reference_only_check')) end, 'Expect 2 when installed: a stored row needs a rights basis and evidence, and a third-party reference never claims a download. 0 on an installed table means an earlier draft is present.'
union all select 3, 'target state', 'triggers on candidates', case when to_regclass('public.visual_asset_candidates') is null then 'missing' else (select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidates') and not tgisinternal) end, 'Expect 2 when installed: the forward-only guard and the shared audit trigger.'
union all select 3, 'target state', 'triggers on candidate events', case when to_regclass('public.visual_asset_candidate_events') is null then 'missing' else (select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidate_events') and not tgisinternal) end, 'Expect 1 when installed: the append-only guard.'
union all select 3, 'target state', 'policies on candidates', case when to_regclass('public.visual_asset_candidates') is null then 'missing' else (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'visual_asset_candidates') end, 'Expect 3 when installed: read for members, insert and update for owner, admin, researcher and sales.'
union all select 3, 'target state', 'indexes 020 names', case when to_regclass('public.visual_asset_candidates') is null then 'missing' else (select count(*)::text from pg_indexes where schemaname = 'public' and indexname in ('visual_candidates_business_idx', 'visual_candidates_project_idx', 'visual_candidate_events_candidate_idx')) end, 'Expect 3 when installed; they are re-runnable (if not exists).'
union all select 3, 'target state', 'rows already in the candidate table', case when to_regclass('public.visual_asset_candidates') is null then 'missing' else coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'visual_asset_candidates'), 'unknown') end, 'Live rows from the statistics collector: 0 on a first apply. Anything above 0 means an earlier draft holds rows that must be reviewed before it is reused.'
union all select 3, 'target state', 'rows already in the event table', case when to_regclass('public.visual_asset_candidate_events') is null then 'missing' else coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'visual_asset_candidate_events'), 'unknown') end, 'Same: empty on a first apply.'

union all select 4, 'existing data', 'organizations', (select count(*)::text from public.organizations), '020 adds no rows here and changes nothing on this table.'
union all select 4, 'existing data', 'businesses', (select count(*)::text from public.businesses), 'Not altered by 020; the count must read the same afterwards.'
union all select 4, 'existing data', 'Studio projects', case when to_regclass('public.studio_projects') is null then 'missing' else coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'studio_projects'), 'unknown') end, 'Not altered by 020.'
union all select 4, 'existing data', 'Studio assets', case when to_regclass('public.studio_assets') is null then 'missing' else coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'studio_assets'), 'unknown') end, 'Not altered: 020 only points new candidate rows at existing vault rows.'
union all select 4, 'existing data', 'Studio asset events', case when to_regclass('public.studio_asset_events') is null then 'missing' else coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'studio_asset_events'), 'unknown') end, 'Append-only history; 020 writes none of it.'
union all select 4, 'existing data', 'resource ledger entries', case when to_regclass('public.business_resource_entries') is null then 'missing' else coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'business_resource_entries'), 'unknown') end, 'Read by the kit; never written by 020.'
union all select 4, 'existing data', 'social sources and observations', case when to_regclass('public.business_social_sources') is null then 'missing' else (coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'business_social_sources'), 'unknown') || ' sources, ' || coalesce((select n_live_tup::text from pg_stat_user_tables where schemaname = 'public' and relname = 'business_research_observations'), 'unknown') || ' observations') end, 'Both are exported by the kit; 020 writes neither.'


union all select 5, 'impact', 'tables 020 creates', '2 new tables', 'visual_asset_candidates and visual_asset_candidate_events. No existing table is altered, and no column is dropped or retyped anywhere.'
union all select 5, 'impact', 'other objects 020 creates', '3 triggers, 2 functions, 3 indexes, 4 named constraints', 'All named and re-runnable; the migration drops and recreates only its own named objects.'
union all select 5, 'impact', 'rows rewritten by the apply', '0', 'Additive only: the two tables start empty, and no existing row is updated or copied.'
union all select 5, 'impact', 'Studio assets table size', case when to_regclass('public.studio_assets') is null then 'missing' else pg_size_pretty(pg_total_relation_size('public.studio_assets')) end, 'The new foreign keys validate against this table, so its size is the check time.'
union all select 5, 'impact', 'other sessions open', (select count(*)::text from pg_stat_activity where state is not null and pid <> pg_backend_pid()), 'Apply in a quiet window: the new tables take ACCESS EXCLUSIVE briefly while they are created.'
union all select 5, 'impact', 'requests running over 5 minutes', (select count(*)::text from pg_stat_activity where xact_start is not null and xact_start < now() - interval '5 minutes' and pid <> pg_backend_pid()), 'A long transaction makes the brief lock wait; wait for zero.'

union all select 6, 'neighbours', 'RLS on Studio assets', case when to_regclass('public.studio_assets') is null then 'missing' when (select relrowsecurity from pg_class where oid = to_regclass('public.studio_assets')) then 'on' else 'OFF' end, '020 assumes the vault stays closed; OFF is a finding for the wider review, not a 020 failure.'
union all select 6, 'neighbours', 'members can truncate Studio assets', case when to_regclass('public.studio_assets') is null then 'missing' else has_table_privilege('authenticated', 'public.studio_assets', 'truncate')::text end, '019 should leave this false. 020 grants TRUNCATE nowhere and revokes what Supabase granted at creation.'
union all select 6, 'neighbours', 'anonymous visitors can read Studio assets', case when to_regclass('public.studio_assets') is null then 'missing' else has_table_privilege('anon', 'public.studio_assets', 'select')::text end, '019 should leave this false; RLS would still refuse, and 020 repeats the revoke for its own tables.'
union all select 6, 'neighbours', 'worker holds Studio asset truncate', case when to_regclass('public.studio_assets') is null then 'missing' else has_table_privilege('service_role', 'public.studio_assets', 'truncate')::text end, '019 should leave this false: the worker keeps select, insert, update and delete only.'

union all select 7, 'gates', '002 baseline present', case when to_regclass('public.businesses') is null then 'NO - apply 002 first and nothing else' else 'yes' end, 'Everything in the chain needs 002.'
union all select 7, 'gates', 'prerequisites complete',
  case
    when to_regclass('public.businesses') is null then 'no - 002 is missing'
    when to_regprocedure('public.audit_row_change()') is null then 'no - the 002 audit helper is missing'
    when to_regprocedure('public.is_org_member(uuid)') is null then 'no - the 002 membership helper is missing'
    when to_regprocedure('public.has_org_role(uuid,text[])') is null then 'no - the 002 role helper is missing'
    when to_regclass('public.studio_projects') is null then 'no - 012 is missing'
    when to_regclass('public.studio_assets') is null then 'no - 013 is missing'
    when to_regclass('public.business_resource_entries') is null then 'no - 016 is missing, and the kit needs it'
    when to_regclass('public.business_social_sources') is null then 'no - 017 is missing'
    else 'yes'
  end,
  'Any "no" is applied first, in order, and this inspection is re-run before 020.'
union all select 7, 'gates', '020 already installed', case when to_regclass('public.visual_asset_candidates') is null and to_regclass('public.visual_asset_candidate_events') is null then 'no - apply 020 once' when to_regclass('public.visual_asset_candidates') is not null and to_regclass('public.visual_asset_candidate_events') is not null then 'yes - do not apply again; run the verification instead' else 'partial - run the down script, then apply once' end, 'A full re-run converges, but a partial draft is not a state to build on.'
union all select 7, 'gates', 'read-only session', case when current_setting('transaction_read_only') = 'on' then 'yes' else 'no - this inspection should be run read only' end, 'The statement itself writes nothing; this row proves the session could not have written even if it did.'
union all select 7, 'gates', 'next action', case when to_regclass('public.visual_asset_candidates') is null then 'run supabase/migrations/020_visual_asset_acquisition.sql in one transaction, then verify-020' else 'run supabase/checks/verify-020-visual-acquisition.sql' end, 'The apply window and the deploy are separate approvals; see docs/RELEASE_VISUAL_ASSET_ACQUISITION.md.'
order by ord, section, "check";
