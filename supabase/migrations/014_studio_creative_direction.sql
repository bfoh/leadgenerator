-- Digital Opportunity Finder — lead-to-website Studio: creative direction (milestone 3C.3).
--
-- Phase 2 ends with an approved Brand Kit. This migration stores what phase 3 produces:
--
-- * `studio_creative_briefs` — immutable, numbered Creative Direction Briefs. Every assertion carries
--   its basis (verified fact, business record, approved Brand Kit, creative suggestion, Studio
--   standard or client confirmation) and its evidence.
-- * `studio_creative_brief_reviews` — a person confirms, rejects or notes a brief. Append-only.
-- * `studio_creative_directions` — immutable sets of exactly three concepts, each with its own
--   composition, typography, palette, motion and rationale.
-- * `studio_creative_direction_reviews` — feedback, change requests, approval and rejection.
--   Append-only; an approval names one concept, and an older direction cannot be approved after a
--   newer one.
--
-- The database refuses a direction that cites an unapproved asset, an observation from another
-- concept, a Brand Kit version that was never approved, or three concepts that are really one layout
-- with different colours. The service layer applies the same rules in demo mode.
--
-- Additive and re-runnable. Rollback: supabase/rollback/014_studio_creative_direction_down.sql.

do $$
begin
  if to_regclass('public.studio_brand_kit_approvals') is null then
    raise exception 'Migration 014 needs migration 013; apply it first.';
  end if;
  if to_regprocedure('public.audit_row_change()') is null then
    raise exception 'Migration 014 needs the shared trigger helpers from migration 002.';
  end if;
end $$;

-- ─── Briefs: an argued document, not a mood board ──────────────────────────────────────────────

create table if not exists public.studio_creative_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  version integer not null check (version between 1 and 200),
  content jsonb not null,
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, version),
  unique (id, organization_id),
  unique (id, project_id, organization_id)
);

alter table public.studio_creative_briefs drop constraint if exists studio_creative_briefs_project_fk;
alter table public.studio_creative_briefs add constraint studio_creative_briefs_project_fk
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade;
alter table public.studio_creative_briefs drop constraint if exists studio_creative_briefs_content;
alter table public.studio_creative_briefs add constraint studio_creative_briefs_content check (
  jsonb_typeof(content) = 'object'
  and content ->> 'format' = 'dof-creative-brief/1'
  and jsonb_typeof(content -> 'sections') = 'object'
  and jsonb_typeof(content -> 'missingInformation') = 'array'
  and jsonb_typeof(content -> 'confirmations') = 'array'
  and jsonb_typeof(content -> 'provenance') = 'object'
);

create index if not exists studio_creative_briefs_project_idx on public.studio_creative_briefs(project_id, version desc);

create table if not exists public.studio_creative_brief_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  brief_id uuid not null,
  decision text not null check (decision in ('confirm', 'reject', 'note')),
  note text not null default '' check (char_length(note) <= 1000),
  reviewer_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (brief_id, project_id, organization_id)
    references public.studio_creative_briefs(id, project_id, organization_id) on delete cascade,
  check (decision = 'note' or char_length(btrim(note)) >= 3)
);

create index if not exists studio_creative_brief_reviews_project_idx
  on public.studio_creative_brief_reviews(project_id, created_at desc);

-- ─── Directions: three concepts, three compositions, one immutable record ─────────────────────

create table if not exists public.studio_creative_directions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  brief_id uuid not null,
  version integer not null check (version between 1 and 200),
  content jsonb not null,
  generated_by text not null default 'deterministic' check (generated_by in ('deterministic', 'ai_assisted')),
  derived_from_id uuid,
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, version),
  unique (id, organization_id),
  unique (id, project_id, organization_id),
  foreign key (brief_id, project_id, organization_id)
    references public.studio_creative_briefs(id, project_id, organization_id) on delete cascade,
  foreign key (derived_from_id, project_id, organization_id)
    references public.studio_creative_directions(id, project_id, organization_id) on delete set null
);

alter table public.studio_creative_directions drop constraint if exists studio_creative_directions_content;
alter table public.studio_creative_directions add constraint studio_creative_directions_content check (
  jsonb_typeof(content) = 'object'
  and content ->> 'format' = 'dof-creative-direction/1'
  and jsonb_typeof(content -> 'concepts') = 'array'
  and jsonb_array_length(content -> 'concepts') = 3
  and jsonb_typeof(content -> 'comparison') = 'array'
  and jsonb_typeof(content -> 'limitations') = 'array'
);

