-- Digital Opportunity Finder — lead-to-website Studio: business asset vault and Brand Kit (milestone 3C.2).
--
-- A Studio concept can only use files it is entitled to use. This migration adds the vault that holds
-- those files as records, the private bucket that holds their bytes, an append-only history of every
-- decision, a ledger for remote references that must never be imported, and a versioned Brand Kit that
-- later phases (creative direction, build, presentation) consume.
--
-- * `studio_assets` — one stored file: kind, status, provenance, licence, five separate permissions
--   (inspect, store, prototype, export, publish), checksum and a private path. Mutable, audited.
-- * `studio_asset_events` — upload, annotation, approval, rejection, revocation, replacement. Append-only.
-- * `studio_asset_references` — someone else's material, recorded as an address and a note. Never a file.
-- * `studio_brand_kits` / `_versions` / `_approvals` — structured Brand Kit content, immutable once
--   written; approval is its own append-only row, so the approved content can always be reconstructed.
--
-- No remote file is fetched. `storage_path` points into the private `studio-assets` bucket, and the
-- storage policies below authorise it with the same membership and role rules as the tables.
--
-- Additive and re-runnable. Rollback: supabase/rollback/013_studio_asset_vault_down.sql.

do $$
begin
  if to_regclass('public.studio_projects') is null then
    raise exception 'Migration 013 needs migration 012; apply it first.';
  end if;
  if to_regprocedure('public.touch_updated_at()') is null or to_regprocedure('public.audit_row_change()') is null then
    raise exception 'Migration 013 needs the shared trigger helpers from migration 002.';
  end if;
end $$;

-- ─── Assets: one stored file, one provenance, five permissions ──────────────────────────────────

create table if not exists public.studio_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  kind text not null check (kind in ('logo', 'brand_mark', 'product_photo', 'venue_photo', 'licensed_image',
    'illustration', 'brand_document', 'video', 'typography_reference', 'other')),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected', 'revoked', 'superseded')),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'video/mp4', 'font/woff', 'font/woff2', 'font/ttf', 'font/otf')),
  bytes bigint not null check (bytes between 1 and 26214400),
  width integer check (width is null or width between 1 and 12000),
  height integer check (height is null or height between 1 and 12000),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  origin text not null check (origin in ('our_work', 'client_supplied', 'licensed', 'commissioned', 'third_party')),
  owner_name text not null check (char_length(btrim(owner_name)) between 2 and 200),
  supplier text check (supplier is null or char_length(supplier) <= 200),
  source_url text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 2000)),
  licence_name text check (licence_name is null or char_length(licence_name) <= 200),
  licence_reference text check (licence_reference is null or char_length(licence_reference) <= 500),
  licence_expires_on date,
  attribution_required boolean not null default false,
  attribution_text text check (attribution_text is null or char_length(attribution_text) <= 400),
  permission_evidence text not null check (char_length(btrim(permission_evidence)) between 10 and 1000),
  inspect_permission text not null default 'unknown' check (inspect_permission in ('unknown', 'granted', 'denied', 'not_required')),
  store_permission text not null default 'unknown' check (store_permission in ('unknown', 'granted', 'denied', 'not_required')),
  prototype_permission text not null default 'unknown' check (prototype_permission in ('unknown', 'granted', 'denied', 'not_required')),
  export_permission text not null default 'unknown' check (export_permission in ('unknown', 'granted', 'denied', 'not_required')),
  publish_permission text not null default 'unknown' check (publish_permission in ('unknown', 'granted', 'denied', 'not_required')),
  note text not null default '' check (char_length(note) <= 2000),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejected_reason text check (rejected_reason is null or char_length(rejected_reason) <= 1000),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 1000),
  supersedes_id uuid references public.studio_assets(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, project_id, organization_id),
  unique (project_id, storage_path)
);

