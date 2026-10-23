-- Digital Opportunity Finder — website verification evidence, business identity and digital audit
-- (autonomous platform, phase 3).
--
-- * website_verifications gains agent evidence (one of nine classifications, a 0–100 evidence
--   confidence, structured evidence, agent version, job) and a review state. Agent records cannot be
--   edited apart from their review.
-- * businesses gains identity fields (alternate names, branch of, merged into, identity confidence)
--   and a score override with a written justification (its history is kept in audit_events).
-- * identity_links records suggested duplicates and people's decisions. merge_businesses and
--   undo_business_merge (owners and administrators) are the only way to merge: atomic, reversible,
--   nothing deleted, and an opt-out on either record carries over.
-- * audit_findings stores evidence-backed digital audit findings; only their review changes.
-- * Additive and re-runnable, and independent of migration 003. No existing row is modified.
--   Rollback: supabase/rollback/004_research_verification_down.sql.

-- ─── Agent evidence on website verifications ─────────────────────────────────────────────────────

alter table public.website_verifications
  add column if not exists actor_type text not null default 'user',
  add column if not exists classification text,
  add column if not exists confidence_score integer,
  add column if not exists evidence jsonb,
  add column if not exists agent_version text,
  add column if not exists job_id uuid,
  add column if not exists review_status text not null default 'not_required',
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.website_verifications drop constraint if exists website_verifications_actor_type_check;
alter table public.website_verifications add constraint website_verifications_actor_type_check check (actor_type in ('user', 'agent'));
alter table public.website_verifications drop constraint if exists website_verifications_classification_check;
alter table public.website_verifications add constraint website_verifications_classification_check check (classification in (
  'verified_official_website', 'probable_official_website', 'social_only_presence', 'no_official_website_discovered',
  'broken_or_unavailable_website', 'outdated_website_potential', 'identity_uncertain', 'insufficient_evidence', 'human_review_required'));
alter table public.website_verifications drop constraint if exists website_verifications_confidence_score_check;
alter table public.website_verifications add constraint website_verifications_confidence_score_check check (confidence_score between 0 and 100);
alter table public.website_verifications drop constraint if exists website_verifications_evidence_check;
alter table public.website_verifications add constraint website_verifications_evidence_check
  check (evidence is null or (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 200000));
alter table public.website_verifications drop constraint if exists website_verifications_agent_version_check;
alter table public.website_verifications add constraint website_verifications_agent_version_check check (char_length(agent_version) <= 60);
alter table public.website_verifications drop constraint if exists website_verifications_review_status_check;
alter table public.website_verifications add constraint website_verifications_review_status_check
  check (review_status in ('not_required', 'pending', 'confirmed', 'rejected'));
alter table public.website_verifications drop constraint if exists website_verifications_review_note_check;
alter table public.website_verifications add constraint website_verifications_review_note_check check (char_length(review_note) <= 1000);
-- An agent's record must say what it concluded, how sure it is, on what evidence, and which code decided.
alter table public.website_verifications drop constraint if exists website_verifications_agent_record_check;
alter table public.website_verifications add constraint website_verifications_agent_record_check check (
  actor_type = 'user' or (classification is not null and confidence_score is not null and evidence is not null and agent_version is not null));

create index if not exists website_verifications_review_idx on public.website_verifications(organization_id) where review_status = 'pending';

create or replace function public.guard_verification_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  review_fields text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'];
begin
  if new.actor_type is distinct from old.actor_type then
    raise exception 'The author of a verification record cannot be changed.' using errcode = '23514';
  end if;
  if old.actor_type = 'agent' and (to_jsonb(new) - review_fields) is distinct from (to_jsonb(old) - review_fields) then
    raise exception 'Agent verification records cannot be edited. Confirm or reject them, or record a new verification.' using errcode = '23514';
  end if;
  if new.review_status is distinct from old.review_status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists website_verifications_guard on public.website_verifications;
create trigger website_verifications_guard before update on public.website_verifications
  for each row execute function public.guard_verification_update();

-- ─── Identity and score override on businesses ──────────────────────────────────────────────────

alter table public.businesses
  add column if not exists alternate_names text[] not null default '{}',
  add column if not exists parent_business_id uuid,
  add column if not exists merged_into_id uuid,
  add column if not exists identity_confidence integer,
  add column if not exists identity_checked_at timestamptz,
  add column if not exists score_override jsonb;

alter table public.businesses drop constraint if exists businesses_parent_fk;
alter table public.businesses add constraint businesses_parent_fk foreign key (parent_business_id, organization_id)
  references public.businesses(id, organization_id) on delete set null (parent_business_id);
