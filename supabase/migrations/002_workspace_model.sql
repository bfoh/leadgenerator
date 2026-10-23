-- Digital Opportunity Finder v7 — organization-scoped workspace model.
--
-- * Adds organizations, memberships with roles, invitations and the normalized research → sales →
--   delivery tables. Every tenant table carries organization_id and is protected by RLS.
-- * Child rows reference parents through composite (id, organization_id) foreign keys so a row can
--   never point at another organization's data.
-- * public.leads (migration 001) is NOT modified. Its rows are copied into public.businesses by
--   public.migrate_legacy_leads_for(); keep public.leads until the copy has been checked.
-- * Re-runnable: tables use IF NOT EXISTS, functions CREATE OR REPLACE, policies/triggers are dropped
--   and recreated, and the legacy copy is idempotent.

-- ─── Utility triggers ────────────────────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Stamps the acting user on insert so clients cannot attribute records to someone else.
create or replace function public.stamp_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

-- ─── Organizations and membership ────────────────────────────────────────────────────────────────

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'researcher', 'sales', 'developer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members(user_id);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('admin', 'researcher', 'sales', 'developer', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id, email)
);

-- SECURITY DEFINER so policies on organization_members can call them without recursion.
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create or replace function public.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner') or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if not exists (
      select 1 from public.organization_members m
      where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
    ) and exists (select 1 from public.organizations o where o.id = old.organization_id) then
      raise exception 'An organization must keep at least one owner' using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists organization_members_last_owner on public.organization_members;
create trigger organization_members_last_owner before update or delete on public.organization_members
  for each row execute function public.protect_last_owner();

