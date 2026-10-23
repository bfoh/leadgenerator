-- Digital Opportunity Finder — contact intelligence, consent and suppression (autonomous platform,
-- phase 4).
--
-- * contact_points: business contact details with provenance (source type, page or provider and
--   licence, who or which agent recorded it, when), validation results, purpose and a retention
--   deadline. Provenance is fixed once recorded. Restricted sources (such as Google Places contact
--   fields) are not valid source types, so they cannot be stored.
-- * consent_records: append-only, per channel, recorded by a signed-in person with evidence.
--   Automated workers (the service role) cannot record consent. A withdrawal suppresses the
--   contact automatically.
-- * suppressions: organization-wide, by hashed value (email, phone, email domain) or by business,
--   so an entry can outlive the contact details it blocks. Added automatically on withdrawal and on
--   business opt-out, lifted only by owners/admins against a newer consent record, never deleted.
-- * Additive and re-runnable; independent of migrations 003 and 004. Existing rows are not
--   modified; businesses already opted out get a suppression entry.
--   Rollback: supabase/rollback/005_contact_intelligence_down.sql.

-- ─── Contact points ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.contact_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  type text not null check (type in ('email', 'phone', 'whatsapp', 'contact_page', 'contact_form')),
  value text not null check (char_length(value) between 3 and 320),
  normalized_value text not null check (char_length(normalized_value) between 3 and 500),
  -- SHA-256 of the suppression key ("email:…", "phone:+233…", "domain:…"), computed by the app.
  value_hash text check (value_hash ~ '^[0-9a-f]{64}$'),
  domain_hash text check (domain_hash ~ '^[0-9a-f]{64}$'),
  hint text not null check (char_length(hint) between 1 and 120),
  scope text not null default 'unknown' check (scope in ('business', 'person', 'unknown')),
  label text check (char_length(label) <= 80),
  person_name text check (char_length(person_name) <= 120),
  person_role text check (char_length(person_role) <= 120),
  phone_kind text check (phone_kind in ('mobile', 'landline', 'toll_free', 'unclassified')),
  source_type text not null check (source_type in ('business_submitted', 'licensed_dataset', 'business_website', 'authorized_directory', 'directly_provided', 'crm_record', 'enrichment_provider')),
  source_url text check (char_length(source_url) <= 500 and source_url ~* '^https?://'),
  source_provider text check (char_length(source_provider) <= 80),
  source_licence text check (char_length(source_licence) <= 500),
  source_note text check (char_length(source_note) <= 500),
  acquired_at timestamptz not null default now(),
  -- Stamped with auth.uid(); no foreign key, so the record survives the member leaving.
  acquired_by uuid,
  agent_version text check (char_length(agent_version) <= 60),
  job_id uuid,
  purpose text not null default 'research' check (purpose in ('research', 'enquiry_response', 'client_relationship')),
  classification text not null default 'unverified' check (classification in ('verified_business_channel', 'source_confirmed', 'unverified', 'invalid', 'outdated')),
  validation jsonb check (validation is null or (jsonb_typeof(validation) = 'object' and octet_length(validation::text) <= 10000)),
  validated_at timestamptz,
  last_seen_at timestamptz,
  retention_until date not null default (current_date + 365),
  last_reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  constraint contact_points_id_business_key unique (id, business_id),
  constraint contact_points_value_key unique (business_id, type, normalized_value),
  constraint contact_points_hash_check check (type in ('contact_page', 'contact_form') or value_hash is not null),
  constraint contact_points_email_hash_check check (type <> 'email' or domain_hash is not null),
  -- Provenance: every record says where it came from, and who or which agent recorded it.
  constraint contact_points_provenance_check check (
    coalesce(source_url, source_provider, source_note) is not null
    and (source_type <> 'business_website' or source_url is not null)
    and (source_type not in ('licensed_dataset', 'authorized_directory', 'enrichment_provider') or (source_provider is not null and source_licence is not null))
  ),
  constraint contact_points_actor_check check (acquired_by is not null or agent_version is not null),
  constraint contact_points_person_check check (scope <> 'person' or (person_name is not null and person_role is not null and purpose <> 'research'))
);
create index if not exists contact_points_business_idx on public.contact_points(business_id);
create index if not exists contact_points_org_hash_idx on public.contact_points(organization_id, value_hash);
create index if not exists contact_points_retention_idx on public.contact_points(organization_id, retention_until);