create index if not exists studio_creative_directions_project_idx on public.studio_creative_directions(project_id, version desc);
create index if not exists studio_creative_directions_brief_idx on public.studio_creative_directions(brief_id);

create table if not exists public.studio_creative_direction_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  direction_id uuid not null,
  concept_key text not null check (char_length(btrim(concept_key)) between 1 and 80),
  decision text not null check (decision in ('feedback', 'request_changes', 'approve', 'reject')),
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  reviewer_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (direction_id, project_id, organization_id)
    references public.studio_creative_directions(id, project_id, organization_id) on delete cascade
);

create index if not exists studio_creative_direction_reviews_project_idx
  on public.studio_creative_direction_reviews(project_id, created_at desc);

-- ─── Guard: a brief's claims keep their evidence, and versions are numbered ───────────────────

create or replace function public.guard_studio_creative_brief() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  latest integer;
  section jsonb;
  assertion jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_projects p where p.id = old.project_id) then
      return old;
    end if;
    raise exception 'Creative briefs are immutable; write a new version instead.' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) into latest from public.studio_creative_briefs where project_id = new.project_id;
  if new.version <> latest + 1 then
    raise exception 'The next brief version is %, not %.', latest + 1, new.version using errcode = '23514';
  end if;
  for section in select value from jsonb_each(new.content -> 'sections') loop
    if jsonb_typeof(section) <> 'object' or jsonb_typeof(section -> 'assertions') <> 'array' then
      raise exception 'Every brief section needs a summary and a list of assertions.' using errcode = '23514';
    end if;
    for assertion in select value from jsonb_array_elements(section -> 'assertions') loop
      if assertion ->> 'basis' not in ('verified_fact', 'business_record', 'approved_brand_kit',
        'approved_asset', 'creative_suggestion', 'studio_standard', 'client_confirmation') then
        raise exception 'A brief assertion has an unknown basis: %.', assertion ->> 'basis' using errcode = '23514';
      end if;
      if assertion ->> 'basis' = 'verified_fact'
         and jsonb_array_length(coalesce(assertion -> 'evidence' -> 'observationIds', '[]'::jsonb)) = 0 then
        raise exception 'A verified fact must cite an observation.' using errcode = '23514';
      end if;
      if assertion ->> 'basis' = 'business_record'
         and jsonb_array_length(coalesce(assertion -> 'evidence' -> 'record', '[]'::jsonb)) = 0 then
        raise exception 'A business record assertion must name the field it came from.' using errcode = '23514';
      end if;
      if assertion ->> 'basis' = 'approved_brand_kit'
         and assertion -> 'evidence' ->> 'brandKitVersion' is null
         and jsonb_array_length(coalesce(assertion -> 'evidence' -> 'assetIds', '[]'::jsonb)) = 0 then
        raise exception 'An approved Brand Kit claim must name its version or an asset.' using errcode = '23514';
      end if;
      if assertion ->> 'basis' = 'approved_asset'
         and jsonb_array_length(coalesce(assertion -> 'evidence' -> 'assetIds', '[]'::jsonb)) = 0 then
        raise exception 'An approved asset claim must name the file.' using errcode = '23514';
      end if;
    end loop;
  end loop;
  return new;
end $$;

drop trigger if exists studio_creative_briefs_guard on public.studio_creative_briefs;
create trigger studio_creative_briefs_guard before insert or update or delete on public.studio_creative_briefs
  for each row execute function public.guard_studio_creative_brief();

create or replace function public.guard_studio_creative_brief_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  chosen integer;
  latest integer;
  confirmed integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_creative_briefs b where b.id = old.brief_id) then
      return old;
    end if;
    raise exception 'Brief reviews are append-only.' using errcode = '42501';
  end if;
  select version into chosen from public.studio_creative_briefs where id = new.brief_id and project_id = new.project_id;
  if chosen is null then
    raise exception 'The brief does not belong to this concept.' using errcode = '23503';
  end if;
  select max(version) into latest from public.studio_creative_briefs where project_id = new.project_id;
  if new.decision = 'confirm' and chosen < latest then
    raise exception 'Brief version % is newer; confirm that version.', latest using errcode = '23514';
  end if;
  select b.version into confirmed
    from public.studio_creative_brief_reviews r
    join public.studio_creative_briefs b on b.id = r.brief_id
    where r.project_id = new.project_id and r.decision = 'confirm'
    order by r.created_at desc, b.version desc
    limit 1;
  if new.decision = 'confirm' and confirmed is not null and chosen < confirmed then
    raise exception 'Brief version % is older than the confirmed version (%).', chosen, confirmed using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists studio_creative_brief_reviews_guard on public.studio_creative_brief_reviews;
