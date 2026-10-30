-- Roll back 019 only. This puts the five Studio tables back exactly as 014, 015 and Supabase's default
-- privileges left them, which means it reopens the gap 019 closed: members can truncate every
-- organization's Studio history in one statement (TRUNCATE ignores RLS), a future delete policy would be
-- enough to let them delete it, and anonymous visitors hold the full privilege set again. Run it only to
-- restore a state you are about to replace, or as part of the full reverse chain, never as a way to "try"
-- the migration.
--
-- Nothing else changes: no data, no schema, no policy and no trigger is touched, so this is safe on tables
-- with records. Each table is guarded on its own, so a database where 014 or 015 was already rolled back
-- restores what still exists and skips the rest; the `anon` grant is guarded on the role existing, so a
-- local Postgres or a test harness without Supabase's roles is safe. It is re-runnable.

do $$
declare
  target text;
begin
  foreach target in array array[
    'studio_creative_briefs',
    'studio_creative_brief_reviews',
    'studio_creative_directions',
    'studio_creative_direction_reviews',
    'studio_website_prototypes'
  ] loop
    if to_regclass('public.' || target) is null then
      continue;
    end if;
    execute format('grant delete, truncate on public.%I to authenticated', target);
    execute format('grant truncate on public.%I to service_role', target);
    -- Postgres 17 only: see the note in 019. Skipped on 15 and 16, where the privilege does not exist.
    if current_setting('server_version_num')::int >= 170000 then
      execute format('grant maintain on public.%I to authenticated, service_role', target);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant all on public.%I to anon', target);
    end if;
  end loop;
end $$;
