-- Digital Opportunity Finder — autonomous discovery foundation (milestone 3B).
--
-- Adds a provider-agnostic staging area, discovery runs and an append-only audit trail, plus the
-- campaign controls that govern scheduled discovery. Nothing here activates a real provider:
-- * `provider_discovery_records` holds normalised provider rows in quarantine until a person (or an
--   explicitly configured high-confidence rule) promotes one into `businesses`.
-- * `discovery_runs` records each provider page, its cost and outcome.
-- * `discovery_events` is append-only.
-- * `research_campaigns` gains opt-in controls, disabled by default. Google Places is still refused
--   as a campaign provider by a database check.
--
-- Additive and re-runnable. Rollback: supabase/rollback/011_autonomous_discovery_down.sql.

do $$
begin
  if to_regclass('public.research_campaigns') is null or to_regclass('public.businesses') is null then
    raise exception 'Migration 011 needs migrations 002 and 009; apply them first.';
  end if;
end $$;

-- ─── Campaign discovery controls ─────────────────────────────────────────────────────────────────

alter table public.research_campaigns add column if not exists discovery_enabled boolean not null default false;
alter table public.research_campaigns add column if not exists discovery_daily_limit smallint not null default 25;
alter table public.research_campaigns add column if not exists discovery_total_limit integer not null default 100;
alter table public.research_campaigns add column if not exists discovery_spend_cap_usd numeric(10, 4);
alter table public.research_campaigns add column if not exists discovery_quality_threshold smallint not null default 60;
alter table public.research_campaigns add column if not exists discovery_require_review boolean not null default true;
alter table public.research_campaigns add column if not exists discovery_cursor text;
alter table public.research_campaigns add column if not exists discovery_exhausted boolean not null default false;
alter table public.research_campaigns add column if not exists discovered_total integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'research_campaigns_discovery_limits') then
    alter table public.research_campaigns add constraint research_campaigns_discovery_limits check (
      discovery_daily_limit between 1 and 500 and
      discovery_total_limit between 1 and 10000 and
      discovery_quality_threshold between 0 and 100 and
      discovered_total >= 0 and
      (discovery_spend_cap_usd is null or discovery_spend_cap_usd >= 0) and
      (discovery_cursor is null or char_length(discovery_cursor) <= 200)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'research_campaigns_discovery_provider') then
    -- An autonomous campaign needs a discovery connector, never the interactive Places source or
    -- the tracked-records pseudo-provider.
    alter table public.research_campaigns add constraint research_campaigns_discovery_provider check (
      discovery_enabled = false or provider_key not in ('google_places', 'tracked_records')
    );
  end if;
end $$;

create index if not exists research_campaigns_discovery_idx on public.research_campaigns(organization_id, discovery_enabled)
  where discovery_enabled = true;

-- ─── Quarantined provider records ─────────────────────────────────────────────────────────────────
-- Provider-specific data stays here. Only a promoted record creates a canonical business, and only
-- after the source declaration permits CRM storage.

create table if not exists public.provider_discovery_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid,
  provider_key text not null check (char_length(provider_key) between 1 and 60),
  provider_record_id text not null check (char_length(btrim(provider_record_id)) between 1 and 300),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text check (category is null or char_length(category) between 1 and 80),
  address text check (address is null or char_length(address) <= 300),
  region text check (region is null or char_length(region) <= 80),
  district_code text,
  town text check (town is null or char_length(town) <= 80),
  website text check (website is null or (website ~* '^https?://' and char_length(website) <= 2000)),
  -- Contact fields are only written when the source declaration permits contact storage. They are
  -- never turned into contact points automatically.
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  operating_status text not null default 'unknown' check (operating_status in ('open', 'temporarily_closed', 'permanently_closed', 'unknown')),
  provider_confidence numeric(4, 3) check (provider_confidence is null or (provider_confidence >= 0 and provider_confidence <= 1)),
  quality_score smallint not null default 0 check (quality_score between 0 and 100),
  identity_confidence smallint not null default 0 check (identity_confidence between 0 and 100),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 400),
  status text not null default 'pending_review' check (status in ('pending_review', 'promoted', 'rejected')),
  review_reasons text[] not null default '{}' check (cardinality(review_reasons) <= 20),
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  business_id uuid,
  source_url text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 2000)),
  -- The licence text that applied when the row was fetched, so a later change is visible.
  licence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(licence_snapshot) = 'object'),
  retrieved_at timestamptz not null default now(),
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, provider_key, provider_record_id),
  foreign key (campaign_id, organization_id) references public.research_campaigns(id, organization_id) on delete cascade,
  -- Deleting the canonical business deletes its quarantined provider copy; the append-only event
  -- keeps the provenance. `set null` would leave a promoted row without a business and violate the
  -- check below.
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  constraint provider_discovery_retention_known check (retention_until > retrieved_at),
  constraint provider_discovery_promoted_business check (status <> 'promoted' or business_id is not null)
);
create index if not exists provider_discovery_org_status_idx on public.provider_discovery_records(organization_id, status, retrieved_at);
create index if not exists provider_discovery_campaign_idx on public.provider_discovery_records(campaign_id, status);
create index if not exists provider_discovery_dedupe_idx on public.provider_discovery_records(organization_id, dedupe_key);