create trigger studio_creative_brief_reviews_guard before insert or update or delete on public.studio_creative_brief_reviews
  for each row execute function public.guard_studio_creative_brief_review();

-- ─── Guard: three concepts that are actually three, built from approved material ──────────────

create or replace function public.guard_studio_creative_direction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  latest integer;
  brief_version integer;
  confirmed integer;
  keys integer;
  families integer;
  motions integer;
  pairings integer;
  grounds integer;
  bad text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_projects p where p.id = old.project_id) then
      return old;
    end if;
    raise exception 'Creative directions are immutable; write a new version instead.' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) into latest from public.studio_creative_directions where project_id = new.project_id;
  if new.version <> latest + 1 then
    raise exception 'The next direction version is %, not %.', latest + 1, new.version using errcode = '23514';
  end if;
  select version into brief_version from public.studio_creative_briefs where id = new.brief_id and project_id = new.project_id;
  if brief_version is null then
    raise exception 'The brief does not belong to this concept.' using errcode = '23503';
  end if;
  select b.version into confirmed
    from public.studio_creative_brief_reviews r
    join public.studio_creative_briefs b on b.id = r.brief_id
    where r.project_id = new.project_id and r.decision = 'confirm'
    order by r.created_at desc, b.version desc
    limit 1;
  if confirmed is null or confirmed <> brief_version then
    raise exception 'Confirm the latest creative brief before proposing directions.' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.studio_brand_kit_approvals ap
    join public.studio_brand_kit_versions v on v.id = ap.version_id
    where v.project_id = new.project_id and v.id::text = new.content ->> 'brandKitVersionId'
  ) then
    raise exception 'The direction must name an approved Brand Kit version for this concept.' using errcode = '23514';
  end if;

  select count(distinct c ->> 'key'),
         count(distinct c -> 'composition' ->> 'family'),
         count(distinct c -> 'motion' ->> 'direction'),
         count(distinct (c -> 'typography' ->> 'displayFontId') || '+' || (c -> 'typography' ->> 'bodyFontId')),
         count(distinct (
           select p ->> 'hex' from jsonb_array_elements(coalesce(c -> 'colour' -> 'palette', '[]'::jsonb)) p
           where p ->> 'role' = 'background' limit 1
         ))
    into keys, families, motions, pairings, grounds
    from jsonb_array_elements(new.content -> 'concepts') c;
  if keys <> 3 or families <> 3 or motions <> 3 or pairings <> 3 or grounds <> 3 then
    raise exception 'Three concepts need distinct keys, compositions, motion directions, pairings and colour grounds.' using errcode = '23514';
  end if;

  for bad in
    select t.value
    from jsonb_array_elements(new.content -> 'concepts') c
    cross join lateral jsonb_array_elements_text(
      coalesce(c -> 'imagery' -> 'assetIds', '[]'::jsonb) || coalesce(c -> 'imagery' -> 'logoAssetIds', '[]'::jsonb)
    ) t(value)
    where t.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (
         select 1 from public.studio_assets a
         where a.id::text = t.value
           and a.project_id = new.project_id
           and a.organization_id = new.organization_id
           and a.status = 'approved'
           and a.prototype_permission in ('granted', 'not_required')
           and (a.licence_expires_on is null or a.licence_expires_on >= current_date)
       )
  loop
    raise exception 'Asset % is not approved, licensed and cleared for prototype use in this concept.', bad using errcode = '23514';
  end loop;

  for bad in
    select t.value
    from jsonb_array_elements(new.content -> 'concepts') c
    cross join lateral jsonb_array_elements_text(coalesce(c -> 'rationale' -> 'evidence' -> 'observationIds', '[]'::jsonb)) t(value)
    where not exists (
      select 1 from public.studio_observations o
      where o.id::text = t.value and o.project_id = new.project_id and o.organization_id = new.organization_id
    )
  loop
    raise exception 'Evidence % is not an observation of this concept.', bad using errcode = '23514';
  end loop;

  if not exists (
    select 1 from jsonb_array_elements(new.content -> 'concepts') c
    where c ->> 'key' = new.content -> 'recommendation' ->> 'conceptKey'
  ) then
    raise exception 'The recommendation must name one of the three concepts.' using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(new.content -> 'limitations', '[]'::jsonb)) < 4 then
    raise exception 'A direction must state at least four limitations.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists studio_creative_directions_guard on public.studio_creative_directions;
