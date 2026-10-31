-- Digital Opportunity Finder — visual asset acquisition (milestone 4).
--
-- Reference images found on a business's own verified website are recorded here before anything is
-- fetched: an address, what the page says it shows, and a rights state that starts at
-- `not_established`. Only a person can move a candidate to `imported`, after recording a rights basis
-- and evidence; the file itself then lives in the existing `studio_assets` vault, so approval, export
-- eligibility and the private bucket keep their established rules. Google and social-platform
-- addresses are refused at this boundary, not just in the interface.
--
-- * `visual_asset_candidates` — discovery and rights decisions. Discovery fields are immutable.
-- * `visual_asset_candidate_events` — append-only history of each decision.
--
-- Additive and re-runnable. Rollback: supabase/rollback/020_visual_asset_acquisition_down.sql.

do $$
begin
  if to_regclass('public.studio_assets') is null then
    raise exception 'Migration 020 needs migration 013; apply it first.';
  end if;
  if to_regprocedure('public.audit_row_change()') is null then
    raise exception 'Migration 020 needs the shared trigger helpers from migration 002.';
  end if;
end $$;

create table if not exists public.visual_asset_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  project_id uuid not null,
  page_url text not null check (char_length(page_url) <= 2000 and page_url ~* '^https?://'),
  -- The same Google/social exclusion as the independent resource ledger: a preview is not a licence.
  image_url text not null check (char_length(image_url) <= 2000 and image_url ~* '^https?://' and image_url !~* '^https?://([^/]*@)?([^/]*\.)?(google\.[a-z.]+|googleapis\.com|googleusercontent\.com|gstatic\.com|goo\.gl|ggpht\.com|business\.site|facebook\.com|fbcdn\.net|instagram\.com|cdninstagram\.com|tiktok\.com|linkedin\.com|x\.com|twitter\.com)([:/]|$)'),
  source_kind text not null check (source_kind in ('official_site', 'third_party_reference')),
  image_type text not null check (image_type in ('logo', 'brand_mark', 'hero', 'gallery', 'exterior', 'interior', 'rooms', 'product', 'staff', 'other')),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  attribution text check (attribution is null or char_length(attribution) <= 300),
  relevance text not null check (char_length(btrim(relevance)) between 5 and 500),
  rights_basis text not null default 'not_established' check (rights_basis in ('not_established', 'business_owned_website', 'written_permission', 'licensed_stock')),
  rights_evidence text check (rights_evidence is null or char_length(rights_evidence) <= 1000),
  status text not null default 'reference_only' check (status in ('reference_only', 'imported', 'rejected')),
  asset_id uuid,
  imported_via text check (imported_via is null or imported_via in ('downloaded', 'uploaded')),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz,
  request_note text check (request_note is null or char_length(request_note) <= 1000),
  reviewed_by text check (reviewed_by is null or char_length(reviewed_by) <= 200),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, business_id, image_url),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (project_id, organization_id) references public.studio_projects(id, organization_id) on delete cascade
);
create index if not exists visual_candidates_business_idx on public.visual_asset_candidates(organization_id, business_id, created_at desc);
create index if not exists visual_candidates_project_idx on public.visual_asset_candidates(organization_id, project_id);
-- A third-party reference never claims a downloaded copy: its bytes can only arrive as an uploaded
-- original, which the service records separately.
alter table public.visual_asset_candidates drop constraint if exists visual_candidates_reference_only_check;
alter table public.visual_asset_candidates add constraint visual_candidates_reference_only_check
  check (source_kind = 'official_site' or status = 'reference_only' or imported_via = 'uploaded');
alter table public.visual_asset_candidates drop constraint if exists visual_candidates_import_check;
alter table public.visual_asset_candidates add constraint visual_candidates_import_check
  check (status <> 'imported' or (asset_id is not null and checksum_sha256 is not null and imported_via is not null));

create table if not exists public.visual_asset_candidate_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null,
  action text not null check (action in ('discovered', 'imported', 'authorization_requested', 'rejected', 'approved')),
  note text check (note is null or char_length(note) <= 1000),
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id) references public.visual_asset_candidates(id, organization_id) on delete cascade
);
create index if not exists visual_candidate_events_candidate_idx on public.visual_asset_candidate_events(organization_id, candidate_id, created_at);

-- Discovery fields identify the file and its source. Changing them after the fact would rewrite what
-- was authorized, so only rights, review and storage link fields may move, and a rejection is final.
create or replace function public.guard_visual_candidate_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'rights_basis' - 'rights_evidence' - 'status' - 'asset_id' - 'imported_via' - 'checksum_sha256'
        - 'requested_at' - 'request_note' - 'reviewed_by' - 'reviewed_at' - 'review_note' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'rights_basis' - 'rights_evidence' - 'status' - 'asset_id' - 'imported_via' - 'checksum_sha256'
        - 'requested_at' - 'request_note' - 'reviewed_by' - 'reviewed_at' - 'review_note' - 'updated_at') then
    raise exception 'A candidate’s source and discovery fields are immutable; record a new candidate instead.' using errcode = '42501';
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'A rejected candidate stays rejected.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists visual_candidate_guard on public.visual_asset_candidates;
create trigger visual_candidate_guard before update on public.visual_asset_candidates
  for each row execute function public.guard_visual_candidate_update();
drop trigger if exists visual_candidate_audit on public.visual_asset_candidates;
create trigger visual_candidate_audit after insert or update or delete on public.visual_asset_candidates
  for each row execute function public.audit_row_change();

create or replace function public.guard_visual_candidate_event() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Candidate events are append-only.' using errcode = '42501';
end $$;
drop trigger if exists visual_candidate_event_guard on public.visual_asset_candidate_events;
create trigger visual_candidate_event_guard before update or delete on public.visual_asset_candidate_events
  for each row execute function public.guard_visual_candidate_event();


alter table public.visual_asset_candidates enable row level security;
alter table public.visual_asset_candidate_events enable row level security;

drop policy if exists visual_candidate_read on public.visual_asset_candidates;
create policy visual_candidate_read on public.visual_asset_candidates for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists visual_candidate_insert on public.visual_asset_candidates;
create policy visual_candidate_insert on public.visual_asset_candidates for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
drop policy if exists visual_candidate_update on public.visual_asset_candidates;
create policy visual_candidate_update on public.visual_asset_candidates for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','researcher','sales'])) with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));

drop policy if exists visual_candidate_event_read on public.visual_asset_candidate_events;
create policy visual_candidate_event_read on public.visual_asset_candidate_events for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists visual_candidate_event_insert on public.visual_asset_candidate_events;
create policy visual_candidate_event_insert on public.visual_asset_candidate_events for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));

-- Supabase grants new tables everything to `authenticated` and `anon` by default. Take back the
-- powers this ledger must never have, then grant exactly what the collector uses.
revoke all on public.visual_asset_candidates from anon, authenticated;
revoke all on public.visual_asset_candidate_events from anon, authenticated;
grant select, insert, update on public.visual_asset_candidates to authenticated;
grant select, insert on public.visual_asset_candidate_events to authenticated;
grant select, insert, update, delete on public.visual_asset_candidates to service_role;
grant select, insert, update, delete on public.visual_asset_candidate_events to service_role;

