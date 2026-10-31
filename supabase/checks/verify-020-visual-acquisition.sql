-- READ ONLY post-migration verification for 020 (visual asset acquisition) on production
-- PostgreSQL 17. Run immediately after applying supabase/migrations/020_visual_asset_acquisition.sql,
-- in the same window, before the code deploy. It writes nothing: one SELECT, no DDL, no DML, no temp
-- table, so the SQL editor shows its single result and a read-only session can run it too.
--
-- Every row compares what the migration promises with what the catalog now holds. `result` is `ok`
-- when they agree and `LOOK AT THIS` when they do not. Row counts for the two new tables are in the
-- release document §3 (they are plain one-line queries, kept out of this table so that it stays a
-- single structural statement that also runs, reporting `missing`, on a project without the tables).
--
-- Failure meaning: a `LOOK AT THIS` row in sections 1–4 means the file did not fully apply. Do not
-- deploy on it; roll back with supabase/rollback/020_visual_asset_acquisition_down.sql and re-apply
-- from the top (docs/RELEASE_VISUAL_ASSET_ACQUISITION.md §7).
--
-- The trigger rows read `tgtype` bits (2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE)
-- rather than the rendered definition, so the order in which PostgreSQL prints trigger events cannot
-- make a check pass or fail by wording.

