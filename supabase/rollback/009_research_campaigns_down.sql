-- Rollback for 009_research_campaigns.sql. Run only after a backup. Campaigns, their membership,
-- history and run log are deleted; the campaign keys are removed from automation jobs (the jobs
-- themselves stay). The 003 queue function is untouched and keeps working.

drop function if exists public.campaign_spend(uuid);
drop function if exists public.enqueue_campaign_job(uuid, text, uuid, jsonb, text, integer, timestamptz, uuid, boolean, numeric, integer, uuid, uuid);
drop index if exists public.automation_jobs_campaign_idx;

alter table public.automation_jobs drop constraint if exists automation_jobs_campaign_target_fk;
alter table public.automation_jobs drop constraint if exists automation_jobs_campaign_fk;
alter table public.automation_jobs drop column if exists campaign_target_id;
alter table public.automation_jobs drop column if exists campaign_id;

drop table if exists public.campaign_target_events;
drop table if exists public.campaign_runs;
drop table if exists public.campaign_targets;
drop table if exists public.research_campaigns;

drop function if exists public.log_campaign_target_event();
drop function if exists public.guard_campaign_target_state();
drop function if exists public.guard_campaign_status();