create or replace function public.guard_contact_point() returns trigger
language plpgsql set search_path = '' as $$
declare
  mutable text[] := array['scope', 'label', 'person_name', 'person_role', 'phone_kind', 'purpose', 'classification', 'validation', 'validated_at',
    'last_seen_at', 'retention_until', 'last_reviewed_at', 'review_note', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    new.acquired_by := auth.uid();
    return new;
  end if;
  if (to_jsonb(new) - mutable) is distinct from (to_jsonb(old) - mutable) then
    raise exception 'Where a contact detail came from cannot be changed; record a corrected detail as a new contact point.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists contact_points_guard on public.contact_points;
create trigger contact_points_guard before insert or update on public.contact_points
  for each row execute function public.guard_contact_point();

-- ─── Consent records (append-only) ───────────────────────────────────────────────────────────────

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  -- Null: the record covers every contact point on the channel.
  contact_point_id uuid,
  contact_hint text check (char_length(contact_hint) <= 120),
  channel text not null check (channel in ('email', 'whatsapp', 'phone')),
  status text not null check (status in ('granted', 'withdrawn')),
  lawful_basis text check (lawful_basis in ('consent', 'business_initiated', 'existing_relationship')),
  purpose text not null check (purpose in ('direct_marketing', 'service_information', 'enquiry_response', 'client_relationship')),
  scope text check (char_length(scope) <= 300),
  evidence text not null check (char_length(btrim(evidence)) between 10 and 2000),
  captured_via text not null check (captured_via in ('web_form', 'email', 'whatsapp_message', 'written_document', 'phone_call', 'in_person')),
  captured_at timestamptz not null,
  wording text check (char_length(wording) <= 2000),
  expires_at timestamptz,
  recorded_by uuid not null,
  recorded_by_name text not null check (char_length(recorded_by_name) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (contact_point_id, business_id) references public.contact_points(id, business_id) on delete set null (contact_point_id),
  constraint consent_records_basis_check check ((status = 'granted') = (lawful_basis is not null)),
  -- Act 843 s.40: direct marketing on the basis of consent needs prior written consent.
  constraint consent_records_written_check check (
    not (status = 'granted' and lawful_basis = 'consent' and purpose = 'direct_marketing')
    or (captured_via in ('web_form', 'email', 'whatsapp_message', 'written_document') and wording is not null)
  ),
  constraint consent_records_dates_check check ((expires_at is null or expires_at > captured_at) and captured_at <= created_at + interval '5 minutes')
);
create index if not exists consent_records_business_idx on public.consent_records(business_id, channel, captured_at desc);

create or replace function public.guard_consent_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    new.created_at := now();
    if new.recorded_by is null then
      raise exception 'Consent is recorded by a signed-in person; automated workers cannot record it.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Append-only. The one permitted change is the foreign key clearing a deleted contact point.
  if new.contact_point_id is not null or (to_jsonb(new) - 'contact_point_id') is distinct from (to_jsonb(old) - 'contact_point_id') then
    raise exception 'Consent records are never edited; record a new one.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists consent_records_guard on public.consent_records;
create trigger consent_records_guard before insert or update on public.consent_records
  for each row execute function public.guard_consent_record();

-- ─── Suppression list ────────────────────────────────────────────────────────────────────────────

create table if not exists public.suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'email_domain', 'business')),
  value_hash text check (value_hash ~ '^[0-9a-f]{64}$'),
  -- Cleared if the business is deleted; value suppressions keep working without it.
  business_id uuid,
  -- Null: every channel.
  channel text check (channel in ('email', 'whatsapp', 'phone')),
  hint text not null check (char_length(hint) between 1 and 120),
  reason text not null check (reason in ('opted_out', 'unsubscribed', 'refused', 'wrong_contact', 'complaint', 'bounced', 'other')),
  source text not null default 'manual' check (source in ('manual', 'consent_withdrawal', 'business_opt_out', 'agent')),
  consent_record_id uuid references public.consent_records(id) on delete set null,
  note text check (char_length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text check (char_length(lift_reason) <= 1000),
  lift_consent_id uuid references public.consent_records(id) on delete set null,
  match_key text generated always as (coalesce(value_hash, business_id::text, id::text)) stored,
  channel_key text generated always as (coalesce(channel, '*')) stored,
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete set null (business_id),
  constraint suppressions_target_check check ((kind = 'business') = (value_hash is null)),
  constraint suppressions_lift_check check ((lifted_at is null) = (lifted_by is null) and (lifted_at is null or lift_reason is not null))
);
create unique index if not exists suppressions_active_idx on public.suppressions(organization_id, kind, match_key, channel_key) where lifted_at is null;
create index if not exists suppressions_business_idx on public.suppressions(business_id);