-- Constraints are added separately so an interrupted run can be repeated safely.
alter table public.studio_assets drop constraint if exists studio_assets_project_fk;
alter table public.studio_assets add constraint studio_assets_project_fk
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade;
alter table public.studio_assets drop constraint if exists studio_asset_path_tenant;
alter table public.studio_assets add constraint studio_asset_path_tenant check (
  storage_path like organization_id::text || '/%'
  and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9._-]+$'
  and storage_path not like '%..%'
);
alter table public.studio_assets drop constraint if exists studio_asset_kind_file;
alter table public.studio_assets add constraint studio_asset_kind_file check (
  (kind in ('logo', 'brand_mark', 'product_photo', 'venue_photo', 'licensed_image', 'illustration') and mime_type like 'image/%')
  or (kind = 'brand_document' and mime_type in ('application/pdf', 'text/plain'))
  or (kind = 'video' and mime_type = 'video/mp4')
  or (kind = 'typography_reference' and mime_type like 'font/%')
  or kind = 'other'
);
alter table public.studio_assets drop constraint if exists studio_asset_dimensions;
alter table public.studio_assets add constraint studio_asset_dimensions check ((width is null) = (height is null));
alter table public.studio_assets drop constraint if exists studio_asset_permission_logic;
alter table public.studio_assets add constraint studio_asset_permission_logic check (
  store_permission <> 'denied'
  or (prototype_permission <> 'granted' and export_permission <> 'granted' and publish_permission <> 'granted')
);
alter table public.studio_assets drop constraint if exists studio_asset_attribution;
alter table public.studio_assets add constraint studio_asset_attribution check (not attribution_required or attribution_text is not null);
alter table public.studio_assets drop constraint if exists studio_asset_approved;
alter table public.studio_assets add constraint studio_asset_approved check (status <> 'approved' or approved_at is not null);
alter table public.studio_assets drop constraint if exists studio_asset_rejected;
alter table public.studio_assets add constraint studio_asset_rejected check (status <> 'rejected' or (rejected_at is not null and char_length(btrim(rejected_reason)) >= 3));
alter table public.studio_assets drop constraint if exists studio_asset_revoked;
alter table public.studio_assets add constraint studio_asset_revoked check (status <> 'revoked' or (revoked_at is not null and char_length(btrim(revoked_reason)) >= 3));
alter table public.studio_assets drop constraint if exists studio_asset_licence_current;
alter table public.studio_assets add constraint studio_asset_licence_current check (
  status <> 'approved' or licence_expires_on is null or licence_expires_on >= current_date
);

create index if not exists studio_assets_project_idx on public.studio_assets(project_id, status, kind);
create index if not exists studio_assets_org_idx on public.studio_assets(organization_id, created_at desc);
create index if not exists studio_assets_licence_idx on public.studio_assets(organization_id, licence_expires_on);

drop trigger if exists studio_assets_touch on public.studio_assets;
create trigger studio_assets_touch before update on public.studio_assets
  for each row execute function public.touch_updated_at();
drop trigger if exists studio_assets_audit on public.studio_assets;
create trigger studio_assets_audit after insert or update or delete on public.studio_assets
  for each row execute function public.audit_row_change();

-- ─── Asset events: append-only history of every decision ────────────────────────────────────────

create table if not exists public.studio_asset_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  asset_id uuid not null,
  action text not null check (action in ('uploaded', 'annotated', 'approved', 'rejected', 'revoked', 'replaced')),
  note text check (note is null or char_length(note) <= 1000),
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  -- The event's asset and project must agree, so history cannot be filed against another concept.
  foreign key (asset_id, project_id, organization_id) references public.studio_assets(id, project_id, organization_id) on delete cascade,
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade
);

create index if not exists studio_asset_events_asset_idx on public.studio_asset_events(asset_id, created_at desc);
create index if not exists studio_asset_events_project_idx on public.studio_asset_events(project_id, created_at desc);

create or replace function public.guard_studio_asset_event_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Asset history is append-only; add another event instead.' using errcode = '42501';
  end if;
  if exists (select 1 from public.studio_assets a where a.id = old.asset_id) then
    raise exception 'Asset history is append-only; delete the asset instead.' using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists studio_asset_events_append_only on public.studio_asset_events;
