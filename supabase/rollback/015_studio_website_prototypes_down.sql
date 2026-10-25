-- Rollback for migration 015 (rendered website prototypes). Drops only what 015 created; the
-- approved direction, concept, Brand Kit and asset vault remain.

drop trigger if exists studio_website_prototypes_guard on public.studio_website_prototypes;
drop function if exists public.guard_studio_website_prototype();
drop table if exists public.studio_website_prototypes;
