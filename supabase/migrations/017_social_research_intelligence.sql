-- Social resource intelligence. A profile link captured during discovery is a *reference*, not a
-- content licence: these tables hold the canonical profile URL, the lawful retention basis and the
-- verification status. Search titles, snippets, rankings, profile content, images and Google Places
-- material are never written here. Images remain references too: nothing is downloaded or rehosted.

-- A prospect captured from an observed public profile is a distinct provenance, like places_reference.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'businesses_source_kind_check') then
    alter table public.businesses drop constraint businesses_source_kind_check;
  end if;
  alter table public.businesses add constraint businesses_source_kind_check check (source_kind in
    ('manual', 'directory', 'search', 'direct_submission', 'referral', 'places_reference', 'legacy_seed', 'provider_discovery', 'social_profile'));
end $$;

create table if not exists public.business_social_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  platform text not null check (platform in ('instagram', 'facebook', 'tiktok')),
  -- Normalized handle without decoration. The canonical profile URL is the identifier that is kept.
  handle text not null check (handle ~ '^[a-z0-9._-]{2,80}$'),
  profile_url text not null check (char_length(profile_url) <= 2000 and profile_url ~* '^https://'),
  provenance text not null check (provenance in
    ('independent_observation', 'owner_supplied', 'licensed_directory', 'official_website')),
  retention_basis text not null check (retention_basis in
    ('first_party_observation', 'owner_supplied', 'licensed_directory', 'official_website')),
  verification_status text not null check (verification_status in
    ('observed', 'independently_verified', 'owner_confirmed')),
  verification_evidence text check (verification_evidence is null or char_length(btrim(verification_evidence)) between 15 and 1000),
  captured_by uuid references auth.users(id) on delete set null default auth.uid(),
  captured_at timestamptz not null default now(),
  verified_at timestamptz,
  revoked_at timestamptz,
  unique (id, organization_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  -- The URL has to be the platform's own public profile host, not a post, share link or redirector.
  constraint business_social_source_host check (
    (platform = 'instagram' and profile_url ~* '^https://(www\.)?instagram\.com/[a-z0-9._-]{2,80}/?$') or
    (platform = 'facebook' and profile_url ~* '^https://(www\.)?facebook\.com/[a-z0-9._-]{2,80}$') or
    (platform = 'tiktok' and profile_url ~* '^https://(www\.)?tiktok\.com/@[a-z0-9._-]{2,80}$')
  ),
  -- An observed profile has no verification time; a verified one always names its evidence.
  constraint business_social_source_verification check (
    (verification_status = 'observed' and verified_at is null) or
    (verification_status in ('independently_verified', 'owner_confirmed') and verification_evidence is not null and verified_at is not null)
  )
);
create index if not exists business_social_sources_business_idx on public.business_social_sources(organization_id, business_id);
-- One active link per profile in an organization: retrying a batch cannot create a second row.
create unique index if not exists business_social_sources_profile_uidx
  on public.business_social_sources(organization_id, platform, handle) where revoked_at is null;


-- Identity is immutable. Verification can move forward only, and revocation is one-way. A correction
-- is a new row, so the old claim stays in history.
create or replace function public.guard_business_social_source() returns trigger
language plpgsql set search_path = '' as $$
declare
  rank_old integer;
  rank_new integer;
begin
  if tg_op = 'INSERT' then
    if new.verification_status <> 'observed' and new.verification_evidence is null then
      raise exception 'A verified social profile needs evidence.' using errcode = '23514';
    end if;
    if new.verification_status <> 'observed' then
      new.verified_at := coalesce(new.verified_at, now());
    end if;
    return new;
  end if;

  if old.revoked_at is not null then
    raise exception 'A revoked social source cannot be changed.' using errcode = '42501';
  end if;
  if new.revoked_at is not null then
    if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
      raise exception 'Revocation only changes the revocation time.' using errcode = '42501';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['verification_status', 'verification_evidence', 'verified_at']) is distinct from
     (to_jsonb(old) - array['verification_status', 'verification_evidence', 'verified_at']) then
    raise exception 'Profile identity is immutable; revoke and add a corrected source.' using errcode = '42501';
  end if;
  rank_old := array_position(array['observed', 'independently_verified', 'owner_confirmed'], old.verification_status);
  rank_new := array_position(array['observed', 'independently_verified', 'owner_confirmed'], new.verification_status);
  if rank_new is null or rank_new <= rank_old then
    raise exception 'Verification status only moves forward.' using errcode = '42501';
  end if;
  if new.verification_evidence is null or char_length(btrim(new.verification_evidence)) < 15 then
    raise exception 'A verified social profile needs evidence.' using errcode = '23514';
  end if;
  new.verified_at := now();
  return new;
