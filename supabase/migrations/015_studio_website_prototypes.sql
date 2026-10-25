-- Digital Opportunity Finder — lead-to-website Studio: rendered website prototypes (milestone 3C.4).
--
-- Phase 4 turns one approved Creative Direction concept into a versioned website blueprint and a
-- rendered prototype. This migration stores those blueprints as immutable versions:
--
-- * `studio_website_prototypes` — a numbered blueprint for one project, bound to the approved
--   direction, concept and Brand Kit. The JSON is the same schema the trusted React renderer reads;
--   no generated code, HTML, CSS or script is stored.
--
-- The database refuses a prototype unless the direction's latest decisive review is an approval for
-- the same concept. It also refuses a prototype whose content is bound to a different direction,
-- project or format, and it numbers versions without gaps.
--
-- Additive and re-runnable. Rollback: supabase/rollback/015_studio_website_prototypes_down.sql.

do $$
begin
  if to_regclass('public.studio_creative_directions') is null then
    raise exception 'Migration 015 needs migration 014; apply it first.';
  end if;
  if to_regprocedure('public.audit_row_change()') is null then
    raise exception 'Migration 015 needs the shared trigger helpers from migration 002.';
  end if;
end $$;

create table if not exists public.studio_website_prototypes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  direction_id uuid not null,
  concept_key text not null check (char_length(btrim(concept_key)) between 1 and 80),
  version integer not null check (version between 1 and 200),
  content jsonb not null,
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, version),
  unique (id, organization_id),
  unique (id, project_id, organization_id),
  foreign key (project_id, organization_id)
    references public.studio_projects(id, organization_id) on delete cascade,
  foreign key (direction_id, project_id, organization_id)
    references public.studio_creative_directions(id, project_id, organization_id) on delete cascade
);

alter table public.studio_website_prototypes drop constraint if exists studio_website_prototypes_content;
alter table public.studio_website_prototypes add constraint studio_website_prototypes_content check (
  jsonb_typeof(content) = 'object'
  and content ->> 'format' = 'dof-website-blueprint/1'
  and jsonb_typeof(content -> 'pages') = 'array'
  and jsonb_array_length(content -> 'pages') >= 3
  and jsonb_typeof(content -> 'assets') = 'array'
  and jsonb_typeof(content -> 'readiness') = 'object'
  and content -> 'readiness' ->> 'publishReady' = 'false'
  and jsonb_typeof(content -> 'disclosures') = 'array'
);

create index if not exists studio_website_prototypes_project_idx
  on public.studio_website_prototypes(project_id, version desc);
create index if not exists studio_website_prototypes_direction_idx
  on public.studio_website_prototypes(direction_id);

-- ─── Guard: immutable versions, an actual approval, and the right binding ──────────────────────

create or replace function public.guard_studio_website_prototype() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  latest integer;
  direction_version integer;
  approved_direction uuid;
  approved_concept text;
  latest_decision text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_projects p where p.id = old.project_id) then
      return old;
    end if;
    raise exception 'Website prototypes are immutable; save a new version instead.' using errcode = '42501';
  end if;

  select coalesce(max(version), 0) into latest
    from public.studio_website_prototypes
    where project_id = new.project_id;
  if new.version <> latest + 1 then
    raise exception 'The next prototype version is %, not %.', latest + 1, new.version using errcode = '23514';
  end if;

  select version into direction_version
    from public.studio_creative_directions
    where id = new.direction_id and project_id = new.project_id;
  if direction_version is null then
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

  select r.direction_id, r.concept_key, r.decision
    into approved_direction, approved_concept, latest_decision
    from public.studio_creative_direction_reviews r
    where r.project_id = new.project_id
    order by r.created_at desc, r.id desc
    limit 1;

  if latest_decision is distinct from 'approve'
     or approved_direction is distinct from new.direction_id
     or approved_concept is distinct from new.concept_key then
    raise exception 'Rendered prototypes need a current approval for this concept.' using errcode = '23514';
  end if;

  if new.content -> 'direction' ->> 'directionId' is distinct from new.direction_id::text
     or (new.content -> 'direction' ->> 'directionVersion')::integer is distinct from direction_version
     or new.content -> 'direction' ->> 'conceptKey' is distinct from new.concept_key
     or new.content -> 'studio' ->> 'projectId' is distinct from new.project_id::text then
    raise exception 'The blueprint is not bound to this direction, concept and project.' using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists studio_website_prototypes_guard on public.studio_website_prototypes;
create trigger studio_website_prototypes_guard before insert or update or delete on public.studio_website_prototypes
  for each row execute function public.guard_studio_website_prototype();

-- ─── Row Level Security and grants ─────────────────────────────────────────────────────────────

alter table public.studio_website_prototypes enable row level security;

drop policy if exists studio_website_prototypes_select on public.studio_website_prototypes;
create policy studio_website_prototypes_select on public.studio_website_prototypes for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists studio_website_prototypes_insert on public.studio_website_prototypes;
create policy studio_website_prototypes_insert on public.studio_website_prototypes for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

grant select, insert on public.studio_website_prototypes to authenticated;
grant select, insert, update, delete on public.studio_website_prototypes to service_role;