drop trigger if exists organizations_touch on public.organizations;
create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ─── Research: businesses and verification ───────────────────────────────────────────────────────

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null default 'Other' check (char_length(category) between 1 and 80),
  country text not null default 'GH' check (char_length(country) between 2 and 3),
  region text check (char_length(region) <= 80),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  neighborhood text check (char_length(neighborhood) <= 80),
  address text check (char_length(address) <= 300),
  business_status text not null default 'unknown' check (business_status in ('unknown', 'active', 'inactive')),

  official_website text check (official_website ~* '^https?://' and char_length(official_website) <= 2000),
  website_status text not null default 'unverified' check (website_status in
    ('unverified', 'verified_official', 'potential_official', 'unavailable', 'unhealthy', 'none_found', 'insufficient_evidence')),
  website_outdated boolean not null default false,
  social_profiles jsonb not null default '[]'::jsonb check (jsonb_typeof(social_profiles) = 'array'),

  enquiry_channel text check (char_length(enquiry_channel) <= 300),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  contact_source text check (char_length(contact_source) <= 500),
  contact_permission text not null default 'unknown' check (contact_permission in
    ('unknown', 'introduction_requested', 'granted', 'declined', 'opted_out')),
  lawful_basis text check (lawful_basis in ('consent', 'business_initiated', 'existing_relationship')),
  permission_evidence text check (char_length(permission_evidence) <= 1000),
  permission_recorded_at timestamptz,
  opted_out_at timestamptz,

  interest_level text not null default 'unknown' check (interest_level in ('unknown', 'none', 'low', 'medium', 'high')),
  budget_signal text not null default 'unknown' check (budget_signal in ('unknown', 'limited', 'adequate', 'strong')),
  service_needs text[] not null default '{}',

  opportunity_score integer check (opportunity_score between 0 and 100),
  confidence_score integer check (confidence_score between 0 and 100),
  score_breakdown jsonb,
  scored_at timestamptz,

  stage text not null default 'research_candidate' check (stage in (
    'research_candidate', 'verification_pending', 'qualified', 'introduction_requested', 'contact_authorized',
    'discovery_meeting', 'proposal_draft', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived')),
  owner_id uuid references auth.users(id) on delete set null,
  estimated_value numeric(14, 2) check (estimated_value >= 0),
  expected_close_date date,
  lost_reason text check (char_length(lost_reason) <= 500),
  next_action text check (char_length(next_action) <= 300),
  next_action_due date,
  last_interaction_at timestamptz,

  notes text not null default '' check (char_length(notes) <= 10000),
  source_url text check (source_url ~* '^https?://' and char_length(source_url) <= 2000),
  source_kind text not null default 'manual' check (source_kind in
    ('manual', 'directory', 'search', 'direct_submission', 'referral', 'places_reference', 'legacy_seed')),
  places_place_id text check (char_length(places_place_id) <= 300),
  legacy_id text,
  legacy jsonb,

  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Granted permission must state its basis (Ghana Data Protection Act 2012 record-keeping).
  constraint businesses_permission_basis check (contact_permission <> 'granted' or lawful_basis is not null),
  unique (id, organization_id),
  unique (organization_id, legacy_id)
);
create index if not exists businesses_org_stage_idx on public.businesses(organization_id, stage);
create index if not exists businesses_org_city_idx on public.businesses(organization_id, city);
create index if not exists businesses_org_place_idx on public.businesses(organization_id, places_place_id) where places_place_id is not null;

create table if not exists public.website_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  status text not null check (status in
    ('verified_official', 'potential_official', 'unavailable', 'unhealthy', 'none_found', 'insufficient_evidence')),
  checked_at timestamptz not null default now(),
  methods text[] not null default '{}' check (methods <@ array[
    'exact_name_search', 'name_variation_search', 'domain_probe', 'social_profile_review',
    'http_check', 'redirect_check', 'technical_health', 'manual_review']::text[]),
  domain text check (char_length(domain) <= 253),
  source_url text check (source_url ~* '^https?://' and char_length(source_url) <= 2000),
  evidence_summary text not null check (char_length(evidence_summary) between 1 and 4000),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  website_outdated boolean not null default false,
  technical jsonb,
  reviewer_id uuid references auth.users(id) on delete set null default auth.uid(),
  reviewer_name text check (char_length(reviewer_name) <= 120),
  next_check_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists website_verifications_business_idx on public.website_verifications(business_id, checked_at desc);

-- ─── CRM: activities ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  type text not null check (type in ('note', 'stage_change', 'call', 'meeting', 'email', 'whatsapp', 'verification',
    'report', 'proposal', 'permission', 'project', 'system')),
  summary text not null check (char_length(summary) between 1 and 500),
  details jsonb,
  occurred_at timestamptz not null default now(),
  scheduled_for timestamptz,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists activities_business_idx on public.activities(business_id, occurred_at desc);
create index if not exists activities_org_idx on public.activities(organization_id, occurred_at desc);

-- ─── Reports (append-only versions) ──────────────────────────────────────────────────────────────

create table if not exists public.opportunity_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  version integer not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  generator text not null check (generator in ('deterministic', 'ai', 'manual_edit')),
  model text,
  input_snapshot jsonb not null,
  validation jsonb,
  usage jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, version),
  unique (id, organization_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);

create or replace function public.next_report_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('report:' || new.business_id::text));
  select coalesce(max(r.version), 0) + 1 into new.version
  from public.opportunity_reports r where r.business_id = new.business_id;
  return new;
end $$;

-- ─── Proposals ───────────────────────────────────────────────────────────────────────────────────

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  report_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'accepted', 'declined', 'withdrawn')),
  package_key text,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  currency text not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  one_time_total numeric(14, 2) check (one_time_total >= 0),
  monthly_total numeric(14, 2) check (monthly_total >= 0),
  version integer not null default 1,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  decided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (report_id, organization_id) references public.opportunity_reports(id, organization_id) on delete set null (report_id)
);
create index if not exists proposals_org_status_idx on public.proposals(organization_id, status);
create index if not exists proposals_business_idx on public.proposals(business_id);

create table if not exists public.proposal_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null,
  version integer not null,
  status text not null,
  title text not null,
  content jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (proposal_id, version),
  foreign key (proposal_id, organization_id) references public.proposals(id, organization_id) on delete cascade
);

-- Only drafts are editable; every change to content, status or title increments the version.
create or replace function public.guard_proposal_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.content is distinct from old.content and old.status <> 'draft' then
    raise exception 'Only draft proposals can be edited. Revise the proposal to create a new draft.'
      using errcode = 'check_violation';
  end if;
  if new.content is distinct from old.content or new.status is distinct from old.status or new.title is distinct from old.title then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

