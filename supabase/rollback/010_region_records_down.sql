-- Rollback for 010_region_records.sql. Run only after a backup. The district reference data and the
-- district_code column are removed, and a town becomes required again. A record known only to
-- district or region level cannot satisfy that, so the rollback stops and lists what to fill in
-- first; nothing is deleted.

do $$
begin
  if exists (select 1 from public.businesses where city is null) then
    raise exception 'Cannot make the town required again: % prospect(s) have no town. Give each one a town or delete it deliberately, then roll back.', (select count(*) from public.businesses where city is null);
  end if;
end $$;

drop trigger if exists businesses_district_sync on public.businesses;
drop function if exists public.sync_business_district();

alter table public.businesses drop constraint if exists businesses_location_known;
alter table public.businesses drop constraint if exists businesses_city_check;
alter table public.businesses add constraint businesses_city_check check (char_length(btrim(city)) between 1 and 80);
alter table public.businesses alter column city set not null;

drop index if exists public.businesses_org_district_idx;
drop index if exists public.businesses_org_region_idx;
alter table public.businesses drop constraint if exists businesses_district_fk;
alter table public.businesses drop column if exists district_code;

drop table if exists public.ghana_districts;
drop table if exists public.ghana_regions;
