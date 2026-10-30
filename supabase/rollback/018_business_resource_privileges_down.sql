-- Roll back 018 only. This puts the table back exactly as 016 and Supabase's default privileges left it,
-- which means it reopens the gap 018 closed: members can truncate the ledger again (TRUNCATE ignores RLS)
-- and anonymous visitors hold the full privilege set. Run it only to restore a state you are about to
-- replace, or as part of the full reverse chain, never as a way to "try" the migration.
--
-- Nothing else changes: no data, no schema, no policy and no trigger is touched, so this is safe on a
-- table with records. It is guarded for a database where 016 is already rolled back or where the Supabase
-- roles do not exist, and it is re-runnable.

do $$
begin
  if to_regclass('public.business_resource_entries') is null then
    return;
  end if;
  execute 'grant delete, truncate on public.business_resource_entries to authenticated';
  execute 'grant truncate on public.business_resource_entries to service_role';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant all on public.business_resource_entries to anon';
  end if;
end $$;