create trigger studio_asset_events_append_only before update or delete on public.studio_asset_events
  for each row execute function public.guard_studio_asset_event_append_only();


-- ─── Remote references: recorded, never imported ───────────────────────────────────────────────
-- A Google Maps photo or an Instagram post is somebody else's material. The Studio remembers the
-- address, what it showed and where the pointer came from, and offers no way to fetch or display it.

create table if not exists public.studio_asset_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  address text not null check (address ~* '^https?://' and char_length(address) <= 2000),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  source text not null check (source in ('client_statement', 'public_page', 'social_profile', 'platform_listing')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'recorded' check (status in ('recorded', 'declined')),
  recorded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (project_id, address),
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade
);

create index if not exists studio_asset_references_project_idx on public.studio_asset_references(project_id, created_at desc);

drop trigger if exists studio_asset_references_touch on public.studio_asset_references;
create trigger studio_asset_references_touch before update on public.studio_asset_references
  for each row execute function public.touch_updated_at();

-- ─── Brand Kit: structured, versioned, approved by a person ─────────────────────────────────────

create table if not exists public.studio_brand_kits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  unique (id, organization_id),
  unique (id, project_id, organization_id),
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade
);

drop trigger if exists studio_brand_kits_touch on public.studio_brand_kits;
create trigger studio_brand_kits_touch before update on public.studio_brand_kits
  for each row execute function public.touch_updated_at();
drop trigger if exists studio_brand_kits_audit on public.studio_brand_kits;
create trigger studio_brand_kits_audit after insert or update or delete on public.studio_brand_kits
  for each row execute function public.audit_row_change();

create table if not exists public.studio_brand_kit_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  kit_id uuid not null,
  version integer not null check (version between 1 and 1000),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (kit_id, version),
  unique (id, kit_id, organization_id),
  unique (id, project_id, organization_id),
  foreign key (kit_id, project_id, organization_id) references public.studio_brand_kits(id, project_id, organization_id) on delete cascade
);

create index if not exists studio_brand_kit_versions_kit_idx on public.studio_brand_kit_versions(kit_id, version desc);


-- The shape is checked in the database as well as in the service: every referenced file must be an
-- approved asset of this concept, so a kit cannot smuggle in a rejected or foreign file.
create or replace function public.guard_studio_brand_kit_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bad text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- A cascade from the kit or the concept is allowed; editing history is not.
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_brand_kits k where k.id = old.kit_id) then
      return old;
    end if;
    raise exception 'Brand Kit versions are immutable; write a new version instead.' using errcode = '42501';
  end if;
  if jsonb_typeof(new.content -> 'logoAssetIds') is distinct from 'array'
     or jsonb_typeof(new.content -> 'palette') is distinct from 'array'
     or jsonb_typeof(new.content -> 'typography') is distinct from 'array'
     or jsonb_typeof(new.content -> 'photographyAssetIds') is distinct from 'array'
     or jsonb_typeof(new.content -> 'personality') is distinct from 'array'
     or jsonb_typeof(new.content -> 'visualDirection') is distinct from 'string'
     or jsonb_typeof(new.content -> 'toneOfVoice') is distinct from 'object' then
    raise exception 'A Brand Kit version needs logos, a palette, typography, photography, personality, visual direction and tone of voice.' using errcode = '23514';
  end if;
  for bad in
    select t.value from jsonb_array_elements_text(new.content -> 'logoAssetIds') as t(value)
    left join public.studio_assets a
      on a.id::text = t.value and a.project_id = new.project_id and a.organization_id = new.organization_id and a.status = 'approved'
    where a.id is null
  loop
    raise exception 'Logo % is not an approved asset of this concept.', bad using errcode = '23514';
  end loop;
  for bad in
    select t.value from jsonb_array_elements_text(new.content -> 'photographyAssetIds') as t(value)
    left join public.studio_assets a
      on a.id::text = t.value and a.project_id = new.project_id and a.organization_id = new.organization_id and a.status = 'approved'
    where a.id is null
  loop
    raise exception 'Photograph % is not an approved asset of this concept.', bad using errcode = '23514';
  end loop;
  return new;