create or replace function public.snapshot_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.proposal_versions (organization_id, proposal_id, version, status, title, content, created_by)
    values (new.organization_id, new.id, new.version, new.status, new.title, new.content, auth.uid())
    on conflict (proposal_id, version) do nothing;
  end if;
  return new;
end $$;

-- ─── Delivery: projects ──────────────────────────────────────────────────────────────────────────

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  proposal_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  project_type text not null check (project_type in
    ('website', 'ecommerce', 'booking', 'dashboard', 'mobile_app', 'ai_automation', 'custom_software')),
  status text not null default 'planning' check (status in ('planning', 'in_progress', 'on_hold', 'delivered', 'maintenance', 'cancelled')),
  contract_value numeric(14, 2) check (contract_value >= 0),
  currency text not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  start_date date,
  due_date date,
  deployment_url text check (deployment_url ~* '^https?://' and char_length(deployment_url) <= 2000),
  maintenance_status text not null default 'none' check (maintenance_status in ('none', 'offered', 'active', 'ended')),
  invoice_status text not null default 'not_invoiced' check (invoice_status in ('not_invoiced', 'partially_invoiced', 'invoiced', 'paid')),
  deliverables jsonb not null default '[]'::jsonb check (jsonb_typeof(deliverables) = 'array'),
  notes text not null default '' check (char_length(notes) <= 10000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  -- Delivery records are not removed implicitly; delete or reassign projects before the business.
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete restrict,
  foreign key (proposal_id, organization_id) references public.proposals(id, organization_id) on delete set null (proposal_id)
);
create index if not exists projects_org_status_idx on public.projects(organization_id, status);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade
);
create index if not exists project_milestones_project_idx on public.project_milestones(project_id, sort_order);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid,
  project_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  due_date date,
  completed_at timestamptz,
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade
);
create index if not exists tasks_org_due_idx on public.tasks(organization_id, completed_at, due_date);

-- ─── Usage metering and audit ────────────────────────────────────────────────────────────────────

create table if not exists public.usage_records (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  provider text not null check (char_length(provider) between 1 and 40),
  operation text not null check (char_length(operation) between 1 and 60),
  units integer not null default 1 check (units > 0),
  estimated_cost_usd numeric(10, 4) not null default 0 check (estimated_cost_usd >= 0),
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists usage_records_org_op_idx on public.usage_records(organization_id, operation, created_at desc);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_record_idx on public.audit_events(organization_id, record_id, created_at desc);

-- Records changed columns. Deleting a record purges its earlier audit payloads (erasure requests)
-- and leaves a data-free tombstone with actor and time.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  diff jsonb := '{}'::jsonb;
  o jsonb;
  n jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, table_name, record_id, action, actor_id)
    values (new.organization_id, tg_table_name, new.id, 'insert', auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old);
    n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      continue when k in ('updated_at', 'score_breakdown', 'scored_at', 'version');
      if (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.audit_events (organization_id, table_name, record_id, action, actor_id, changes)
      values (new.organization_id, tg_table_name, new.id, 'update', auth.uid(), diff);
    end if;
    return new;
  else
    delete from public.audit_events a where a.table_name = tg_table_name and a.record_id = old.id;
    if exists (select 1 from public.organizations org where org.id = old.organization_id) then
      insert into public.audit_events (organization_id, table_name, record_id, action, actor_id)
      values (old.organization_id, tg_table_name, old.id, 'delete', auth.uid());
    end if;
    return old;
  end if;
end $$;

-- ─── Triggers ────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['businesses', 'website_verifications', 'proposals', 'projects', 'project_milestones', 'tasks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['businesses', 'opportunity_reports', 'proposals', 'projects', 'tasks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_creator', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_creator()', t || '_creator', t);
  end loop;
  foreach t in array array['businesses', 'website_verifications', 'proposals', 'projects'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

drop trigger if exists opportunity_reports_version on public.opportunity_reports;
create trigger opportunity_reports_version before insert on public.opportunity_reports
  for each row execute function public.next_report_version();

drop trigger if exists proposals_guard on public.proposals;
create trigger proposals_guard before update on public.proposals
  for each row execute function public.guard_proposal_update();

drop trigger if exists proposals_snapshot on public.proposals;
create trigger proposals_snapshot after insert or update on public.proposals
  for each row execute function public.snapshot_proposal();

-- ─── Row Level Security ──────────────────────────────────────────────────────────────────────────

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.businesses enable row level security;
alter table public.website_verifications enable row level security;
alter table public.activities enable row level security;
alter table public.opportunity_reports enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_versions enable row level security;
alter table public.projects enable row level security;
alter table public.project_milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.usage_records enable row level security;
alter table public.audit_events enable row level security;

-- Organizations
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated using (public.is_org_member(id));
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin'])) with check (public.has_org_role(id, array['owner', 'admin']));
drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations for delete to authenticated using (public.has_org_role(id, array['owner']));

-- Members: everyone sees teammates; owners/admins manage; only owners touch owner rows; anyone may leave.
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members for update to authenticated
  using (public.has_org_role(organization_id, array['owner']) or (public.has_org_role(organization_id, array['admin']) and role <> 'owner'))
  with check (public.has_org_role(organization_id, array['owner']) or (public.has_org_role(organization_id, array['admin']) and role <> 'owner'));
drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_org_role(organization_id, array['owner'])
    or (public.has_org_role(organization_id, array['admin']) and role <> 'owner')
  );

-- Invitations contain personal email addresses: owners/admins only.
drop policy if exists organization_invitations_all on public.organization_invitations;
create policy organization_invitations_all on public.organization_invitations for all to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));