-- A review moves a row once and only once. Provider fields are immutable after staging.
create or replace function public.guard_discovery_record_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.provider_key is distinct from old.provider_key
     or new.provider_record_id is distinct from old.provider_record_id
     or new.organization_id is distinct from old.organization_id
     or new.campaign_id is distinct from old.campaign_id
     or new.name is distinct from old.name
     or new.category is distinct from old.category
     or new.address is distinct from old.address
     or new.region is distinct from old.region
     or new.district_code is distinct from old.district_code
     or new.town is distinct from old.town
     or new.website is distinct from old.website
     or new.phone is distinct from old.phone
     or new.email is distinct from old.email
     or new.operating_status is distinct from old.operating_status
     or new.provider_confidence is distinct from old.provider_confidence
     or new.quality_score is distinct from old.quality_score
     or new.identity_confidence is distinct from old.identity_confidence
     or new.dedupe_key is distinct from old.dedupe_key
     or new.licence_snapshot is distinct from old.licence_snapshot
     or new.retrieved_at is distinct from old.retrieved_at
     or new.retention_until is distinct from old.retention_until then
    raise exception 'Provider fields are immutable after staging.' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'pending_review' and new.status in ('promoted', 'rejected')) then
      raise exception 'A discovery record cannot move from % to %.', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'promoted' and new.business_id is null then
      raise exception 'A promoted discovery record must link a business.' using errcode = '23514';
    end if;
    if new.decided_at is null then
      new.decided_at := now();
    end if;
    if new.decided_by is null then
      new.decided_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists provider_discovery_review_guard on public.provider_discovery_records;
create trigger provider_discovery_review_guard before update on public.provider_discovery_records
  for each row execute function public.guard_discovery_record_review();
drop trigger if exists provider_discovery_touch on public.provider_discovery_records;
create trigger provider_discovery_touch before update on public.provider_discovery_records
  for each row execute function public.touch_updated_at();

-- ─── Discovery runs and append-only audit ────────────────────────────────────────────────────────

create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid,
  provider_key text not null check (char_length(provider_key) between 1 and 60),
  status text not null default 'running' check (status in ('running', 'succeeded', 'skipped', 'failed')),
  query jsonb not null default '{}'::jsonb check (jsonb_typeof(query) = 'object'),
  pages integer not null default 0 check (pages >= 0),
  records_fetched integer not null default 0 check (records_fetched >= 0),
  records_staged integer not null default 0 check (records_staged >= 0),
  duplicates_skipped integer not null default 0 check (duplicates_skipped >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  records_promoted integer not null default 0 check (records_promoted >= 0),
  spend_usd numeric(10, 4) not null default 0 check (spend_usd >= 0),
  error_kind text check (error_kind is null or char_length(error_kind) <= 80),
  note text check (note is null or char_length(note) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (campaign_id, organization_id) references public.research_campaigns(id, organization_id) on delete cascade
);
create index if not exists discovery_runs_campaign_idx on public.discovery_runs(campaign_id, started_at desc);
create index if not exists discovery_runs_org_idx on public.discovery_runs(organization_id, started_at desc);

create table if not exists public.discovery_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid,
  run_id uuid,
  record_id uuid,
  event text not null check (event in (
    'started', 'page_fetched', 'record_staged', 'duplicate_skipped', 'record_rejected',
    'record_promoted', 'quota_reached', 'provider_refused', 'failed', 'completed'
  )),
  detail text check (detail is null or char_length(detail) <= 1000),
  actor_type text not null default 'system' check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  -- Deliberately no foreign keys to the campaign, run or record: this is an append-only history and
  -- must survive the deletion of what it describes (retention purge, campaign deletion). The
  -- organization key keeps tenancy enforceable.
  foreign key (organization_id) references public.organizations(id) on delete cascade
);
create index if not exists discovery_events_campaign_idx on public.discovery_events(campaign_id, created_at desc);
create index if not exists discovery_events_run_idx on public.discovery_events(run_id, created_at);

