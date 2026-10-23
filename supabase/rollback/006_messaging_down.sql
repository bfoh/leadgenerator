-- Rollback for 006_messaging.sql. Run only after a backup, and only if phase 7 messaging must be
-- removed: templates, the outbound queue with its delivery history, eligibility decisions, received
-- messages and webhook events are deleted.
--
-- Suppressions added by replies, bounces and complaints are kept (they are migration 005's table).
-- Their sources 'inbound_opt_out' and 'provider_event' stay valid because the source check that 006
-- widened is deliberately left in place, so no suppression has to be changed or dropped. Every
-- other pre-006 table and column is left as it was.

do $$
begin
  if to_regclass('public.reply_classifications') is not null then
    raise exception 'Migration 008 (responses and conversion) is installed and depends on these tables. Run supabase/rollback/008_response_conversion_down.sql first.';
  end if;
  if to_regclass('public.message_policies') is not null then
    raise exception 'Migration 007 (sending policy) is installed and depends on these tables. Run supabase/rollback/007_sending_policy_down.sql first.';
  end if;
end $$;

drop trigger if exists outreach_messages_delivery_suppression on public.outreach_messages;
drop trigger if exists inbound_messages_opt_out on public.inbound_messages;

alter table if exists public.outreach_messages drop constraint if exists outreach_messages_in_reply_to_fkey;
drop table if exists public.channel_events;
drop table if exists public.inbound_messages;
drop table if exists public.outreach_messages;
drop table if exists public.eligibility_decisions;
drop table if exists public.message_templates;

drop function if exists public.suppress_on_inbound_opt_out();
drop function if exists public.guard_inbound_message();
drop function if exists public.suppress_on_delivery_failure();
drop function if exists public.guard_outreach_message();
drop function if exists public.guard_eligibility_decision();
drop function if exists public.guard_message_template();

delete from public.audit_events where table_name in ('message_templates', 'outreach_messages');