-- Standard tenant tables: members read; listed roles write; owners/admins delete.
create or replace function public.apply_tenant_policies(tbl text, write_roles text[], allow_update boolean) returns void
language plpgsql set search_path = '' as $$
begin
  execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
  execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', tbl || '_select', tbl);
  execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.has_org_role(organization_id, %L::text[]))',
    tbl || '_insert', tbl, write_roles);
  execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
  if allow_update then
    execute format('create policy %I on public.%I for update to authenticated using (public.has_org_role(organization_id, %L::text[])) with check (public.has_org_role(organization_id, %L::text[]))',
      tbl || '_update', tbl, write_roles, write_roles);
  end if;
  execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
  execute format('create policy %I on public.%I for delete to authenticated using (public.has_org_role(organization_id, %L::text[]))',
    tbl || '_delete', tbl, array['owner', 'admin']);
end $$;

select public.apply_tenant_policies('businesses', array['owner', 'admin', 'researcher', 'sales'], true);
select public.apply_tenant_policies('website_verifications', array['owner', 'admin', 'researcher', 'sales'], true);
select public.apply_tenant_policies('activities', array['owner', 'admin', 'researcher', 'sales', 'developer'], true);
select public.apply_tenant_policies('tasks', array['owner', 'admin', 'researcher', 'sales', 'developer'], true);
select public.apply_tenant_policies('opportunity_reports', array['owner', 'admin', 'researcher', 'sales'], false);
select public.apply_tenant_policies('proposals', array['owner', 'admin', 'sales'], true);
select public.apply_tenant_policies('projects', array['owner', 'admin', 'sales', 'developer'], true);
select public.apply_tenant_policies('project_milestones', array['owner', 'admin', 'sales', 'developer'], true);
drop function public.apply_tenant_policies(text, text[], boolean);

-- Written only by triggers.
drop policy if exists proposal_versions_select on public.proposal_versions;
create policy proposal_versions_select on public.proposal_versions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated using (public.is_org_member(organization_id));

-- Insert-only metering: members record their own usage; nobody can edit or delete it.
drop policy if exists usage_records_select on public.usage_records;
create policy usage_records_select on public.usage_records for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists usage_records_insert on public.usage_records;
create policy usage_records_insert on public.usage_records for insert to authenticated
  with check (public.is_org_member(organization_id) and user_id = (select auth.uid()));

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────

revoke all on public.organizations, public.organization_members, public.organization_invitations, public.businesses,
  public.website_verifications, public.activities, public.opportunity_reports, public.proposals, public.proposal_versions,
  public.projects, public.project_milestones, public.tasks, public.usage_records, public.audit_events from anon, authenticated;

grant select, update, delete on public.organizations to authenticated;
grant select, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;
grant select, insert, update, delete on public.businesses, public.website_verifications, public.activities, public.proposals,
  public.projects, public.project_milestones, public.tasks to authenticated;