end $$;
drop trigger if exists business_social_source_guard on public.business_social_sources;
create trigger business_social_source_guard before insert or update on public.business_social_sources
  for each row execute function public.guard_business_social_source();
drop trigger if exists business_social_source_audit on public.business_social_sources;
create trigger business_social_source_audit after insert or update or delete on public.business_social_sources
  for each row execute function public.audit_row_change();

alter table public.business_social_sources enable row level security;
drop policy if exists business_social_source_read on public.business_social_sources;
create policy business_social_source_read on public.business_social_sources for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists business_social_source_insert on public.business_social_sources;
create policy business_social_source_insert on public.business_social_sources for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
drop policy if exists business_social_source_update on public.business_social_sources;
create policy business_social_source_update on public.business_social_sources for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','researcher','sales'])) with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
grant select, insert, update on public.business_social_sources to authenticated;
grant select, insert, update, delete on public.business_social_sources to service_role;

create table if not exists public.business_research_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  category text not null check (category in
    ('identity', 'description', 'location', 'product_service', 'contact_channel', 'logo_reference',
     'photo_reference', 'colour', 'typography', 'visual_style', 'missing_information')),
  statement text not null check (char_length(btrim(statement)) between 5 and 1000),
  source_kind text not null check (source_kind in
    ('social_profile', 'official_website', 'business_owner', 'licensed_directory', 'research_gap')),
  source_url text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 2000)),
  status text not null check (status in ('observed', 'independently_verified', 'owner_confirmed')),
  evidence text check (evidence is null or char_length(btrim(evidence)) between 15 and 1000),
  captured_by uuid references auth.users(id) on delete set null default auth.uid(),
  captured_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organization_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  -- A research gap is the only entry with no source to point at, and it is never verified.
  constraint business_research_observation_gap check (
    (category = 'missing_information') = (source_kind = 'research_gap')
    and (category <> 'missing_information' or status = 'observed')
  ),
  -- A pointer to somebody's page must be a link; owner-supplied text may arrive without one.
  constraint business_research_observation_source check (
    source_kind in ('business_owner', 'research_gap') or source_url is not null
  ),
  constraint business_research_observation_verified check (status = 'observed' or evidence is not null)
);
create index if not exists business_research_observations_business_idx on public.business_research_observations(organization_id, business_id);
create or replace function public.guard_business_research_observation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null then
    raise exception 'A revoked research observation cannot be changed.' using errcode = '42501';
  end if;
  if new.revoked_at is null or (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
    raise exception 'Research observations are immutable; revoke and add a corrected observation.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists business_research_observation_guard on public.business_research_observations;
create trigger business_research_observation_guard before update on public.business_research_observations
  for each row execute function public.guard_business_research_observation();
drop trigger if exists business_research_observation_audit on public.business_research_observations;
create trigger business_research_observation_audit after insert or update or delete on public.business_research_observations
  for each row execute function public.audit_row_change();

alter table public.business_research_observations enable row level security;
drop policy if exists business_research_observation_read on public.business_research_observations;
create policy business_research_observation_read on public.business_research_observations for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists business_research_observation_insert on public.business_research_observations;
create policy business_research_observation_insert on public.business_research_observations for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
drop policy if exists business_research_observation_revoke on public.business_research_observations;
create policy business_research_observation_revoke on public.business_research_observations for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','researcher','sales'])) with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
grant select, insert, update on public.business_research_observations to authenticated;
grant select, insert, update, delete on public.business_research_observations to service_role;
