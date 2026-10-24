-- Digital Opportunity Finder — research campaigns (milestone 2).
--
-- Research-only campaigns run the existing research agents over prospects the workspace already
-- tracks: identity, website verification, contact research, digital audit, opportunity scoring and
-- the evidence-based report. A campaign never searches Google Places and never contacts anyone.
-- Google Places stays user-initiated (interactive discovery only); the database refuses it as a
-- campaign provider.
--
-- * research_campaigns      one saved scope, schedule, quota and budget.
-- * campaign_targets        many-to-many membership of prospects in campaigns, with per-campaign
--                           state and the job doing the work. A prospect may belong to several
--                           campaigns; membership is never overwritten.
-- * campaign_target_events  append-only history of every membership change (written by trigger).
-- * campaign_runs           what each background tick did (enqueued, completed, spend, note).
-- * automation_jobs         gains campaign_id and campaign_target_id, so every step of a campaign's
--                           agent chain, including follow-ups, is attributable to the campaign.
--
-- Additive and re-runnable. Rollback: supabase/rollback/009_research_campaigns_down.sql.

do $$
begin
  if to_regclass('public.automation_jobs') is null or to_regclass('public.businesses') is null then
    raise exception 'Migration 009 needs migrations 002 and 003; apply them first.';
  end if;
end $$;

-- ─── Campaigns ───────────────────────────────────────────────────────────────────────────────────

create table if not exists public.research_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  -- Only a provider whose declaration allows unattended discovery and CRM processing may be used.
  provider_key text not null default 'tracked_records' check (char_length(provider_key) between 1 and 60),
  regions text[] not null default '{}' check (cardinality(regions) <= 16),
  district_codes text[] not null default '{}' check (cardinality(district_codes) <= 261),
  towns text[] not null default '{}' check (cardinality(towns) <= 50),
  categories text[] not null default '{}' check (cardinality(categories) <= 50),
  batch_size smallint not null default 10 check (batch_size between 1 and 50),
  daily_target_limit smallint not null default 50 check (daily_target_limit between 1 and 500),
  monthly_budget_usd numeric(10, 4) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  schedule_frequency text not null default 'manual' check (schedule_frequency in ('manual', 'daily', 'weekly', 'monthly')),
  schedule_hour smallint not null default 6 check (schedule_hour between 0 and 23),
  schedule_weekday smallint check (schedule_weekday between 0 and 6),
  schedule_day smallint check (schedule_day between 1 and 28),
  timezone text not null default 'Africa/Accra' check (timezone = 'Africa/Accra'),
  next_run_at timestamptz,
  -- A finite campaign may close itself once every matching prospect has been researched.
  auto_complete boolean not null default true,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('succeeded', 'failed', 'skipped')),
  last_run_note text check (char_length(last_run_note) <= 1000),
  paused_reason text check (char_length(paused_reason) <= 500),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Empty region/district/town lists mean the whole of Ghana. Google Places may never be used to
  -- harvest in bulk, on a schedule, or without a person starting each search.
  constraint research_campaigns_unattended_provider check (provider_key <> 'google_places'),
  constraint research_campaigns_schedule check (
    schedule_frequency = 'manual'
    or schedule_frequency = 'daily'
    or (schedule_frequency = 'weekly' and schedule_weekday is not null)
    or (schedule_frequency = 'monthly' and schedule_day is not null)
  ),
  unique (id, organization_id)
);
-- Added after the first release of this migration so a database that applied an earlier draft gains it too.
alter table public.research_campaigns add column if not exists auto_complete boolean not null default true;
create index if not exists research_campaigns_org_status_idx on public.research_campaigns(organization_id, status);
create index if not exists research_campaigns_due_idx on public.research_campaigns(next_run_at) where status = 'active';

-- A campaign's status only moves forward along the documented paths. Terminal states stay terminal.
create or replace function public.guard_campaign_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('active', 'cancelled')) or
      (old.status = 'active' and new.status in ('paused', 'completed', 'cancelled')) or
      (old.status = 'paused' and new.status in ('active', 'completed', 'cancelled'))
    ) then
      raise exception 'A campaign cannot move from % to %.', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'active' then
      new.paused_reason := null;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.schedule_frequency = 'manual' and new.next_run_at is not null then
    new.next_run_at := null;
  end if;
  return new;
