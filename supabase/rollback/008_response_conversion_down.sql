-- Rollback for 008_response_conversion.sql. Run only after a backup, and only if phase 9's reply
-- classifications and proposal change requests must be removed: both histories are deleted with
-- their audit events, and the acceptance guard on proposals is dropped. Received messages,
-- suppressions, proposals and tasks are left as they were.

drop trigger if exists proposals_acceptance_guard on public.proposals;
drop function if exists public.guard_proposal_acceptance();

drop table if exists public.proposal_change_requests;
drop function if exists public.guard_proposal_change_request();
delete from public.audit_events where table_name = 'proposal_change_requests';

drop table if exists public.reply_classifications;
drop function if exists public.guard_reply_classification();
