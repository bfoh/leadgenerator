-- Digital Opportunity Finder — lead-to-website Studio: brand intelligence foundation (milestone 3C.1).
--
-- A Studio project is the website concept being built for one prospect. Its evidence is recorded in
-- append-only tables so a concept can always be traced back to what was actually observed:
-- * `studio_projects` — one active concept per business, its brief and the outcome of the last
--   analysis run. Mutable (rename, re-analyse), and audited.
-- * `studio_observations` — every entry from an analysis run, classified as a verified fact, an
--   unknown, a placeholder, a creative suggestion or a restricted reference, with provenance, a
--   confidence score and a reuse permission. Immutable.
-- * `studio_reviews` — a person's decision or note about one entry. Append-only, so a correction is
--   a new review rather than an edit of history.
--
-- No file is downloaded by this design: `asset_url` is a reference to an address the page already
-- publishes, and `asset_kind` may only be set on a restricted entry.
--
-- Additive and re-runnable. Rollback: supabase/rollback/012_studio_brand_intelligence_down.sql.

do $$
begin
  if to_regclass('public.businesses') is null or to_regclass('public.organizations') is null then
    raise exception 'Migration 012 needs migration 002; apply it first.';
  end if;
  if to_regprocedure('public.touch_updated_at()') is null or to_regprocedure('public.audit_row_change()') is null then
    raise exception 'Migration 012 needs the shared trigger helpers from migration 002.';
  end if;
end $$;

-- ─── Studio projects ────────────────────────────────────────────────────────────────────────────

-- A concept is announced on the prospect timeline, so it gets its own activity type.
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in ('note', 'stage_change', 'call',
  'meeting', 'email', 'whatsapp', 'verification', 'report', 'proposal', 'permission', 'project', 'studio', 'system'));

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'intelligence_ready', 'archived')),
  website_url text check (website_url is null or (website_url ~* '^https?://' and char_length(website_url) <= 2000)),
  brief text not null default '' check (char_length(brief) <= 5000),
  intelligence_status text not null default 'not_started' check (intelligence_status in ('not_started', 'ready', 'unavailable')),
  intelligence_at timestamptz,
  intelligence_note text check (intelligence_note is null or char_length(intelligence_note) <= 2000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  -- Deleting a business removes the concepts built for it. The evidence keeps its own history only
  -- while the project exists, which is what the delete guards below rely on.
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  -- A recorded analysis outcome always says when it happened.
  constraint studio_project_analysis_stamped check (intelligence_status = 'not_started' or intelligence_at is not null)
);

-- One live concept per business. An archived concept stays for reference and does not block a new one.
create unique index if not exists studio_projects_business_uidx
  on public.studio_projects(organization_id, business_id)
  where status <> 'archived';
create index if not exists studio_projects_org_idx on public.studio_projects(organization_id, updated_at desc);
create index if not exists studio_projects_business_idx on public.studio_projects(business_id);

drop trigger if exists studio_projects_touch on public.studio_projects;
create trigger studio_projects_touch before update on public.studio_projects
  for each row execute function public.touch_updated_at();
drop trigger if exists studio_projects_creator on public.studio_projects;
create trigger studio_projects_creator before insert on public.studio_projects
  for each row execute function public.stamp_creator();
drop trigger if exists studio_projects_audit on public.studio_projects;
create trigger studio_projects_audit after insert or update or delete on public.studio_projects
  for each row execute function public.audit_row_change();

-- ─── Evidence: append-only ─────────────────────────────────────────────────────────────────────

create table if not exists public.studio_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  run_number smallint not null default 1 check (run_number between 1 and 100),
  key text not null check (char_length(btrim(key)) between 1 and 80),
  classification text not null check (classification in
    ('verified_fact', 'unknown', 'placeholder', 'creative_suggestion', 'restricted')),
  category text not null check (category in
    ('identity', 'logo', 'imagery', 'palette', 'typography', 'content', 'navigation', 'contact',
     'commerce', 'accessibility', 'platform', 'restriction')),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  detail text check (detail is null or char_length(detail) <= 2000),
  confidence smallint not null check (confidence between 0 and 100),
  reuse_permission text not null check (reuse_permission in ('unknown', 'reference_only', 'permitted', 'prohibited')),
  source_kind text not null check (source_kind in ('website_page', 'search_result', 'person', 'system')),
  source_url text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 2000)),
  asset_url text check (asset_url is null or (asset_url ~* '^https?://' and char_length(asset_url) <= 2000)),
  asset_kind text check (asset_kind is null or asset_kind in ('logo', 'icon', 'favicon', 'image')),
  observed_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, project_id, organization_id),
  unique (project_id, run_number, key),
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade,
  -- A reference and its kind travel together.
  constraint studio_observation_asset_pair check ((asset_url is null) = (asset_kind is null)),
  -- Only a restricted entry may point at someone else's file. Nothing is downloaded.
  constraint studio_observation_asset_restricted check (asset_kind is null or classification = 'restricted'),
  -- Our suggestions are never attributed to the page.
  constraint studio_observation_suggestion_source check (classification <> 'creative_suggestion' or source_kind = 'system'),
  -- Page-derived evidence keeps its provenance.
  constraint studio_observation_page_provenance check (
    classification not in ('verified_fact', 'placeholder', 'restricted') or source_url is not null
  )
);