select "check", expected, actual, case when expected = actual or expected = 'informational' then 'ok' else 'LOOK AT THIS' end as result
from (
  select 1 as ord, 'both tables exist' as "check", 'yes' as expected,
    case when to_regclass('public.visual_asset_candidates') is null or to_regclass('public.visual_asset_candidate_events') is null then 'no' else 'yes' end as actual
  union all select 2, 'row level security on candidates', 'on', case when to_regclass('public.visual_asset_candidates') is null then 'missing' when (select relrowsecurity from pg_class where oid = to_regclass('public.visual_asset_candidates')) then 'on' else 'off' end
  union all select 3, 'row level security on candidate events', 'on', case when to_regclass('public.visual_asset_candidate_events') is null then 'missing' when (select relrowsecurity from pg_class where oid = to_regclass('public.visual_asset_candidate_events')) then 'on' else 'off' end
  union all select 4, 'policies on candidates (read, insert, update)', 'INSERT,SELECT,UPDATE',
    coalesce((select string_agg(cmd, ',' order by cmd) from pg_policies where schemaname = 'public' and tablename = 'visual_asset_candidates'), 'missing')
  union all select 5, 'policies on candidate events (read, insert)', 'INSERT,SELECT',
    coalesce((select string_agg(cmd, ',' order by cmd) from pg_policies where schemaname = 'public' and tablename = 'visual_asset_candidate_events'), 'missing')
  union all select 6, 'policy names are the reviewed ones', 'visual_candidate_event_insert, visual_candidate_event_read, visual_candidate_insert, visual_candidate_read, visual_candidate_update',
    coalesce((select string_agg(policyname, ', ' order by policyname) from pg_policies where schemaname = 'public' and tablename in ('visual_asset_candidates', 'visual_asset_candidate_events')), 'missing')
  union all select 7, 'triggers on candidates (guard, audit)', '2',
    coalesce((select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidates') and not tgisinternal), 'missing')
  union all select 8, 'trigger on candidate events (append-only)', '1',
    coalesce((select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidate_events') and not tgisinternal), 'missing')
  union all select 9, 'candidate guard fires before insert or update', '1',
    coalesce((select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidates') and tgname = 'visual_candidate_guard' and (tgtype & 2) <> 0 and (tgtype & 4) <> 0 and (tgtype & 16) <> 0), 'missing')
  union all select 10, 'candidate audit fires after every change', '1',
    coalesce((select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidates') and tgname = 'visual_candidate_audit' and (tgtype & 2) = 0 and (tgtype & 4) <> 0 and (tgtype & 8) <> 0 and (tgtype & 16) <> 0), 'missing')
  union all select 11, 'event guard refuses every change', '1',
    coalesce((select count(*)::text from pg_trigger where tgrelid = to_regclass('public.visual_asset_candidate_events') and tgname = 'visual_candidate_event_guard' and (tgtype & 2) <> 0 and (tgtype & 8) <> 0 and (tgtype & 16) <> 0), 'missing')
  union all select 12, 'stored rows need a rights basis and evidence', 'true',
    coalesce((select (pg_get_constraintdef(oid) like '%rights_basis%' and pg_get_constraintdef(oid) like '%char_length%')::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidates') and conname = 'visual_candidates_import_check'), 'missing')
  union all select 13, 'a third-party reference never claims a download', 'true',
    coalesce((select (pg_get_constraintdef(oid) like '%imported_via%' and pg_get_constraintdef(oid) like '%uploaded%')::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidates') and conname = 'visual_candidates_reference_only_check'), 'missing')
  union all select 14, 'one candidate per business and image address', '1',
    coalesce((select count(*)::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidates') and contype = 'u' and pg_get_constraintdef(oid) like '%(organization_id, business_id, image_url)%'), 'missing')
  union all select 15, 'candidate foreign keys (workspace, business, vault, author)', '4',
    coalesce((select count(*)::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidates') and contype = 'f'), 'missing')
  union all select 16, 'deleting a parent removes its candidates', '3',
    coalesce((select count(*)::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidates') and contype = 'f' and confdeltype = 'c'), 'missing')
  union all select 17, 'events follow their candidate and workspace', '2',
    coalesce((select count(*)::text from pg_constraint where conrelid = to_regclass('public.visual_asset_candidate_events') and contype = 'f' and confdeltype = 'c'), 'missing')
  union all select 18, 'members hold select, insert and update on candidates only', 'INSERT,SELECT,UPDATE',
    case when to_regclass('public.visual_asset_candidates') is null then 'missing'
      else (select string_agg(p, ',' order by p) from unnest(array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) p
             where has_table_privilege('authenticated', to_regclass('public.visual_asset_candidates'), p)) end
  union all select 19, 'members hold select and insert on events only', 'INSERT,SELECT',
    case when to_regclass('public.visual_asset_candidate_events') is null then 'missing'
      else (select string_agg(p, ',' order by p) from unnest(array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) p
             where has_table_privilege('authenticated', to_regclass('public.visual_asset_candidate_events'), p)) end
  union all select 20, 'anonymous visitors and PUBLIC hold nothing', '0',
    case when to_regclass('public.visual_asset_candidates') is null or to_regclass('public.visual_asset_candidate_events') is null then 'missing'
      else (select count(*)::text from unnest(array['anon', 'public']) r(role_name), unnest(array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) p
             where has_table_privilege(r.role_name, to_regclass('public.visual_asset_candidates'), p)
                or has_table_privilege(r.role_name, to_regclass('public.visual_asset_candidate_events'), p)) end
  union all select 21, 'worker keeps the ledger without truncate, references or trigger', 'true',
    case when to_regclass('public.visual_asset_candidates') is null or to_regclass('public.visual_asset_candidate_events') is null then 'missing'
      else (select bool_and(has_table_privilege('service_role', to_regclass(t), 'select') and has_table_privilege('service_role', to_regclass(t), 'insert')
             and has_table_privilege('service_role', to_regclass(t), 'update') and has_table_privilege('service_role', to_regclass(t), 'delete')
             and not has_table_privilege('service_role', to_regclass(t), 'truncate') and not has_table_privilege('service_role', to_regclass(t), 'references')
             and not has_table_privilege('service_role', to_regclass(t), 'trigger'))::text
            from unnest(array['public.visual_asset_candidates', 'public.visual_asset_candidate_events']) t) end
  union all select 22, 'trigger functions are not callable by members or visitors', 'false',
    case when to_regprocedure('public.guard_visual_candidate_update()') is null or to_regprocedure('public.guard_visual_candidate_event()') is null then 'missing'
      else (has_function_privilege('authenticated', to_regprocedure('public.guard_visual_candidate_update()'), 'execute')
         or has_function_privilege('authenticated', to_regprocedure('public.guard_visual_candidate_event()'), 'execute')
         or has_function_privilege('anon', to_regprocedure('public.guard_visual_candidate_update()'), 'execute')
         or has_function_privilege('anon', to_regprocedure('public.guard_visual_candidate_event()'), 'execute'))::text end
  union all select 23, 'trigger functions pin their search_path', 'true',
    case when to_regprocedure('public.guard_visual_candidate_update()') is null or to_regprocedure('public.guard_visual_candidate_event()') is null then 'missing'
      else (select bool_and(proconfig is not null)::text from pg_proc where oid in (to_regprocedure('public.guard_visual_candidate_update()'), to_regprocedure('public.guard_visual_candidate_event()'))) end
  union all select 24, 'the three named indexes exist', '3',
    coalesce((select count(*)::text from pg_indexes where schemaname = 'public' and indexname in ('visual_candidates_business_idx', 'visual_candidates_project_idx', 'visual_candidate_events_candidate_idx')), 'missing')
) checks
order by ord;
