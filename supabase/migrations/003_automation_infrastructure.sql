-- Digital Opportunity Finder — automation infrastructure (autonomous platform, phase 2).
--
-- * Durable job queue (automation_jobs) driven only through SECURITY DEFINER functions: enqueue with
--   idempotency keys, claim with FOR UPDATE SKIP LOCKED and leases, finish with retry/dead-letter
--   rules, cancel, retry and approve.
-- * Per-organization automation policy (automation_settings): mode, pause, outbound emergency stop,
--   disabled agents, concurrency and budgets. New workspaces start in research-only mode with the
--   outbound stop engaged; this migration does not allow the stop to be lifted (no sending exists).
-- * Agent run log (agent_runs) and an append-only workflow transition log written by triggers.
-- * businesses gains a workflow_state that the database keeps consistent with opt-outs and CRM stages.
-- * Additive and re-runnable. Existing rows are backfilled once, without touching updated_at.
--   See docs/AUTONOMOUS_PLATFORM_ARCHITECTURE.md and docs/AGENT_WORKFLOWS.md.

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────

-- True for requests made with the service-role key (the scheduled background worker).
create or replace function public.is_service_role() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'role', '') = 'service_role';
$$;

-- Roles that may queue and run research automation (mirrors the research write roles).
create or replace function public.can_automate(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_service_role() or public.has_org_role(org, array['owner', 'admin', 'researcher', 'sales']);
$$;

-- Outbound messaging does not exist in this version. A later migration replaces this function once
-- the consent gateway, channel adapters and the compliance checklist are in place.
create or replace function public.outbound_available() returns boolean
language sql stable set search_path = '' as $$
  select false;
$$;

-- ─── Workflow state on businesses ────────────────────────────────────────────────────────────────

-- Mirrors deriveWorkflowState() in src/lib/automation/workflow.ts.
create or replace function public.derive_workflow_state(p_stage text, p_website_status text, p_permission text, p_interest text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_permission = 'opted_out' then 'opted_out'
    when p_stage = 'won' then 'client_won'
    when p_stage = 'lost' then case when p_interest = 'none' then 'not_interested' else 'disqualified' end
    when p_stage = 'archived' then 'archived'
    when p_stage = 'negotiation' then 'negotiation'
    when p_stage = 'discovery_meeting' then 'meeting'
    when p_stage = 'proposal_sent' then 'response_monitoring'
    when p_stage = 'contact_authorized' then 'ready_for_outreach'
    when p_stage = 'introduction_requested' then 'outreach_eligibility_check'
    when p_stage = 'proposal_draft' then 'proposal_draft'
    when p_stage = 'qualified' then 'qualification'
    when p_stage = 'verification_pending' then 'website_verification'
    when p_website_status = 'unverified' then 'discovered'
    else 'contact_research'
  end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'businesses' and column_name = 'workflow_state'
  ) then
    alter table public.businesses add column workflow_state text not null default 'discovered';
    alter table public.businesses add column workflow_state_at timestamptz not null default now();
    alter table public.businesses add column workflow_state_reason text;
    alter table public.businesses add column workflow_state_actor text not null default 'system';

    -- One-time backfill from the CRM stage. Triggers are paused so updated_at and the audit log
    -- are not rewritten for every existing record.
    alter table public.businesses disable trigger businesses_touch;
    alter table public.businesses disable trigger businesses_audit;
    update public.businesses b set
      workflow_state = public.derive_workflow_state(b.stage, b.website_status, b.contact_permission, b.interest_level),
      workflow_state_at = b.updated_at,
      workflow_state_reason = 'Derived from the CRM stage when automation was installed';
    alter table public.businesses enable trigger businesses_touch;
    alter table public.businesses enable trigger businesses_audit;
  end if;
end $$;

alter table public.businesses drop constraint if exists businesses_workflow_state_check;
alter table public.businesses add constraint businesses_workflow_state_check check (workflow_state in (
  'discovered', 'identity_research', 'website_verification', 'contact_research', 'qualification', 'opportunity_report',
  'proposal_draft', 'outreach_eligibility_check', 'human_approval', 'ready_for_outreach', 'contacted', 'response_monitoring',
  'interested', 'meeting', 'negotiation', 'client_won', 'research_incomplete', 'needs_human_review', 'unreachable',
  'not_interested', 'opted_out', 'disqualified', 'archived', 'failed', 'retry_pending'));
alter table public.businesses drop constraint if exists businesses_workflow_actor_check;
alter table public.businesses add constraint businesses_workflow_actor_check check (workflow_state_actor in ('user', 'agent', 'system'));
alter table public.businesses drop constraint if exists businesses_workflow_reason_check;
alter table public.businesses add constraint businesses_workflow_reason_check check (char_length(workflow_state_reason) <= 500);
-- An opt-out always wins: while permission is opted out, the workflow cannot be anywhere else.
alter table public.businesses drop constraint if exists businesses_opt_out_workflow;
alter table public.businesses add constraint businesses_opt_out_workflow
  check (contact_permission <> 'opted_out' or workflow_state in ('opted_out', 'archived'));
create index if not exists businesses_org_workflow_idx on public.businesses(organization_id, workflow_state);

-- Mirrors workflowAfterChange() in src/lib/automation/workflow.ts.
create or replace function public.sync_workflow_state() returns trigger
language plpgsql set search_path = '' as $$
declare
  mapped text;
begin
  if tg_op = 'INSERT' then
    if new.workflow_state = 'discovered' then
      new.workflow_state := public.derive_workflow_state(new.stage, new.website_status, new.contact_permission, new.interest_level);
    end if;
    if new.contact_permission = 'opted_out' and new.workflow_state not in ('opted_out', 'archived') then
      new.workflow_state := 'opted_out';
    end if;
    new.workflow_state_at := now();
    new.workflow_state_reason := coalesce(new.workflow_state_reason, 'Record created');
    return new;
  end if;

  if new.contact_permission = 'opted_out' and new.workflow_state not in ('opted_out', 'archived') then
    new.workflow_state := 'opted_out';
    new.workflow_state_reason := 'Opt-out recorded: contact and automation stopped';
    new.workflow_state_actor := 'system';
  elsif new.stage is distinct from old.stage and new.workflow_state is not distinct from old.workflow_state then
    mapped := case new.stage
      when 'won' then 'client_won'
      when 'lost' then case when new.interest_level = 'none' then 'not_interested' else 'disqualified' end
      when 'archived' then 'archived'
      when 'discovery_meeting' then 'meeting'
      when 'negotiation' then 'negotiation'
    end;
    if mapped is not null and mapped <> old.workflow_state and old.workflow_state <> 'opted_out' then
      new.workflow_state := mapped;
      new.workflow_state_reason := 'CRM stage changed to ' || replace(new.stage, '_', ' ');
      new.workflow_state_actor := case when auth.uid() is null then 'system' else 'user' end;
    end if;
  end if;

  if new.workflow_state is distinct from old.workflow_state then
    new.workflow_state_at := now();
  else
    -- The reason, actor and time describe the current state; they only change with it.
    new.workflow_state_reason := old.workflow_state_reason;
    new.workflow_state_actor := old.workflow_state_actor;
    new.workflow_state_at := old.workflow_state_at;
  end if;
  return new;
end $$;

drop trigger if exists businesses_workflow_sync on public.businesses;
create trigger businesses_workflow_sync before insert or update on public.businesses
  for each row execute function public.sync_workflow_state();

create table if not exists public.workflow_transitions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  from_state text,
  to_state text not null,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists workflow_transitions_business_idx on public.workflow_transitions(business_id, created_at desc);
create index if not exists workflow_transitions_org_idx on public.workflow_transitions(organization_id, created_at desc);

create or replace function public.record_workflow_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.workflow_state is distinct from old.workflow_state then
    insert into public.workflow_transitions (organization_id, business_id, from_state, to_state, actor_type, actor_id, reason)
    values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.workflow_state end, new.workflow_state,
      new.workflow_state_actor, auth.uid(), new.workflow_state_reason);
  end if;
  return new;