create trigger studio_creative_directions_guard before insert or update or delete on public.studio_creative_directions
  for each row execute function public.guard_studio_creative_direction();

create or replace function public.guard_studio_creative_direction_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  chosen integer;
  brief_version integer;
  confirmed integer;
  approved integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_creative_directions d where d.id = old.direction_id) then
      return old;
    end if;
    raise exception 'Direction reviews are append-only.' using errcode = '42501';
  end if;
  select d.version, v.version into chosen, brief_version
    from public.studio_creative_directions d
    join public.studio_creative_briefs v on v.id = d.brief_id
    where d.id = new.direction_id and d.project_id = new.project_id;
  if chosen is null then
    raise exception 'The direction does not belong to this concept.' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.studio_creative_directions d
    where d.id = new.direction_id
      and exists (
        select 1 from jsonb_array_elements(d.content -> 'concepts') c
        where c ->> 'key' = new.concept_key
      )
  ) then
    raise exception 'Concept % is not in this direction.', new.concept_key using errcode = '23514';
  end if;
  if new.decision = 'approve' then
    select b.version into confirmed
      from public.studio_creative_brief_reviews r
      join public.studio_creative_briefs b on b.id = r.brief_id
      where r.project_id = new.project_id and r.decision = 'confirm'
      order by r.created_at desc, b.version desc
      limit 1;
    if confirmed is null or confirmed <> brief_version then
      raise exception 'Confirm the latest creative brief before approving a concept.' using errcode = '23514';
    end if;
    select d.version into approved
      from public.studio_creative_direction_reviews r
      join public.studio_creative_directions d on d.id = r.direction_id
      where r.project_id = new.project_id and r.decision = 'approve'
      order by r.created_at desc
      limit 1;
    if approved is not null and chosen < approved then
      raise exception 'Direction version % is older than the approved version (%).', chosen, approved using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists studio_creative_direction_reviews_guard on public.studio_creative_direction_reviews;
create trigger studio_creative_direction_reviews_guard before insert or update or delete on public.studio_creative_direction_reviews
  for each row execute function public.guard_studio_creative_direction_review();

-- ─── Row Level Security and grants ─────────────────────────────────────────────────────────────
-- Members read; the research and sales roles write; no role may edit or delete history. A concept's
-- deletion cascades at the table-owner level, not through a client policy.

alter table public.studio_creative_briefs enable row level security;
alter table public.studio_creative_brief_reviews enable row level security;
alter table public.studio_creative_directions enable row level security;
alter table public.studio_creative_direction_reviews enable row level security;

drop policy if exists studio_creative_briefs_select on public.studio_creative_briefs;
create policy studio_creative_briefs_select on public.studio_creative_briefs for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_creative_briefs_insert on public.studio_creative_briefs;
create policy studio_creative_briefs_insert on public.studio_creative_briefs for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists studio_creative_brief_reviews_select on public.studio_creative_brief_reviews;
create policy studio_creative_brief_reviews_select on public.studio_creative_brief_reviews for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_creative_brief_reviews_insert on public.studio_creative_brief_reviews;
create policy studio_creative_brief_reviews_insert on public.studio_creative_brief_reviews for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists studio_creative_directions_select on public.studio_creative_directions;
create policy studio_creative_directions_select on public.studio_creative_directions for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_creative_directions_insert on public.studio_creative_directions;
create policy studio_creative_directions_insert on public.studio_creative_directions for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists studio_creative_direction_reviews_select on public.studio_creative_direction_reviews;
create policy studio_creative_direction_reviews_select on public.studio_creative_direction_reviews for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_creative_direction_reviews_insert on public.studio_creative_direction_reviews;
create policy studio_creative_direction_reviews_insert on public.studio_creative_direction_reviews for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

grant select, insert on public.studio_creative_briefs, public.studio_creative_brief_reviews,
  public.studio_creative_directions, public.studio_creative_direction_reviews to authenticated;
grant select, insert, update, delete on public.studio_creative_briefs, public.studio_creative_brief_reviews,
  public.studio_creative_directions, public.studio_creative_direction_reviews to service_role;





