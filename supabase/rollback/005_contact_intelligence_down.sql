-- Rollback for 005_contact_intelligence.sql. Run only after a backup, and only if phase 4 contact
-- intelligence must be removed: contact points, consent records and the suppression list are
-- deleted.
--
-- Deleting the suppression list removes the record of who asked not to be contacted. Before running
-- this, keep a copy (in the SQL editor: select * from public.suppressions, then download the result)
-- and make sure every opted-out business is still recorded as "Opted out" on its profile; the
-- per-business opt-out in contact_permission is not touched and keeps blocking outreach. The phone and email fields on businesses are not touched.
-- Every pre-005 table and column is left as it was. Independent of migrations 003 and 004.
-- Migration 006 (messaging) builds on these tables: roll it back first (006_messaging_down.sql).

do $$
begin
  if to_regclass('public.outreach_messages') is not null then
    raise exception 'Migration 006 (messaging) is installed and depends on these tables. Run supabase/rollback/006_messaging_down.sql first.';
  end if;
end $$;

drop trigger if exists businesses_opt_out_suppression on public.businesses;

drop table if exists public.suppressions;
drop table if exists public.consent_records;
drop table if exists public.contact_points;

drop function if exists public.suppress_on_business_opt_out();
drop function if exists public.suppress_on_withdrawal();
drop function if exists public.guard_suppression();
drop function if exists public.guard_consent_record();
drop function if exists public.guard_contact_point();

delete from public.audit_events where table_name in ('contact_points', 'consent_records', 'suppressions');