create index if not exists studio_observations_project_idx on public.studio_observations(project_id, run_number desc, classification);
create index if not exists studio_observations_org_idx on public.studio_observations(organization_id, observed_at desc);

-- Evidence cannot be edited, and can only be deleted once the project it belongs to has gone (a
-- cascade from the project or the business). That keeps the history honest without making a business
-- undeletable.
create or replace function public.guard_studio_observation_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Studio evidence is append-only; record a review instead.' using errcode = '42501';
  end if;
  if exists (select 1 from public.studio_projects p where p.id = old.project_id) then
    raise exception 'Studio evidence is append-only; delete the project instead.' using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists studio_observations_append_only on public.studio_observations;
create trigger studio_observations_append_only before update or delete on public.studio_observations
  for each row execute function public.guard_studio_observation_append_only();


-- ─── Reviews: append-only decisions about evidence ─────────────────────────────────────────────

create table if not exists public.studio_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  observation_id uuid,
  decision text not null check (decision in ('confirm', 'reject', 'note')),
  note text not null default '' check (char_length(note) <= 1000),
  reviewer_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade,
  -- The observation must belong to the project the review is filed against, in the same organization.
  foreign key (observation_id, project_id, organization_id)
    references public.studio_observations(id, project_id, organization_id) on delete cascade,
  -- Every decision except a plain confirmation carries a short reason.
  constraint studio_review_note_required check (decision = 'confirm' or char_length(btrim(note)) >= 3)
);

create index if not exists studio_reviews_project_idx on public.studio_reviews(project_id, created_at desc);
create index if not exists studio_reviews_observation_idx on public.studio_reviews(observation_id, created_at desc);
create index if not exists studio_reviews_org_idx on public.studio_reviews(organization_id, created_at desc);

create or replace function public.guard_studio_review_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Studio reviews are append-only; add another review instead.' using errcode = '42501';
  end if;
  if exists (select 1 from public.studio_projects p where p.id = old.project_id) then
    raise exception 'Studio reviews are append-only; delete the project instead.' using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists studio_reviews_append_only on public.studio_reviews;
create trigger studio_reviews_append_only before update or delete on public.studio_reviews
  for each row execute function public.guard_studio_review_append_only();

-- ─── Row Level Security and grants ───────────────────────────────────────────────────────────────
-- Same shape as the rest of the workspace model (migration 002): members read, the research and sales
-- roles write the concept, owners and admins delete it. Evidence and reviews are insert-only at the
-- privilege level as well as in the triggers above, so history is append-only by construction.

alter table public.studio_projects enable row level security;
alter table public.studio_observations enable row level security;
alter table public.studio_reviews enable row level security;

drop policy if exists studio_projects_select on public.studio_projects;
create policy studio_projects_select on public.studio_projects for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_projects_insert on public.studio_projects;
create policy studio_projects_insert on public.studio_projects for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_projects_update on public.studio_projects;
create policy studio_projects_update on public.studio_projects for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_projects_delete on public.studio_projects;
create policy studio_projects_delete on public.studio_projects for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists studio_observations_select on public.studio_observations;
create policy studio_observations_select on public.studio_observations for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_observations_insert on public.studio_observations;
create policy studio_observations_insert on public.studio_observations for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists studio_reviews_select on public.studio_reviews;
create policy studio_reviews_select on public.studio_reviews for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_reviews_insert on public.studio_reviews;
create policy studio_reviews_insert on public.studio_reviews for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

revoke all on public.studio_projects, public.studio_observations, public.studio_reviews from anon, authenticated;
grant select, insert, update, delete on public.studio_projects to authenticated;
grant select, insert on public.studio_observations, public.studio_reviews to authenticated;
grant select, insert, update, delete
  on public.studio_projects, public.studio_observations, public.studio_reviews to service_role;

