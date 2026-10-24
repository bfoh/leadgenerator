-- Rollback for migration 011. Destructive: provider staging, discovery runs and their audit events
-- are deleted. Canonical businesses and research campaigns stay; the extra columns are removed.
-- Run only when no discovery run is in progress.

drop table if exists public.discovery_events cascade;
drop table if exists public.discovery_runs cascade;
drop table if exists public.provider_discovery_records cascade;

drop function if exists public.purge_expired_discovery_records(uuid);
drop function if exists public.guard_discovery_event_append_only();
drop function if exists public.guard_discovery_record_review();

-- Restore the pre-011 source-kind vocabulary.
alter table public.businesses drop constraint if exists businesses_source_kind_check;
alter table public.businesses add constraint businesses_source_kind_check check (source_kind in
  ('manual', 'directory', 'search', 'direct_submission', 'referral', 'places_reference', 'legacy_seed'));

drop index if exists public.businesses_provider_record_uidx;
alter table public.businesses drop constraint if exists businesses_provider_lengths;
alter table public.businesses drop constraint if exists businesses_provider_pair;
alter table public.businesses drop column if exists provider_record_id;
alter table public.businesses drop column if exists provider_key;

drop index if exists public.research_campaigns_discovery_idx;
alter table public.research_campaigns drop constraint if exists research_campaigns_discovery_provider;
alter table public.research_campaigns drop constraint if exists research_campaigns_discovery_limits;
alter table public.research_campaigns drop column if exists discovered_total;
alter table public.research_campaigns drop column if exists discovery_exhausted;
alter table public.research_campaigns drop column if exists discovery_cursor;
alter table public.research_campaigns drop column if exists discovery_require_review;
alter table public.research_campaigns drop column if exists discovery_quality_threshold;
alter table public.research_campaigns drop column if exists discovery_spend_cap_usd;
alter table public.research_campaigns drop column if exists discovery_total_limit;
alter table public.research_campaigns drop column if exists discovery_daily_limit;
alter table public.research_campaigns drop column if exists discovery_enabled;