end $$;

drop trigger if exists research_campaigns_status_guard on public.research_campaigns;
create trigger research_campaigns_status_guard before update on public.research_campaigns
  for each row execute function public.guard_campaign_status();
drop trigger if exists research_campaigns_touch on public.research_campaigns;
create trigger research_campaigns_touch before update on public.research_campaigns
  for each row execute function public.touch_updated_at();

-- ─── Campaign membership ─────────────────────────────────────────────────────────────────────────

create table if not exists public.campaign_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  business_id uuid not null,
  -- queued → researching → researched → qualified; a failure or an exclusion is recorded, never hidden.
  state text not null default 'queued' check (state in ('queued', 'researching', 'researched', 'qualified', 'skipped', 'failed')),
  /** Why the prospect matched the campaign's scope when it was added (region, district, category…). */
  match_reason text check (char_length(match_reason) <= 300),
  source text not null default 'tracked' check (source in ('tracked', 'provider', 'manual')),
  /** The first job of this prospect's campaign chain; follow-ups carry the same campaign_target_id.
   *  Deliberately not a foreign key: rolling migration 003 back must not depend on campaign tables. */
  job_id uuid,
  note text check (char_length(note) <= 1000),
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, business_id),
  unique (id, organization_id),
  foreign key (campaign_id, organization_id) references public.research_campaigns(id, organization_id) on delete cascade,
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists campaign_targets_campaign_state_idx on public.campaign_targets(campaign_id, state);
create index if not exists campaign_targets_business_idx on public.campaign_targets(business_id, state);
create index if not exists campaign_targets_org_idx on public.campaign_targets(organization_id, updated_at desc);

-- Per-campaign state machine. A target may be requeued after a failure, and researched may qualify.
create or replace function public.guard_campaign_target_state() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    if not (
      (old.state = 'queued' and new.state in ('researching', 'skipped', 'failed')) or
      (old.state = 'researching' and new.state in ('researched', 'qualified', 'failed', 'skipped', 'queued')) or
      (old.state = 'failed' and new.state in ('queued', 'skipped')) or
      (old.state = 'researched' and new.state in ('qualified', 'skipped'))
    ) then
      raise exception 'A campaign target cannot move from % to %.', old.state, new.state using errcode = '23514';
    end if;
    if new.state in ('researched', 'qualified', 'skipped') and new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.state = 'researching' and new.started_at is null then
      new.started_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists campaign_targets_state_guard on public.campaign_targets;
create trigger campaign_targets_state_guard before update on public.campaign_targets
  for each row execute function public.guard_campaign_target_state();
drop trigger if exists campaign_targets_touch on public.campaign_targets;
create trigger campaign_targets_touch before update on public.campaign_targets
  for each row execute function public.touch_updated_at();

-- Membership history. Append-only: written by trigger, never edited or deleted.
create table if not exists public.campaign_target_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  target_id uuid not null,
  business_id uuid not null,
  event text not null check (event in ('added', 'queued', 'researching', 'researched', 'qualified', 'skipped', 'failed')),
  detail text check (char_length(detail) <= 1000),
  actor_type text not null default 'system' check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.research_campaigns(id, organization_id) on delete cascade,
  foreign key (target_id, organization_id) references public.campaign_targets(id, organization_id) on delete cascade,
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists campaign_target_events_campaign_idx on public.campaign_target_events(campaign_id, created_at desc);
create index if not exists campaign_target_events_target_idx on public.campaign_target_events(target_id, created_at);

create or replace function public.log_campaign_target_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.campaign_target_events
      (organization_id, campaign_id, target_id, business_id, event, detail, actor_type, actor_id)
    values
      (new.organization_id, new.campaign_id, new.id, new.business_id, 'added', new.match_reason,
       case when actor is null then 'system' else 'user' end, actor);
  elsif new.state is distinct from old.state then
    insert into public.campaign_target_events
      (organization_id, campaign_id, target_id, business_id, event, detail, actor_type, actor_id)
    values
      (new.organization_id, new.campaign_id, new.id, new.business_id, new.state,
       coalesce(new.note, case when actor is null then 'Recorded by the campaign worker' else 'Recorded by a team member' end),
       case when actor is null then 'system' else 'user' end, actor);
  end if;
  return new;