end $$;

drop trigger if exists businesses_workflow_transition on public.businesses;
create trigger businesses_workflow_transition after insert or update on public.businesses
  for each row execute function public.record_workflow_transition();

-- ─── Automation policy ───────────────────────────────────────────────────────────────────────────

create table if not exists public.automation_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Row identifier for the generic audit trigger.
  id uuid not null default gen_random_uuid() unique,
  mode text not null default 'research_only' check (mode in
    ('research_only', 'research_and_proposals', 'approval_based_outreach', 'eligible_automated_outreach')),
  paused boolean not null default false,
  outbound_stopped boolean not null default true,
  outbound_stop_reason text check (char_length(outbound_stop_reason) <= 500),
  outbound_stop_changed_at timestamptz,
  outbound_stop_changed_by uuid references auth.users(id) on delete set null,
  disabled_agents text[] not null default '{}',
  max_concurrent_jobs integer not null default 2 check (max_concurrent_jobs between 1 and 10),
  budgets jsonb not null default '{}'::jsonb check (jsonb_typeof(budgets) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.guard_automation_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.organization_id <> old.organization_id or new.id <> old.id then
    raise exception 'Automation settings cannot be moved between workspaces.' using errcode = 'check_violation';
  end if;
  if old.outbound_stopped and not new.outbound_stopped then
    if not public.outbound_available() then
      raise exception 'Outbound sending is not available in this version, so the emergency stop stays engaged.' using errcode = 'check_violation';
    end if;
    if not public.has_org_role(new.organization_id, array['owner']) then
      raise exception 'Only an owner can lift the emergency stop.' using errcode = '42501';
    end if;
    if coalesce(btrim(new.outbound_stop_reason), '') = '' or new.outbound_stop_reason is not distinct from old.outbound_stop_reason then
      raise exception 'Record why the emergency stop is being lifted.' using errcode = 'check_violation';
    end if;
  end if;
  if new.mode is distinct from old.mode and new.mode in ('approval_based_outreach', 'eligible_automated_outreach') and not public.outbound_available() then
    raise exception 'Outreach modes are not available in this version.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_object_keys(new.budgets) k
    where k not in ('google_places', 'brave_search', 'anthropic', 'email', 'whatsapp', 'total')
  ) then
    raise exception 'Budgets can only be set for known providers.' using errcode = 'check_violation';
  end if;
  if new.outbound_stopped is distinct from old.outbound_stopped then
    new.outbound_stop_changed_at := now();
    new.outbound_stop_changed_by := auth.uid();
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- Engaging the stop cancels queued outbound work and asks running outbound work to stop.
create or replace function public.apply_outbound_stop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.outbound_stopped and not old.outbound_stopped then
    update public.automation_jobs j set status = 'cancelled', error_kind = 'cancelled', finished_at = now(), updated_at = now(),
      last_error = 'Cancelled by the outbound emergency stop.'
    where j.organization_id = new.organization_id and j.agent = 'outreach_execution' and j.status in ('pending', 'awaiting_approval');
    update public.automation_jobs j set cancel_requested = true, updated_at = now()
    where j.organization_id = new.organization_id and j.agent = 'outreach_execution' and j.status = 'running';
  end if;
  return new;