alter table public.businesses drop constraint if exists businesses_merged_into_fk;
alter table public.businesses add constraint businesses_merged_into_fk foreign key (merged_into_id, organization_id)
  references public.businesses(id, organization_id) on delete set null (merged_into_id);
alter table public.businesses drop constraint if exists businesses_alternate_names_check;
alter table public.businesses add constraint businesses_alternate_names_check
  check (cardinality(alternate_names) <= 20 and char_length(array_to_string(alternate_names, '|')) <= 4000);
alter table public.businesses drop constraint if exists businesses_identity_links_check;
alter table public.businesses add constraint businesses_identity_links_check
  check ((parent_business_id is null or parent_business_id <> id) and (merged_into_id is null or merged_into_id <> id));
alter table public.businesses drop constraint if exists businesses_merged_archived_check;
alter table public.businesses add constraint businesses_merged_archived_check check (merged_into_id is null or stage = 'archived');
alter table public.businesses drop constraint if exists businesses_identity_confidence_check;
alter table public.businesses add constraint businesses_identity_confidence_check check (identity_confidence between 0 and 100);
alter table public.businesses drop constraint if exists businesses_score_override_check;
alter table public.businesses add constraint businesses_score_override_check check (score_override is null or (
  jsonb_typeof(score_override) = 'object'
  and jsonb_typeof(score_override -> 'opportunity') = 'number'
  and (score_override ->> 'opportunity')::numeric between 0 and 100
  and char_length(coalesce(score_override ->> 'justification', '')) between 20 and 1000));

create index if not exists businesses_merged_into_idx on public.businesses(merged_into_id) where merged_into_id is not null;
create index if not exists businesses_parent_idx on public.businesses(parent_business_id) where parent_business_id is not null;

-- Merges go through the functions below; score overrides need a research lead and are stamped with
-- who made them and when.
create or replace function public.guard_business_research_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.merged_into_id is not null) or (tg_op = 'UPDATE' and new.merged_into_id is distinct from old.merged_into_id) then
    if coalesce(current_setting('app.identity_merge', true), '') <> 'on' then
      raise exception 'Use merge or undo merge to change merged records.' using errcode = '23514';
    end if;
  end if;
  if (tg_op = 'INSERT' and new.score_override is not null) or (tg_op = 'UPDATE' and new.score_override is distinct from old.score_override) then
    if not (coalesce((select auth.jwt()) ->> 'role', '') = 'service_role' or public.has_org_role(new.organization_id, array['owner', 'admin', 'researcher'])) then
      raise exception 'Only owners, administrators and researchers can override scores.' using errcode = '42501';
    end if;
    if new.score_override is not null then
      new.score_override := new.score_override || jsonb_build_object('by', auth.uid(), 'at', now());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists businesses_research_guard on public.businesses;
create trigger businesses_research_guard before insert or update on public.businesses
  for each row execute function public.guard_business_research_fields();

