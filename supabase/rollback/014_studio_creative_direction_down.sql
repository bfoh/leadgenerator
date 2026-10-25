-- Rollback for migration 014 (creative direction). Drops only what 014 created; the Studio's brief,
-- vault, Brand Kit and concept remain.

drop trigger if exists studio_creative_direction_reviews_guard on public.studio_creative_direction_reviews;
drop trigger if exists studio_creative_directions_guard on public.studio_creative_directions;
drop trigger if exists studio_creative_brief_reviews_guard on public.studio_creative_brief_reviews;
drop trigger if exists studio_creative_briefs_guard on public.studio_creative_briefs;

drop function if exists public.guard_studio_creative_direction_review();
drop function if exists public.guard_studio_creative_direction();
drop function if exists public.guard_studio_creative_brief_review();
drop function if exists public.guard_studio_creative_brief();

drop table if exists public.studio_creative_direction_reviews;
drop table if exists public.studio_creative_directions;
drop table if exists public.studio_creative_brief_reviews;
drop table if exists public.studio_creative_briefs;