end $$;

create or replace function public.create_automation_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.automation_settings (organization_id) values (new.id) on conflict (organization_id) do nothing;
  return new;
end $$;

drop trigger if exists organizations_automation_settings on public.organizations;
create trigger organizations_automation_settings after insert on public.organizations
  for each row execute function public.create_automation_settings();

insert into public.automation_settings (organization_id)
select o.id from public.organizations o
on conflict (organization_id) do nothing;

-- ─── Jobs ────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent text not null check (agent in (
    'discovery', 'business_identity', 'website_verification', 'contact_research', 'contact_validation', 'digital_audit',
    'opportunity_scoring', 'opportunity_report', 'proposal_generation', 'outreach_drafting', 'permission_approval',
    'outreach_execution', 'response_classification', 'follow_up_planning', 'sales_intelligence')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'awaiting_approval')),
  priority integer not null default 100 check (priority between 0 and 1000),
  business_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  result jsonb check (result is null or pg_column_size(result) <= 65536),
  idempotency_key text check (char_length(idempotency_key) between 1 and 200),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  lease_token uuid,
  locked_until timestamptz,
  worker text check (char_length(worker) <= 100),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text check (char_length(last_error) <= 1000),
  error_kind text check (error_kind in ('retryable', 'permanent', 'budget', 'policy', 'timeout', 'uncertain_delivery', 'cancelled')),
  cancel_requested boolean not null default false,
  parent_job_id uuid references public.automation_jobs(id) on delete set null,
  trace_id uuid not null default gen_random_uuid(),
  estimated_cost_usd numeric(10, 4) not null default 0 check (estimated_cost_usd >= 0),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create unique index if not exists automation_jobs_idempotency_idx on public.automation_jobs(organization_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists automation_jobs_due_idx on public.automation_jobs(run_after, priority) where status = 'pending';
create index if not exists automation_jobs_org_idx on public.automation_jobs(organization_id, created_at desc);
create index if not exists automation_jobs_running_idx on public.automation_jobs(organization_id) where status = 'running';
create index if not exists automation_jobs_business_idx on public.automation_jobs(business_id) where business_id is not null;
create index if not exists automation_jobs_trace_idx on public.automation_jobs(trace_id);

create or replace function public.enqueue_automation_job(
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
  p_max_attempts integer default 3
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
  if p_parent is not null then
    select pj.trace_id into parent_trace from public.automation_jobs pj where pj.id = p_parent and pj.organization_id = p_org;
    if parent_trace is null then
      raise exception 'Parent job not found in this workspace.' using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.automation_jobs (organization_id, agent, status, priority, business_id, payload, idempotency_key, run_after,
    parent_job_id, trace_id, estimated_cost_usd, max_attempts, created_by)
  values (p_org, p_agent, case when p_requires_approval then 'awaiting_approval' else 'pending' end,
    coalesce(p_priority, 100), p_business, coalesce(p_payload, '{}'::jsonb), p_idempotency_key, coalesce(p_run_after, now()),
    p_parent, coalesce(parent_trace, gen_random_uuid()), greatest(coalesce(p_estimated_cost, 0), 0), coalesce(p_max_attempts, 3), auth.uid())
  on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into j;

  if j.id is not null then
    return jsonb_build_object('created', true, 'job', to_jsonb(j));
  end if;
  select * into j from public.automation_jobs x where x.organization_id = p_org and x.idempotency_key = p_idempotency_key;
  return jsonb_build_object('created', false, 'job', to_jsonb(j));
end $$;

-- Claims due jobs for one workspace (members) or all workspaces (service role only). Expired leases
-- are recovered first: research work is retried, outbound work is never retried automatically.
create or replace function public.claim_automation_jobs(p_org uuid, p_worker text, p_limit integer default 3, p_lease_seconds integer default 120)
returns setof public.automation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 1), 1), 20);
  lease integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 900);