grant select, insert, delete on public.opportunity_reports to authenticated;
grant select on public.proposal_versions, public.audit_events to authenticated;
grant select, insert on public.usage_records to authenticated;
grant usage on sequence public.usage_records_id_seq to authenticated;

-- ─── Legacy copy: public.leads (v4–v6) → businesses ─────────────────────────────────────────────
-- Mirrors src/lib/domain/legacy.ts. Idempotent via unique (organization_id, legacy_id).

create or replace function public.migrate_legacy_leads_for(p_user uuid, p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  copied integer := 0;
begin
  if to_regclass('public.leads') is null then
    return 0;
  end if;

  with src as (
    select l.*,
      case when l.confidence in ('high', 'medium') then l.confidence else 'low' end as conf,
      case l."verificationOutcome"
        when 'No official website found after review' then 'none_found'
        when 'Official website found' then 'verified_official'
        when 'Needs more evidence' then 'insufficient_evidence'
        when 'Business inactive' then 'insufficient_evidence'
      end as reviewed,
      case
        when lower(l."websiteStatus") = 'official website found' and l.confidence = 'high' then 'verified_official'
        when lower(l."websiteStatus") = 'official website found' then 'potential_official'
        when lower(l."websiteStatus") ~ '(website|domain)' and lower(l."websiteStatus") ~ '(found|reported|relationship|existing)' then 'potential_official'
        else 'insufficient_evidence'
      end as researched,
      case l.consent
        when 'Permission requested' then 'introduction_requested'
        when 'Permission obtained' then 'granted'
        when 'Opted out' then 'opted_out'
        else 'unknown'
      end as permission
    from public.leads l
    where l.owner_id = p_user
  ),
  inserted as (
    insert into public.businesses (
      organization_id, name, category, country, region, city, business_status, website_status, phone, email,
      contact_source, contact_permission, lawful_basis, permission_evidence, opted_out_at, stage, notes,
      source_url, source_kind, legacy_id, legacy, created_by)
    select
      p_org,
      left(s.name, 200),
      case s.sector
        when 'Fashion' then 'Fashion boutique'
        when 'Furniture' then 'Furniture showroom'
        when 'Bridal' then 'Bridal shop'
        when 'Beauty' then 'Beauty salon'
        when 'Hospitality' then 'Hotel'
        else coalesce(nullif(left(s.sector, 80), ''), 'Other')
      end,
      'GH',
      case s.city when 'Accra' then 'Greater Accra' when 'Tema' then 'Greater Accra' when 'Kumasi' then 'Ashanti' end,
      coalesce(nullif(left(s.city, 80), ''), 'Accra'),
      case when s."verificationOutcome" = 'Business inactive' then 'inactive' else 'unknown' end,
      coalesce(s.reviewed, s.researched),
      nullif(left(s.phone, 40), ''),
      nullif(left(s.email, 254), ''),
      nullif(left(s."contactEvidence", 500), ''),
      s.permission,
      case when s.permission = 'granted' then 'consent' end,
      case when s.permission = 'granted' then 'Recorded in v6 as "Permission obtained"' end,
      case when s.permission = 'opted_out' then now() end,
      case s.stage
        when 'Verification' then 'verification_pending'
        when 'Qualified' then 'qualified'
        when 'Introduced' then 'introduction_requested'
        when 'Meeting' then 'discovery_meeting'
        when 'Proposal' then 'proposal_draft'
        when 'Won' then 'won'
        when 'Lost' then 'lost'
        when 'Excluded' then 'archived'
        else 'research_candidate'
      end,
      left(concat_ws(E'\n\n', nullif(s.notes, ''), case when s.suggestion <> '' then 'Suggested service (v1–v6): ' || s.suggestion end), 10000),
      case when s.source ~* '^https?://' then left(s.source, 2000) end,
      'legacy_seed',
      s.id,
      to_jsonb(s) - 'owner_id' - 'conf' - 'reviewed' - 'researched' - 'permission',
      p_user
    from src s
    on conflict (organization_id, legacy_id) do nothing
    returning id, legacy_id
  ),
  research_rows as (
    insert into public.website_verifications (
      organization_id, business_id, status, checked_at, methods, source_url, evidence_summary, confidence, reviewer_id, reviewer_name)
    select p_org, i.id, s.researched, s.created_at, array['manual_review'],
      case when s.source ~* '^https?://' then left(s.source, 2000) end,
      left(format('Imported v1–v3 desk research finding: "%s". Not independently re-verified.', s."websiteStatus"), 4000),
      s.conf, null, 'Legacy import'
    from inserted i join src s on s.id = i.legacy_id
  )
  insert into public.website_verifications (
    organization_id, business_id, status, checked_at, methods, source_url, evidence_summary, confidence, reviewer_id, reviewer_name)
  select p_org, i.id, s.reviewed,
    -- The manual review must sort after the imported desk research.
    greatest(
      case when s."reviewedAt" ~ '^\d{4}-\d{2}-\d{2}' then left(s."reviewedAt", 10)::date::timestamptz else now() end,
      s.created_at + interval '1 second'),
    array['manual_review'],
    case when s."websiteEvidence" ~* '^https?://' then left(s."websiteEvidence", 2000) end,
    left(format('v6 manual review outcome: "%s". Evidence: %s.', s."verificationOutcome", coalesce(nullif(s."websiteEvidence", ''), 'not recorded')), 4000),
    s.conf, null, coalesce(nullif(left(s."verifiedBy", 120), ''), 'Legacy reviewer')
  from inserted i join src s on s.id = i.legacy_id
  where s.reviewed is not null;

  select count(*) into copied from public.businesses b where b.organization_id = p_org and b.source_kind = 'legacy_seed';
  return copied;
end $$;

-- ─── Workspace bootstrap (called by the app after sign-in) ───────────────────────────────────────

create or replace function public.ensure_workspace()
returns table (org_id uuid, org_name text, member_role text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  confirmed_email text;
  inv record;
  new_org uuid;
  owned_org uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Accept pending invitations for this user's confirmed email address.
  select lower(u.email) into confirmed_email from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if confirmed_email is not null then
    for inv in
      select i.id, i.organization_id, i.role from public.organization_invitations i
      where i.email = confirmed_email and i.accepted_at is null
    loop
      insert into public.organization_members as m (organization_id, user_id, role)
      values (inv.organization_id, uid, inv.role)
      on conflict (organization_id, user_id) do nothing;
      update public.organization_invitations i set accepted_at = now() where i.id = inv.id;
    end loop;
  end if;

  if not exists (select 1 from public.organization_members m where m.user_id = uid) then
    insert into public.organizations (name) values ('My agency') returning id into new_org;
    insert into public.organization_members (organization_id, user_id, role) values (new_org, uid, 'owner');
  end if;

  select m.organization_id into owned_org from public.organization_members m
  where m.user_id = uid and m.role = 'owner' order by m.created_at limit 1;
  if owned_org is not null then
    perform public.migrate_legacy_leads_for(uid, owned_org);
  end if;

  return query
    select m.organization_id, o.name, m.role
    from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.user_id = uid
    order by m.created_at
    limit 1;
end $$;

-- Teammates' emails for the Settings → Team screen (auth.users is not exposed to clients).
create or replace function public.list_organization_members(org uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email, m.role, m.created_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = org and public.is_org_member(org)
  order by m.created_at;
$$;

revoke execute on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.list_organization_members(uuid) to authenticated;
revoke execute on function public.ensure_workspace() from public, anon;
grant execute on function public.ensure_workspace() to authenticated;
revoke execute on function public.migrate_legacy_leads_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, text[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

-- Copy existing v4–v6 cloud leads now, creating a personal organization for each legacy owner.
do $$
declare
  r record;
  org uuid;
begin
  if to_regclass('public.leads') is null then
    return;
  end if;
  for r in select distinct l.owner_id from public.leads l loop
    select m.organization_id into org from public.organization_members m
    where m.user_id = r.owner_id and m.role = 'owner' order by m.created_at limit 1;
    if org is null then
      insert into public.organizations (name) values ('My agency') returning id into org;
      insert into public.organization_members (organization_id, user_id, role) values (org, r.owner_id, 'owner');
    end if;
    perform public.migrate_legacy_leads_for(r.owner_id, org);
    org := null;
  end loop;
end $$;
