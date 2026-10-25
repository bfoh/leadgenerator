-- Rollback for migration 012 (Studio brand intelligence foundation).
--
-- Drops only what 012 created. Studio data is lost; businesses, organizations and audit history are
-- untouched apart from the `studio_projects` audit rows that migration 002's trigger wrote.

drop table if exists public.studio_reviews cascade;
drop table if exists public.studio_observations cascade;
drop table if exists public.studio_projects cascade;

drop function if exists public.guard_studio_review_append_only();
drop function if exists public.guard_studio_observation_append_only();

-- The `studio` activity type goes with the Studio; existing entries of that type would block the
-- narrower constraint, so they are removed first (the prospect's other history is untouched).
delete from public.activities where type = 'studio';
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in ('note', 'stage_change', 'call',
  'meeting', 'email', 'whatsapp', 'verification', 'report', 'proposal', 'permission', 'project', 'system'));