begin
  if p_org is null then
    if not public.is_service_role() then
      raise exception 'Only the background worker can claim jobs across workspaces.' using errcode = '42501';
    end if;
  elsif not public.can_automate(p_org) then
    raise exception 'Your role does not allow automation.' using errcode = '42501';
  end if;

  update public.automation_jobs j set
    status = case
      when j.agent = 'outreach_execution' then 'failed'
      when j.cancel_requested then 'cancelled'
      when j.attempts >= j.max_attempts then 'failed'
      else 'pending' end,
    error_kind = case
      when j.agent = 'outreach_execution' then 'uncertain_delivery'
      when j.cancel_requested then 'cancelled'
      else 'timeout' end,
    last_error = case
      when j.agent = 'outreach_execution' then 'The worker stopped before confirming delivery. Check the message status manually; it will not be retried automatically.'
      else 'The worker stopped before finishing this job (lease expired).' end,
    finished_at = case when j.agent = 'outreach_execution' or j.cancel_requested or j.attempts >= j.max_attempts then now() end,
    lease_token = null, locked_until = null, worker = null, run_after = now(), updated_at = now()
  where j.status = 'running' and j.locked_until < now() and (p_org is null or j.organization_id = p_org);

  return query
  with candidates as (
    select j.id from public.automation_jobs j
    join public.automation_settings s on s.organization_id = j.organization_id
    where j.status = 'pending' and j.run_after <= now() and not j.cancel_requested
      and (p_org is null or j.organization_id = p_org)
      and not s.paused
      and not (j.agent = any (s.disabled_agents))
      and (j.agent <> 'outreach_execution' or (not s.outbound_stopped and public.outbound_available()))
    order by j.priority, j.run_after, j.created_at
    for update of j skip locked
    limit lim * 5
  ), ranked as (
    select j.id,
      row_number() over (partition by j.organization_id order by j.priority, j.run_after, j.created_at) as rn,
      s.max_concurrent_jobs - (
        select count(*) from public.automation_jobs r where r.organization_id = j.organization_id and r.status = 'running'
      ) as slots
    from public.automation_jobs j
    join candidates c on c.id = j.id
    join public.automation_settings s on s.organization_id = j.organization_id
  ), chosen as (
    select r.id from ranked r where r.rn <= r.slots order by r.rn limit lim
  ), claimed as (
    update public.automation_jobs j set
      status = 'running',
      attempts = j.attempts + 1,
      lease_token = gen_random_uuid(),
      locked_until = now() + make_interval(secs => lease),
      worker = left(p_worker, 100),
      started_at = coalesce(j.started_at, now()),
      updated_at = now()
    from chosen where j.id = chosen.id
    returning j.*
  )
  select * from claimed;