end $$;

drop trigger if exists campaign_targets_event_log on public.campaign_targets;
create trigger campaign_targets_event_log after insert or update of state on public.campaign_targets
  for each row execute function public.log_campaign_target_event();

-- ─── Campaign runs (what each background tick did) ───────────────────────────────────────────────

create table if not exists public.campaign_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  targets_enqueued integer not null default 0 check (targets_enqueued >= 0),
  targets_completed integer not null default 0 check (targets_completed >= 0),
  jobs_open integer not null default 0 check (jobs_open >= 0),
  spend_usd numeric(10, 4) not null default 0 check (spend_usd >= 0),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.research_campaigns(id, organization_id) on delete cascade
);
create index if not exists campaign_runs_campaign_idx on public.campaign_runs(campaign_id, started_at desc);

-- ─── Jobs belong to campaigns ────────────────────────────────────────────────────────────────────

alter table public.automation_jobs add column if not exists campaign_id uuid;
alter table public.automation_jobs add column if not exists campaign_target_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_jobs_campaign_fk') then
    alter table public.automation_jobs add constraint automation_jobs_campaign_fk
      foreign key (campaign_id, organization_id) references public.research_campaigns(id, organization_id)
      on delete set null (campaign_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_jobs_campaign_target_fk') then
    alter table public.automation_jobs add constraint automation_jobs_campaign_target_fk
      foreign key (campaign_target_id, organization_id) references public.campaign_targets(id, organization_id)
      on delete set null (campaign_target_id);
  end if;
end $$;
create index if not exists automation_jobs_campaign_idx on public.automation_jobs(campaign_id, created_at desc) where campaign_id is not null;

-- ─── Enqueue with campaign attribution ───────────────────────────────────────────────────────────
-- A separate function keeps the 003 queue untouched (and re-runnable). Follow-up jobs inherit the
-- two campaign keys from their parent.

create or replace function public.enqueue_campaign_job(
  p_org uuid,
  p_agent text,
  p_business uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_priority integer default 100,
  p_run_after timestamptz default null,
  p_parent uuid default null,
  p_requires_approval boolean default false,
  p_estimated_cost numeric default 0,
  p_max_attempts integer default 3,
  p_campaign uuid default null,
  p_campaign_target uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.automation_settings;
  j public.automation_jobs;
  parent_trace uuid;
begin
  if not public.can_automate(p_org) then
    raise exception 'Your role does not allow automation.' using errcode = '42501';
  end if;
  select * into s from public.automation_settings where organization_id = p_org;
  if p_agent = 'outreach_execution' and (s.outbound_stopped is distinct from false or not public.outbound_available()) then
    raise exception 'Outbound sending is stopped for this workspace.' using errcode = 'check_violation';
  end if;
  if p_business is not null and not exists (select 1 from public.businesses b where b.id = p_business and b.organization_id = p_org) then
    raise exception 'That prospect does not exist in this workspace.' using errcode = 'foreign_key_violation';
  end if;
  if p_campaign is not null and not exists (
    select 1 from public.research_campaigns c where c.id = p_campaign and c.organization_id = p_org
  ) then
    raise exception 'That campaign does not exist in this workspace.' using errcode = 'foreign_key_violation';
  end if;
  if p_campaign_target is not null and not exists (
    select 1 from public.campaign_targets t
    where t.id = p_campaign_target and t.organization_id = p_org
      and (p_campaign is null or t.campaign_id = p_campaign)
      and (p_business is null or t.business_id = p_business)
  ) then
    raise exception 'That campaign target does not belong to this campaign and prospect.' using errcode = 'foreign_key_violation';
  end if;
  if p_parent is not null then
    select pj.trace_id into parent_trace from public.automation_jobs pj where pj.id = p_parent and pj.organization_id = p_org;
    if parent_trace is null then
      raise exception 'Parent job not found in this workspace.' using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.automation_jobs (organization_id, agent, status, priority, business_id, payload, idempotency_key, run_after,
    parent_job_id, trace_id, estimated_cost_usd, max_attempts, created_by, campaign_id, campaign_target_id)
  values (p_org, p_agent, case when p_requires_approval then 'awaiting_approval' else 'pending' end,
    coalesce(p_priority, 100), p_business, coalesce(p_payload, '{}'::jsonb), p_idempotency_key, coalesce(p_run_after, now()),
    p_parent, coalesce(parent_trace, gen_random_uuid()), greatest(coalesce(p_estimated_cost, 0), 0), coalesce(p_max_attempts, 3),
    auth.uid(), p_campaign, p_campaign_target)
  on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into j;

  if j.id is not null then
    return jsonb_build_object('created', true, 'job', to_jsonb(j));
  end if;
  select * into j from public.automation_jobs x where x.organization_id = p_org and x.idempotency_key = p_idempotency_key;
  return jsonb_build_object('created', false, 'job', to_jsonb(j));
end $$;

-- Spend attributed to one campaign: actual cost recorded by agent runs, plus the estimated cost of
-- jobs still open. Runs with the caller's rights, so RLS scopes it to the workspace as usual.
create or replace function public.campaign_spend(p_campaign uuid)
returns numeric
language sql stable set search_path = '' as $$
  select coalesce((
    select sum(ar.estimated_cost_usd) from public.agent_runs ar
    join public.automation_jobs j on j.id = ar.job_id
    where j.campaign_id = p_campaign
  ), 0) + coalesce((
    select sum(j.estimated_cost_usd) from public.automation_jobs j
    where j.campaign_id = p_campaign and j.status in ('pending', 'running', 'awaiting_approval')
  ), 0);
$$;

-- ─── Row Level Security and grants ───────────────────────────────────────────────────────────────

alter table public.research_campaigns enable row level security;
alter table public.campaign_targets enable row level security;
alter table public.campaign_target_events enable row level security;
alter table public.campaign_runs enable row level security;

drop policy if exists research_campaigns_select on public.research_campaigns;
create policy research_campaigns_select on public.research_campaigns for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists research_campaigns_insert on public.research_campaigns;
create policy research_campaigns_insert on public.research_campaigns for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']));
drop policy if exists research_campaigns_update on public.research_campaigns;
create policy research_campaigns_update on public.research_campaigns for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));
drop policy if exists research_campaigns_delete on public.research_campaigns;
create policy research_campaigns_delete on public.research_campaigns for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']) and status in ('draft', 'cancelled'));