end $$;

drop trigger if exists studio_brand_kit_versions_guard on public.studio_brand_kit_versions;
create trigger studio_brand_kit_versions_guard before insert or update or delete on public.studio_brand_kit_versions
  for each row execute function public.guard_studio_brand_kit_version();

-- Approval is its own append-only row, so the approved content is reconstructible and a later change
-- cannot rewrite what the client saw. A version older than the current approval cannot be re-approved.
create table if not exists public.studio_brand_kit_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  kit_id uuid not null,
  version_id uuid not null,
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  approved_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_at timestamptz not null default now(),
  unique (version_id),
  unique (id, organization_id),
  foreign key (version_id, kit_id, organization_id) references public.studio_brand_kit_versions(id, kit_id, organization_id) on delete cascade,
  foreign key (kit_id, project_id, organization_id) references public.studio_brand_kits(id, project_id, organization_id) on delete cascade
);

create index if not exists studio_brand_kit_approvals_kit_idx on public.studio_brand_kit_approvals(kit_id, approved_at desc);

create or replace function public.guard_studio_brand_kit_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  latest integer;
  chosen integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studio_brand_kits k where k.id = old.kit_id) then
      return old;
    end if;
    raise exception 'Brand Kit approvals are append-only; approve a newer version instead.' using errcode = '42501';
  end if;
  select version into chosen from public.studio_brand_kit_versions where id = new.version_id;
  select v.version into latest
    from public.studio_brand_kit_approvals ap
    join public.studio_brand_kit_versions v on v.id = ap.version_id
    where ap.kit_id = new.kit_id
    order by ap.approved_at desc, v.version desc
    limit 1;
  if latest is not null and chosen < latest then
    raise exception 'Version % is older than the approved version (%). Approve a newer version.', chosen, latest using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists studio_brand_kit_approvals_guard on public.studio_brand_kit_approvals;
create trigger studio_brand_kit_approvals_guard before insert or update or delete on public.studio_brand_kit_approvals
  for each row execute function public.guard_studio_brand_kit_approval();


-- ─── Row Level Security and grants ──────────────────────────────────────────────────────────────
-- The same shape as migration 012: members read, the research and sales roles write, owners and
-- admins delete. History tables are insert-only at the privilege level as well as in their triggers.

alter table public.studio_assets enable row level security;
alter table public.studio_asset_events enable row level security;
alter table public.studio_asset_references enable row level security;
alter table public.studio_brand_kits enable row level security;
alter table public.studio_brand_kit_versions enable row level security;
alter table public.studio_brand_kit_approvals enable row level security;

drop policy if exists studio_assets_select on public.studio_assets;
create policy studio_assets_select on public.studio_assets for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_assets_insert on public.studio_assets;
create policy studio_assets_insert on public.studio_assets for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_assets_update on public.studio_assets;
create policy studio_assets_update on public.studio_assets for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_assets_delete on public.studio_assets;
create policy studio_assets_delete on public.studio_assets for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists studio_asset_events_select on public.studio_asset_events;
create policy studio_asset_events_select on public.studio_asset_events for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_asset_events_insert on public.studio_asset_events;
create policy studio_asset_events_insert on public.studio_asset_events for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists studio_asset_references_select on public.studio_asset_references;
create policy studio_asset_references_select on public.studio_asset_references for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_asset_references_insert on public.studio_asset_references;
create policy studio_asset_references_insert on public.studio_asset_references for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_asset_references_update on public.studio_asset_references;
create policy studio_asset_references_update on public.studio_asset_references for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_asset_references_delete on public.studio_asset_references;
create policy studio_asset_references_delete on public.studio_asset_references for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));