end $$;

-- Outcomes: succeeded · retry (backoff, counts an attempt) · deferred (budget/rate limit, does not
-- count) · failed (dead letter) · cancelled · awaiting_approval. A stale lease is rejected.
create or replace function public.finish_automation_job(
  p_job uuid,
  p_lease uuid,
  p_outcome text,
  p_result jsonb default null,
  p_error text default null,
  p_error_kind text default null,
  p_run_after timestamptz default null
) returns public.automation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.automation_jobs;
  next_status text;
begin
  select * into j from public.automation_jobs x where x.id = p_job for update;
  if j.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not public.can_automate(j.organization_id) then
    raise exception 'Your role does not allow automation.' using errcode = '42501';
  end if;
  if j.status <> 'running' or j.lease_token is distinct from p_lease then
    raise exception 'This job is no longer held by this worker.' using errcode = '55000';
  end if;
  if p_outcome not in ('succeeded', 'retry', 'deferred', 'failed', 'cancelled', 'awaiting_approval') then
    raise exception 'Unknown job outcome.' using errcode = '22023';
  end if;

  next_status := case
    when p_outcome = 'succeeded' then 'succeeded'
    when j.cancel_requested or p_outcome = 'cancelled' then 'cancelled'
    when p_outcome = 'awaiting_approval' then 'awaiting_approval'
    when p_outcome = 'deferred' and j.agent <> 'outreach_execution' then 'pending'
    when p_outcome = 'retry' and j.agent <> 'outreach_execution' and j.attempts < j.max_attempts
      and coalesce(p_error_kind, 'retryable') in ('retryable', 'timeout') then 'pending'
    else 'failed' end;

  update public.automation_jobs x set
    status = next_status,
    attempts = case when p_outcome = 'deferred' then greatest(j.attempts - 1, 0) else j.attempts end,
    result = coalesce(p_result, j.result),
    last_error = case when next_status = 'succeeded' then null else left(p_error, 1000) end,
    error_kind = case
      when next_status = 'succeeded' then null
      when next_status = 'cancelled' then 'cancelled'
      else p_error_kind end,
    run_after = case when next_status = 'pending' then coalesce(p_run_after, now()) else j.run_after end,
    finished_at = case when next_status in ('succeeded', 'failed', 'cancelled') then now() end,
    lease_token = null, locked_until = null, worker = null, updated_at = now()
  where x.id = p_job
  returning * into j;
  return j;
