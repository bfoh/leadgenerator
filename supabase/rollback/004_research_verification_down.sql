-- Rollback for 004_research_verification.sql. Run only after a backup, and only if phase 3 research
-- must be removed: identity links (including merge records), digital audit findings, agent evidence on
-- website verifications, identity fields and score overrides are deleted.
--
-- Merged records are not un-merged automatically: before running this, undo any merge you want to
-- reverse (merged prospects stay archived afterwards, without the link to their primary). Agent
-- verification rows remain as ordinary verification records, without their evidence and review state.
-- Every pre-004 table and column is left as it was. Independent of migration 003.

drop trigger if exists website_verifications_guard on public.website_verifications;
drop trigger if exists businesses_research_guard on public.businesses;

drop function if exists public.merge_businesses(uuid, uuid, text[], text);
drop function if exists public.undo_business_merge(uuid);

drop table if exists public.audit_findings;
drop table if exists public.identity_links;

drop function if exists public.guard_verification_update();
drop function if exists public.guard_business_research_fields();
drop function if exists public.stamp_identity_decision();
drop function if exists public.guard_audit_finding_update();

drop index if exists public.website_verifications_review_idx;
alter table public.website_verifications
  drop constraint if exists website_verifications_actor_type_check,
  drop constraint if exists website_verifications_classification_check,
  drop constraint if exists website_verifications_confidence_score_check,
  drop constraint if exists website_verifications_evidence_check,
  drop constraint if exists website_verifications_agent_version_check,
  drop constraint if exists website_verifications_review_status_check,
  drop constraint if exists website_verifications_review_note_check,
  drop constraint if exists website_verifications_agent_record_check;
alter table public.website_verifications
  drop column if exists actor_type,
  drop column if exists classification,
  drop column if exists confidence_score,
  drop column if exists evidence,
  drop column if exists agent_version,
  drop column if exists job_id,
  drop column if exists review_status,
  drop column if exists reviewed_by,
  drop column if exists reviewed_at,
  drop column if exists review_note;

drop index if exists public.businesses_merged_into_idx;
drop index if exists public.businesses_parent_idx;
alter table public.businesses
  drop constraint if exists businesses_parent_fk,
  drop constraint if exists businesses_merged_into_fk,
  drop constraint if exists businesses_alternate_names_check,
  drop constraint if exists businesses_identity_links_check,
  drop constraint if exists businesses_merged_archived_check,
  drop constraint if exists businesses_identity_confidence_check,
  drop constraint if exists businesses_score_override_check;
alter table public.businesses
  drop column if exists alternate_names,
  drop column if exists parent_business_id,
  drop column if exists merged_into_id,
  drop column if exists identity_confidence,
  drop column if exists identity_checked_at,
  drop column if exists score_override;
