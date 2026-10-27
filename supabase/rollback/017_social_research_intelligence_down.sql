-- Roll back social resource intelligence. Records captured with the new provenance are kept as
-- manual research records rather than deleted: the migration must never destroy a prospect.
drop table if exists public.business_research_observations;
drop table if exists public.business_social_sources;
drop function if exists public.guard_business_research_observation();
drop function if exists public.guard_business_social_source();

update public.businesses set source_kind = 'manual' where source_kind = 'social_profile';
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'businesses_source_kind_check') then
    alter table public.businesses drop constraint businesses_source_kind_check;
  end if;
  alter table public.businesses add constraint businesses_source_kind_check check (source_kind in
    ('manual', 'directory', 'search', 'direct_submission', 'referral', 'places_reference', 'legacy_seed', 'provider_discovery'));
end $$;