end $$;

create or replace function public.cancel_automation_job(p_job uuid, p_reason text default null) returns public.automation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.automation_jobs;
begin
  select * into j from public.automation_jobs x where x.id = p_job for update;
  if j.id is null or not public.can_automate(j.organization_id) then
    raise exception 'Job not found or your role cannot change it.' using errcode = '42501';
  end if;
  if j.status in ('pending', 'awaiting_approval') then
    update public.automation_jobs x set status = 'cancelled', error_kind = 'cancelled', finished_at = now(), updated_at = now(),
      last_error = left(coalesce(nullif(btrim(p_reason), ''), 'Cancelled by a team member.'), 1000)
    where x.id = p_job returning * into j;
  elsif j.status = 'running' then
    update public.automation_jobs x set cancel_requested = true, updated_at = now() where x.id = p_job returning * into j;
  else
    raise exception 'Only queued or running jobs can be cancelled.' using errcode = 'check_violation';
  end if;
  return j;
end $$;

create or replace function public.retry_automation_job(p_job uuid) returns public.automation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.automation_jobs;
begin
  select * into j from public.automation_jobs x where x.id = p_job for update;
  if j.id is null or not public.can_automate(j.organization_id) then
    raise exception 'Job not found or your role cannot change it.' using errcode = '42501';
  end if;
  if j.agent = 'outreach_execution' then
    raise exception 'Outbound messages are never re-sent from the queue. Review the message and approve a new send.' using errcode = 'check_violation';
  end if;
  if j.status not in ('failed', 'cancelled') then
    raise exception 'Only failed or cancelled jobs can be retried.' using errcode = 'check_violation';
  end if;
  update public.automation_jobs x set status = 'pending', attempts = 0, run_after = now(), cancel_requested = false,
    last_error = null, error_kind = null, finished_at = null, updated_at = now()
  where x.id = p_job returning * into j;
  return j;
end $$;

create or replace function public.approve_automation_job(p_job uuid) returns public.automation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.automation_jobs;
begin
  select * into j from public.automation_jobs x where x.id = p_job for update;
  if j.id is null or not public.has_org_role(j.organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and administrators can approve automation steps.' using errcode = '42501';
  end if;
  if j.status <> 'awaiting_approval' then
    raise exception 'This job is not waiting for approval.' using errcode = 'check_violation';
  end if;
  update public.automation_jobs x set status = 'pending', run_after = now(), approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where x.id = p_job returning * into j;
  return j;
end $$;

-- ─── Agent runs ──────────────────────────────────────────────────────────────────────────────────

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid,
  business_id uuid,
  agent text not null check (char_length(agent) between 1 and 60),
  agent_version text not null check (char_length(agent_version) between 1 and 40),
  status text not null check (status in ('succeeded', 'failed', 'skipped', 'cancelled', 'deferred')),
  summary text not null check (char_length(summary) between 1 and 500),
  decision text check (char_length(decision) <= 200),
  confidence integer check (confidence between 0 and 100),
  input jsonb check (input is null or pg_column_size(input) <= 16384),
  output jsonb check (output is null or pg_column_size(output) <= 65536),
  provider_calls jsonb not null default '[]'::jsonb check (jsonb_typeof(provider_calls) = 'array'),
  model text check (char_length(model) <= 80),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  estimated_cost_usd numeric(10, 4) not null default 0 check (estimated_cost_usd >= 0),
  error text check (char_length(error) <= 1000),
  trace_id uuid,
  worker text check (char_length(worker) <= 100),
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  foreign key (job_id, organization_id) references public.automation_jobs(id, organization_id) on delete set null (job_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists agent_runs_org_idx on public.agent_runs(organization_id, created_at desc);
create index if not exists agent_runs_business_idx on public.agent_runs(business_id, created_at desc) where business_id is not null;
create index if not exists agent_runs_job_idx on public.agent_runs(job_id) where job_id is not null;

-- ─── Triggers ────────────────────────────────────────────────────────────────────────────────────

drop trigger if exists automation_settings_guard on public.automation_settings;
create trigger automation_settings_guard before update on public.automation_settings
  for each row execute function public.guard_automation_settings();
drop trigger if exists automation_settings_outbound_stop on public.automation_settings;
create trigger automation_settings_outbound_stop after update on public.automation_settings
  for each row execute function public.apply_outbound_stop();
drop trigger if exists automation_settings_audit on public.automation_settings;
create trigger automation_settings_audit after insert or update or delete on public.automation_settings
  for each row execute function public.audit_row_change();

-- ─── Row Level Security ──────────────────────────────────────────────────────────────────────────

alter table public.automation_settings enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.agent_runs enable row level security;
alter table public.workflow_transitions enable row level security;

drop policy if exists automation_settings_select on public.automation_settings;
create policy automation_settings_select on public.automation_settings for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists automation_settings_update on public.automation_settings;
create policy automation_settings_update on public.automation_settings for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));

