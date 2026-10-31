-- Rollback for 020_visual_asset_acquisition.sql. Drops only the tables this migration created.
drop table if exists public.visual_asset_candidate_events;
drop table if exists public.visual_asset_candidates;
drop function if exists public.guard_visual_candidate_event();
drop function if exists public.guard_visual_candidate_update();