create or replace function public.guard_suppression() returns trigger
language plpgsql set search_path = '' as $$
declare
  -- Foreign keys may only ever clear these (a deleted business or consent record).
  fk_fields text[] := array['business_id', 'consent_record_id', 'lift_consent_id', 'match_key', 'channel_key'];
  lift_fields text[] := array['lifted_at', 'lifted_by', 'lift_reason'];
  c public.consent_records%rowtype;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.lifted_at := null;
    new.lifted_by := null;
    new.lift_reason := null;
    new.lift_consent_id := null;
    if new.kind = 'business' and new.business_id is null then
      raise exception 'A business suppression names the business.' using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.business_id is distinct from old.business_id and new.business_id is not null)
     or (new.consent_record_id is distinct from old.consent_record_id and new.consent_record_id is not null)
     or (to_jsonb(new) - fk_fields - lift_fields) is distinct from (to_jsonb(old) - fk_fields - lift_fields) then
    raise exception 'Suppression entries are never edited; a lifted entry is replaced by a new one.' using errcode = '23514';
  end if;
  if old.lifted_at is not null then
    if (to_jsonb(new) - fk_fields) is distinct from (to_jsonb(old) - fk_fields) or (new.lift_consent_id is not null and new.lift_consent_id is distinct from old.lift_consent_id) then
      raise exception 'This suppression was already lifted; add a new entry instead.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.lift_consent_id is null and new.lift_reason is null and new.lifted_at is null and new.lifted_by is null then
    return new; -- a foreign key clearing business_id or consent_record_id
  end if;
  -- Separate checks: automated workers may not execute has_org_role at all.
  if auth.uid() is null then
    raise exception 'Only owners and administrators can lift a suppression; automated workers cannot.' using errcode = '42501';
  end if;
  if not public.has_org_role(new.organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and administrators can lift a suppression.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(new.lift_reason, ''))) < 10 then
    raise exception 'Explain why the suppression is lifted (at least 10 characters).' using errcode = '23514';
  end if;
  select * into c from public.consent_records r where r.id = new.lift_consent_id and r.organization_id = new.organization_id;
  if c.id is null or c.status <> 'granted' or c.created_at <= old.created_at or (c.expires_at is not null and c.expires_at <= now()) then
    raise exception 'Lifting a suppression needs a current consent record made after it.' using errcode = '23514';
  end if;
  if (old.channel is not null and c.channel <> old.channel)
     or (old.kind = 'business' and c.business_id is distinct from old.business_id)
     or (old.kind in ('email', 'phone') and not exists (
       select 1 from public.contact_points p where p.business_id = c.business_id and p.value_hash = old.value_hash and (c.contact_point_id is null or c.contact_point_id = p.id)))
     or (old.kind = 'email_domain' and not exists (
       select 1 from public.contact_points p where p.business_id = c.business_id and p.domain_hash = old.value_hash and (c.contact_point_id is null or c.contact_point_id = p.id))) then
    raise exception 'The consent record must cover the suppressed contact and channel.' using errcode = '23514';
  end if;
  new.lifted_by := auth.uid();
  new.lifted_at := now();
  return new;
end $$;

drop trigger if exists suppressions_guard on public.suppressions;
create trigger suppressions_guard before insert or update on public.suppressions
  for each row execute function public.guard_suppression();