-- Jobs change state only through the functions above.
drop policy if exists automation_jobs_select on public.automation_jobs;
create policy automation_jobs_select on public.automation_jobs for select to authenticated
  using (public.is_org_member(organization_id));

-- Append-only run log; members record runs as themselves.
drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists agent_runs_insert on public.agent_runs;
create policy agent_runs_insert on public.agent_runs for insert to authenticated
  with check (public.can_automate(organization_id) and actor_id is not distinct from (select auth.uid()));

drop policy if exists workflow_transitions_select on public.workflow_transitions;
create policy workflow_transitions_select on public.workflow_transitions for select to authenticated
  using (public.is_org_member(organization_id));

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────

revoke all on public.automation_settings, public.automation_jobs, public.agent_runs, public.workflow_transitions from anon, authenticated;
grant select, update on public.automation_settings to authenticated;
grant select on public.automation_jobs, public.workflow_transitions to authenticated;
grant select, insert on public.agent_runs to authenticated;
grant select, insert, update, delete on public.automation_settings, public.automation_jobs, public.agent_runs, public.workflow_transitions to service_role;

revoke execute on function public.enqueue_automation_job(uuid, text, uuid, jsonb, text, integer, timestamptz, uuid, boolean, numeric, integer) from public, anon;
revoke execute on function public.claim_automation_jobs(uuid, text, integer, integer) from public, anon;
revoke execute on function public.finish_automation_job(uuid, uuid, text, jsonb, text, text, timestamptz) from public, anon;
revoke execute on function public.cancel_automation_job(uuid, text) from public, anon;
revoke execute on function public.retry_automation_job(uuid) from public, anon;
revoke execute on function public.approve_automation_job(uuid) from public, anon;
revoke execute on function public.can_automate(uuid) from public, anon;
grant execute on function public.enqueue_automation_job(uuid, text, uuid, jsonb, text, integer, timestamptz, uuid, boolean, numeric, integer) to authenticated, service_role;
grant execute on function public.claim_automation_jobs(uuid, text, integer, integer) to authenticated, service_role;
grant execute on function public.finish_automation_job(uuid, uuid, text, jsonb, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.cancel_automation_job(uuid, text) to authenticated, service_role;
grant execute on function public.retry_automation_job(uuid) to authenticated, service_role;
grant execute on function public.approve_automation_job(uuid) to authenticated;
grant execute on function public.can_automate(uuid) to authenticated, service_role;
grant execute on function public.is_service_role(), public.outbound_available() to authenticated, service_role;