-- ─── Identity links ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.identity_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  other_business_id uuid not null,
  relation text not null default 'possible_duplicate' check (relation in ('possible_duplicate', 'same_business', 'branch', 'distinct')),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed')),
  strength text not null default 'possible' check (strength in ('exact', 'likely', 'possible')),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 10),
  suggested_by text not null default 'user' check (suggested_by in ('user', 'agent')),
  agent_version text check (char_length(agent_version) <= 60),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  note text check (char_length(note) <= 1000),
  merge_snapshot jsonb check (merge_snapshot is null or jsonb_typeof(merge_snapshot) = 'object'),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_links_distinct_pair check (business_id <> other_business_id),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (other_business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create unique index if not exists identity_links_pair_idx
  on public.identity_links(organization_id, least(business_id, other_business_id), greatest(business_id, other_business_id));
create index if not exists identity_links_business_idx on public.identity_links(business_id);
create index if not exists identity_links_other_idx on public.identity_links(other_business_id);

create or replace function public.stamp_identity_decision() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- "Same business" records a merge, so only the merge functions write it (and its snapshot).
  if coalesce(current_setting('app.identity_merge', true), '') <> 'on' and (
    (tg_op = 'INSERT' and (new.relation = 'same_business' or new.merge_snapshot is not null))
    or (tg_op = 'UPDATE' and (new.relation is distinct from old.relation and 'same_business' in (new.relation, old.relation)
      or new.merge_snapshot is distinct from old.merge_snapshot))) then
    raise exception 'Use merge or undo merge to record that two prospects are the same business.' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' and new.status <> 'suggested')
    or (tg_op = 'UPDATE' and (new.status is distinct from old.status or new.relation is distinct from old.relation)) then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;

drop trigger if exists identity_links_decision on public.identity_links;
create trigger identity_links_decision before insert or update on public.identity_links
  for each row execute function public.stamp_identity_decision();

create or replace function public.merge_businesses(p_primary uuid, p_secondary uuid, p_fields text[] default '{}', p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a public.businesses;
  b public.businesses;
  f text;
  copied text[] := '{}';
begin
  if p_primary = p_secondary then
    raise exception 'Choose two different prospects to merge.' using errcode = '22023';
  end if;
  select * into a from public.businesses where id = p_primary for update;
  select * into b from public.businesses where id = p_secondary for update;
  if a.id is null or b.id is null or a.organization_id <> b.organization_id then
    raise exception 'Prospect not found.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(a.organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and administrators can merge prospects.' using errcode = '42501';
  end if;
  if a.merged_into_id is not null or b.merged_into_id is not null then
    raise exception 'One of these prospects has already been merged.' using errcode = '22023';
  end if;
  foreach f in array coalesce(p_fields, '{}') loop
    if f not in ('official_website', 'phone', 'email', 'address', 'neighborhood', 'region', 'enquiry_channel', 'places_place_id', 'source_url') then
      raise exception 'The field % cannot be merged.', f using errcode = '22023';
    end if;
    if (to_jsonb(a) ->> f) is null and (to_jsonb(b) ->> f) is not null then
      copied := copied || f;
    end if;
  end loop;

  perform set_config('app.identity_merge', 'on', true);
  update public.businesses set
    official_website = case when 'official_website' = any(copied) then b.official_website else official_website end,
    phone = case when 'phone' = any(copied) then b.phone else phone end,
    email = case when 'email' = any(copied) then b.email else email end,
    address = case when 'address' = any(copied) then b.address else address end,
    neighborhood = case when 'neighborhood' = any(copied) then b.neighborhood else neighborhood end,
    region = case when 'region' = any(copied) then b.region else region end,
    enquiry_channel = case when 'enquiry_channel' = any(copied) then b.enquiry_channel else enquiry_channel end,
    places_place_id = case when 'places_place_id' = any(copied) then b.places_place_id else places_place_id end,
    source_url = case when 'source_url' = any(copied) then b.source_url else source_url end,
    -- An opt-out (or a refusal) recorded on either record applies to the merged business.
    contact_permission = case
      when b.contact_permission = 'opted_out' then 'opted_out'
      when b.contact_permission = 'declined' and contact_permission in ('unknown', 'introduction_requested') then 'declined'
      else contact_permission end,
    opted_out_at = case when b.contact_permission = 'opted_out' and contact_permission <> 'opted_out' then b.opted_out_at else opted_out_at end,
    alternate_names = (
      select coalesce((array_agg(distinct n))[1:20], '{}') from unnest(a.alternate_names || b.alternate_names || array[b.name]) n where lower(n) <> lower(a.name))
  where id = a.id;
  update public.businesses set stage = 'archived', merged_into_id = a.id, next_action = null where id = b.id;
  insert into public.identity_links (organization_id, business_id, other_business_id, relation, status, strength, reasons, suggested_by, note, merge_snapshot)
  values (a.organization_id, a.id, b.id, 'same_business', 'confirmed', 'likely', array['Merged by a person'], 'user', p_note,
    jsonb_build_object('stage', b.stage, 'copiedFields', to_jsonb(copied), 'permissionFrom', a.contact_permission,
      'addedName', lower(b.name) <> lower(a.name) and not (b.name = any(a.alternate_names)), 'mergedAt', now()))
  on conflict (organization_id, least(business_id, other_business_id), greatest(business_id, other_business_id)) do update
    set relation = 'same_business', status = 'confirmed', note = excluded.note, merge_snapshot = excluded.merge_snapshot;
  perform set_config('app.identity_merge', 'off', true);
  return jsonb_build_object('primary', a.id, 'secondary', b.id, 'copiedFields', to_jsonb(copied));
end $$;

create or replace function public.undo_business_merge(p_secondary uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.businesses;
  l public.identity_links;
  restored text;
  f text;
begin
  select * into b from public.businesses where id = p_secondary for update;
  if b.id is null then
    raise exception 'Prospect not found.' using errcode = 'P0002';
  end if;
  if b.merged_into_id is null then
    raise exception 'This prospect is not merged.' using errcode = '22023';
  end if;
  if not public.has_org_role(b.organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and administrators can undo a merge.' using errcode = '42501';
  end if;
  select * into l from public.identity_links
  where organization_id = b.organization_id
    and least(business_id, other_business_id) = least(b.id, b.merged_into_id)
    and greatest(business_id, other_business_id) = greatest(b.id, b.merged_into_id);
  restored := coalesce(l.merge_snapshot ->> 'stage', 'research_candidate');
  if restored = 'archived' or restored not in ('research_candidate', 'verification_pending', 'qualified', 'introduction_requested', 'contact_authorized',
    'discovery_meeting', 'proposal_draft', 'proposal_sent', 'negotiation', 'won', 'lost') then
    restored := 'research_candidate';
  end if;

  perform set_config('app.identity_merge', 'on', true);
  -- Values the merge copied leave the primary again unless someone has changed them since. A carried-over
  -- opt-out stays: undoing a merge never relaxes a suppression; a person reviews it.
  for f in select jsonb_array_elements_text(coalesce(l.merge_snapshot -> 'copiedFields', '[]'::jsonb)) loop
    continue when f not in ('official_website', 'phone', 'email', 'address', 'neighborhood', 'region', 'enquiry_channel', 'places_place_id', 'source_url');
    execute format('update public.businesses set %I = null where id = $1 and %I is not distinct from $2', f, f)
      using b.merged_into_id, to_jsonb(b) ->> f;
  end loop;
  if coalesce((l.merge_snapshot ->> 'addedName')::boolean, true) then
    update public.businesses set alternate_names = array_remove(alternate_names, b.name) where id = b.merged_into_id;
  end if;
  update public.businesses set merged_into_id = null, stage = restored where id = b.id;
  if l.id is not null then
    update public.identity_links set relation = 'distinct', status = 'confirmed', note = 'Merge undone' where id = l.id;
  end if;
  perform set_config('app.identity_merge', 'off', true);
  return jsonb_build_object('secondary', b.id, 'stage', restored);
end $$;

-- ─── Digital audit findings ──────────────────────────────────────────────────────────────────────

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  finding_key text not null check (finding_key ~ '^[a-z0-9_]{2,60}$'),
  category text not null check (category in ('website_presence', 'technical', 'mobile', 'performance', 'seo', 'content', 'conversion', 'commerce')),
  kind text not null check (kind in ('verified_issue', 'opportunity')),
  title text not null check (char_length(title) between 1 and 200),
  -- Only problems supported by evidence: at least one cited observation.
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) between 1 and 10 and octet_length(evidence::text) <= 20000),
  severity text not null check (severity in ('info', 'low', 'medium', 'high')),
  confidence integer not null check (confidence between 0 and 100),
  impact_hypothesis text not null default '' check (char_length(impact_hypothesis) <= 1000),
  recommendation text not null default '' check (char_length(recommendation) <= 1000),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'accepted', 'dismissed', 'superseded')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  verification_id uuid,
  job_id uuid,
  agent_version text not null check (char_length(agent_version) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists audit_findings_business_idx on public.audit_findings(business_id, created_at desc);
create index if not exists audit_findings_org_idx on public.audit_findings(organization_id, created_at desc);

create or replace function public.guard_audit_finding_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  review_fields text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'];
begin
  if (to_jsonb(new) - review_fields) is distinct from (to_jsonb(old) - review_fields) then
    raise exception 'Audit findings are evidence records; only their review can change.' using errcode = '23514';
  end if;
  if new.review_status is distinct from old.review_status and new.review_status in ('accepted', 'dismissed', 'unreviewed') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists audit_findings_guard on public.audit_findings;
create trigger audit_findings_guard before update on public.audit_findings
  for each row execute function public.guard_audit_finding_update();

-- ─── Shared triggers ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['identity_links', 'audit_findings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ─── Row Level Security ──────────────────────────────────────────────────────────────────────────

alter table public.identity_links enable row level security;
alter table public.audit_findings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['identity_links', 'audit_findings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
      with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))$p$, t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']))$p$, t || '_delete', t);
  end loop;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────

revoke all on public.identity_links, public.audit_findings from anon;
grant select, insert, update, delete on public.identity_links, public.audit_findings to authenticated, service_role;

revoke execute on function public.merge_businesses(uuid, uuid, text[], text) from public, anon;
revoke execute on function public.undo_business_merge(uuid) from public, anon;
grant execute on function public.merge_businesses(uuid, uuid, text[], text) to authenticated;
grant execute on function public.undo_business_merge(uuid) to authenticated;