-- A withdrawal suppresses the matching contact points on that channel.
create or replace function public.suppress_on_withdrawal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'withdrawn' then
    return new;
  end if;
  insert into public.suppressions (organization_id, kind, value_hash, channel, hint, reason, source, consent_record_id)
  select new.organization_id, case when p.type = 'email' then 'email' else 'phone' end, p.value_hash, new.channel, p.hint, 'opted_out', 'consent_withdrawal', new.id
  from public.contact_points p
  where p.business_id = new.business_id
    and p.value_hash is not null
    and (case p.type when 'email' then 'email' when 'phone' then 'phone' when 'whatsapp' then 'whatsapp' end) = new.channel
    and (new.contact_point_id is null or p.id = new.contact_point_id)
  on conflict (organization_id, kind, match_key, channel_key) where lifted_at is null do nothing;
  return new;
end $$;

drop trigger if exists consent_records_withdrawal on public.consent_records;
create trigger consent_records_withdrawal after insert on public.consent_records
  for each row execute function public.suppress_on_withdrawal();

-- A business opt-out suppresses the business and every contact value recorded for it.
create or replace function public.suppress_on_business_opt_out() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.contact_permission is distinct from 'opted_out' or (tg_op = 'UPDATE' and old.contact_permission = 'opted_out') then
    return new;
  end if;
  insert into public.suppressions (organization_id, kind, business_id, hint, reason, source)
  values (new.organization_id, 'business', new.id, left(new.name, 120), 'opted_out', 'business_opt_out')
  on conflict (organization_id, kind, match_key, channel_key) where lifted_at is null do nothing;
  insert into public.suppressions (organization_id, kind, value_hash, hint, reason, source)
  select distinct on (p.value_hash) new.organization_id, case when p.type = 'email' then 'email' else 'phone' end, p.value_hash, p.hint, 'opted_out', 'business_opt_out'
  from public.contact_points p
  where p.business_id = new.id and p.value_hash is not null
  on conflict (organization_id, kind, match_key, channel_key) where lifted_at is null do nothing;
  return new;
end $$;

drop trigger if exists businesses_opt_out_suppression on public.businesses;
create trigger businesses_opt_out_suppression after insert or update of contact_permission on public.businesses
  for each row execute function public.suppress_on_business_opt_out();

-- Businesses that opted out before this migration.
insert into public.suppressions (organization_id, kind, business_id, hint, reason, source)
select b.organization_id, 'business', b.id, left(b.name, 120), 'opted_out', 'business_opt_out'
from public.businesses b
where b.contact_permission = 'opted_out'
on conflict (organization_id, kind, match_key, channel_key) where lifted_at is null do nothing;

-- ─── Shared triggers ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists contact_points_touch on public.contact_points;
create trigger contact_points_touch before update on public.contact_points for each row execute function public.touch_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['contact_points', 'consent_records', 'suppressions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ─── Row Level Security ──────────────────────────────────────────────────────────────────────────

alter table public.contact_points enable row level security;
alter table public.consent_records enable row level security;
alter table public.suppressions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['contact_points', 'consent_records', 'suppressions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_select', t);
  end loop;
end $$;

drop policy if exists contact_points_insert on public.contact_points;
create policy contact_points_insert on public.contact_points for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists contact_points_update on public.contact_points;
create policy contact_points_update on public.contact_points for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists contact_points_delete on public.contact_points;
create policy contact_points_delete on public.contact_points for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists consent_records_insert on public.consent_records;
create policy consent_records_insert on public.consent_records for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));

-- Adding a suppression is always allowed to people who work on prospects; lifting is checked by the trigger.
drop policy if exists suppressions_insert on public.suppressions;
create policy suppressions_insert on public.suppressions for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'researcher', 'sales']));
drop policy if exists suppressions_update on public.suppressions;
create policy suppressions_update on public.suppressions for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────
-- Supabase's default privileges grant every role everything on new tables; take back what the
-- model forbids: consent records are append-only, suppressions are never deleted.

revoke all on public.contact_points, public.consent_records, public.suppressions from anon;
grant select, insert, update, delete on public.contact_points to authenticated, service_role;
revoke update, delete, truncate on public.consent_records from authenticated, service_role;
grant select, insert on public.consent_records to authenticated, service_role;
revoke delete, truncate on public.suppressions from authenticated, service_role;
grant select, insert, update on public.suppressions to authenticated, service_role;
