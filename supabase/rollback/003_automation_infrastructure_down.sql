-- Rollback for 003_automation_infrastructure.sql. Run only after a backup, and only if automation
-- must be removed: the job queue, agent run log, workflow history and automation settings are
-- deleted. Businesses and every pre-003 table are left as they were before 003 (apart from the
-- removed workflow columns). Re-applying 003 afterwards backfills workflow states again.

drop trigger if exists businesses_workflow_transition on public.businesses;
drop trigger if exists businesses_workflow_sync on public.businesses;
drop trigger if exists organizations_automation_settings on public.organizations;

-- The queue functions return automation_jobs rows, so they go before the table.
drop function if exists public.enqueue_automation_job(uuid, text, uuid, jsonb, text, integer, timestamptz, uuid, boolean, numeric, integer);
drop function if exists public.claim_automation_jobs(uuid, text, integer, integer);
drop function if exists public.finish_automation_job(uuid, uuid, text, jsonb, text, text, timestamptz);
drop function if exists public.cancel_automation_job(uuid, text);
drop function if exists public.retry_automation_job(uuid);
drop function if exists public.approve_automation_job(uuid);

drop table if exists public.agent_runs;
drop table if exists public.automation_jobs;
drop table if exists public.automation_settings;
drop table if exists public.workflow_transitions;

alter table public.businesses
  drop constraint if exists businesses_opt_out_workflow,
  drop constraint if exists businesses_workflow_state_check,
  drop constraint if exists businesses_workflow_actor_check,
  drop constraint if exists businesses_workflow_reason_check;
drop index if exists public.businesses_org_workflow_idx;
alter table public.businesses
  drop column if exists workflow_state,
  drop column if exists workflow_state_at,
  drop column if exists workflow_state_reason,
  drop column if exists workflow_state_actor;

drop function if exists public.guard_automation_settings();
drop function if exists public.apply_outbound_stop();
drop function if exists public.create_automation_settings();
drop function if exists public.record_workflow_transition();
drop function if exists public.sync_workflow_state();
drop function if exists public.derive_workflow_state(text, text, text, text);
drop function if exists public.can_automate(uuid);
drop function if exists public.outbound_available();
drop function if exists public.is_service_role();