-- Audit rows cannot be edited or deleted, by anyone. Deleting a campaign or record leaves the event
-- with its identifiers nulled where the foreign key says so.
create or replace function public.guard_discovery_event_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Discovery events are append-only.' using errcode = '42501';
end $$;

drop trigger if exists discovery_events_append_only on public.discovery_events;
create trigger discovery_events_append_only before update or delete on public.discovery_events
  for each row execute function public.guard_discovery_event_append_only();

-- ─── Canonical provenance ────────────────────────────────────────────────────────────────────────
-- A promoted record keeps its source and provider ID, so a duplicate can be recognised later. The
-- raw staging row remains the isolated copy; these columns are the minimum provenance the CRM needs.

alter table public.businesses add column if not exists provider_key text;
alter table public.businesses add column if not exists provider_record_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_provider_pair') then
    alter table public.businesses add constraint businesses_provider_pair check (
      (provider_key is null and provider_record_id is null) or
      (provider_key is not null and provider_record_id is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_provider_lengths') then
    alter table public.businesses add constraint businesses_provider_lengths check (
      (provider_key is null or char_length(provider_key) between 1 and 60) and
      (provider_record_id is null or char_length(provider_record_id) between 1 and 300)
    );
  end if;
end $$;

create unique index if not exists businesses_provider_record_uidx
  on public.businesses(organization_id, provider_key, provider_record_id)
  where provider_key is not null and provider_record_id is not null;

-- `provider_discovery` records that the identity came from a permitted provider; the source URL and
-- provider columns carry the provenance. Existing values are unchanged.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'businesses_source_kind_check') then
    alter table public.businesses drop constraint businesses_source_kind_check;
  end if;
  alter table public.businesses add constraint businesses_source_kind_check check (source_kind in
    ('manual', 'directory', 'search', 'direct_submission', 'referral', 'places_reference', 'legacy_seed', 'provider_discovery'));
end $$;

-- Retention enforcement. The worker calls this before a discovery tick; deleting expired staging
-- rows keeps the audit event (record_id becomes null) but removes the provider payload.
create or replace function public.purge_expired_discovery_records(p_org uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  removed integer;
begin
  delete from public.provider_discovery_records
  where retention_until < now()
    and (p_org is null or organization_id = p_org);
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.purge_expired_discovery_records(uuid) from public, anon, authenticated;
grant execute on function public.purge_expired_discovery_records(uuid) to service_role;

-- ─── Row Level Security and grants ───────────────────────────────────────────────────────────────

alter table public.provider_discovery_records enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovery_events enable row level security;

drop policy if exists provider_discovery_records_select on public.provider_discovery_records;
create policy provider_discovery_records_select on public.provider_discovery_records for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists provider_discovery_records_update on public.provider_discovery_records;
create policy provider_discovery_records_update on public.provider_discovery_records for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists discovery_runs_select on public.discovery_runs;
create policy discovery_runs_select on public.discovery_runs for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists discovery_events_select on public.discovery_events;
create policy discovery_events_select on public.discovery_events for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

revoke all on public.provider_discovery_records, public.discovery_runs, public.discovery_events from anon, authenticated;
grant select, update on public.provider_discovery_records to authenticated;
grant select on public.discovery_runs, public.discovery_events to authenticated;
grant select, insert, update, delete on public.provider_discovery_records, public.discovery_runs, public.discovery_events to service_role;
grant usage on sequence public.discovery_events_id_seq to service_role;