drop policy if exists studio_brand_kits_select on public.studio_brand_kits;
create policy studio_brand_kits_select on public.studio_brand_kits for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_brand_kits_insert on public.studio_brand_kits;
create policy studio_brand_kits_insert on public.studio_brand_kits for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_brand_kits_update on public.studio_brand_kits;
create policy studio_brand_kits_update on public.studio_brand_kits for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists studio_brand_kits_delete on public.studio_brand_kits;
create policy studio_brand_kits_delete on public.studio_brand_kits for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists studio_brand_kit_versions_select on public.studio_brand_kit_versions;
create policy studio_brand_kit_versions_select on public.studio_brand_kit_versions for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_brand_kit_versions_insert on public.studio_brand_kit_versions;
create policy studio_brand_kit_versions_insert on public.studio_brand_kit_versions for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

drop policy if exists studio_brand_kit_approvals_select on public.studio_brand_kit_approvals;
create policy studio_brand_kit_approvals_select on public.studio_brand_kit_approvals for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists studio_brand_kit_approvals_insert on public.studio_brand_kit_approvals;
create policy studio_brand_kit_approvals_insert on public.studio_brand_kit_approvals for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));

revoke all on public.studio_assets, public.studio_asset_events, public.studio_asset_references,
  public.studio_brand_kits, public.studio_brand_kit_versions, public.studio_brand_kit_approvals
  from anon, authenticated;
grant select, insert, update, delete on public.studio_assets to authenticated;

-- ─── Private storage ──────────────────────────────────────────────────────────────────────────
-- One bucket, never public. The first path segment is the organization, so every object is judged by
-- the same membership and role rules as its row. The bucket also enforces the size and type limits,
-- so a client that bypasses the app still cannot store an SVG, an HTML page or a 500 MB file.
-- Guarded so the migration can run against a database without Supabase Storage (the PGlite tests).

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('studio-assets', 'studio-assets', false, 26214400, array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain',
    'video/mp4', 'font/woff', 'font/woff2', 'font/ttf', 'font/otf'
  ])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $policy$ drop policy if exists studio_assets_storage_read on storage.objects $policy$;
  execute $policy$
    create policy studio_assets_storage_read on storage.objects for select to authenticated
    using (
      bucket_id = 'studio-assets'
      and public.is_org_member(case
        when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid
      end)
    )
  $policy$;

  execute $policy$ drop policy if exists studio_assets_storage_insert on storage.objects $policy$;
  execute $policy$
    create policy studio_assets_storage_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'studio-assets'
      and public.has_org_role(case
        when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid
      end, array['owner', 'admin', 'researcher', 'sales'])
    )
  $policy$;

  execute $policy$ drop policy if exists studio_assets_storage_update on storage.objects $policy$;
  execute $policy$
    create policy studio_assets_storage_update on storage.objects for update to authenticated
    using (
      bucket_id = 'studio-assets'
      and public.has_org_role(case
        when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid
      end, array['owner', 'admin', 'researcher', 'sales'])
    )
    with check (
      bucket_id = 'studio-assets'
      and public.has_org_role(case
        when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid
      end, array['owner', 'admin', 'researcher', 'sales'])
    )
  $policy$;

  execute $policy$ drop policy if exists studio_assets_storage_delete on storage.objects $policy$;
  execute $policy$
    create policy studio_assets_storage_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'studio-assets'
      and public.has_org_role(case
        when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid
      end, array['owner', 'admin'])
    )
  $policy$;
end $$;

grant select, insert on public.studio_asset_events, public.studio_brand_kit_versions, public.studio_brand_kit_approvals to authenticated;
grant select, insert, update, delete on public.studio_asset_references, public.studio_brand_kits to authenticated;
grant select, insert, update, delete on public.studio_assets, public.studio_asset_events, public.studio_asset_references,
  public.studio_brand_kits, public.studio_brand_kit_versions, public.studio_brand_kit_approvals to service_role;

