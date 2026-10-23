-- Rollback for 007_sending_policy.sql. Run only after a backup, and only if phase 8's sending policy
-- must be removed: message policies are deleted, and the workspace sending policy and pause switch
-- are dropped from automation_settings. Without them nothing covers a template, so the phase 7
-- gateway rules apply again (the application blocks approval until 007 is re-applied).
--
-- Eligibility decisions recorded as 'deferred' are kept: the original outcome check is restored as
-- NOT VALID so those rows stay as they were and new rows must be eligible or blocked. Every other
-- table and column is left as it was.

drop trigger if exists outreach_messages_send_policy on public.outreach_messages;
drop function if exists public.enforce_send_policy();

drop table if exists public.message_policies;
drop function if exists public.guard_message_policy();
delete from public.audit_events where table_name = 'message_policies';

drop trigger if exists automation_settings_sending_guard on public.automation_settings;
drop function if exists public.guard_sending_controls();
alter table public.automation_settings drop constraint if exists automation_settings_sending_policy_check;
alter table public.automation_settings drop constraint if exists automation_settings_sending_pause_reason_check;
alter table public.automation_settings
  drop column if exists sending_policy,
  drop column if exists sending_paused,
  drop column if exists sending_pause_reason,
  drop column if exists sending_paused_at,
  drop column if exists sending_paused_by;

alter table public.eligibility_decisions drop constraint if exists eligibility_decisions_outcome_check;
alter table public.eligibility_decisions add constraint eligibility_decisions_outcome_check check (outcome in ('eligible', 'blocked')) not valid;

drop function if exists public.valid_sending_policy(jsonb);
drop function if exists public.hhmm_minutes(text);
drop function if exists public.messaging_now();