drop policy if exists campaign_targets_select on public.campaign_targets;
create policy campaign_targets_select on public.campaign_targets for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists campaign_targets_insert on public.campaign_targets;
create policy campaign_targets_insert on public.campaign_targets for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists campaign_targets_update on public.campaign_targets;
create policy campaign_targets_update on public.campaign_targets for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

-- The history and the run log are written by triggers and the worker; members read them.
drop policy if exists campaign_target_events_select on public.campaign_target_events;
create policy campaign_target_events_select on public.campaign_target_events for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists campaign_runs_select on public.campaign_runs;
create policy campaign_runs_select on public.campaign_runs for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists campaign_runs_insert on public.campaign_runs;
create policy campaign_runs_insert on public.campaign_runs for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists campaign_runs_update on public.campaign_runs;
create policy campaign_runs_update on public.campaign_runs for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

revoke all on public.research_campaigns, public.campaign_targets, public.campaign_target_events, public.campaign_runs from anon, authenticated;
grant select, insert, update, delete on public.research_campaigns to authenticated;
grant select, insert, update on public.campaign_targets to authenticated;
grant select on public.campaign_target_events to authenticated;
grant select, insert, update on public.campaign_runs to authenticated;
grant select, insert, update, delete on public.research_campaigns, public.campaign_targets, public.campaign_runs to service_role;
grant select, insert on public.campaign_target_events to service_role;
revoke update, delete, truncate on public.campaign_target_events from authenticated, service_role;

revoke execute on function public.enqueue_campaign_job(uuid, text, uuid, jsonb, text, integer, timestamptz, uuid, boolean, numeric, integer, uuid, uuid) from public, anon;
grant execute on function public.enqueue_campaign_job(uuid, text, uuid, jsonb, text, integer, timestamptz, uuid, boolean, numeric, integer, uuid, uuid) to authenticated, service_role;
revoke execute on function public.campaign_spend(uuid) from public, anon;
grant execute on function public.campaign_spend(uuid) to authenticated, service_role;




