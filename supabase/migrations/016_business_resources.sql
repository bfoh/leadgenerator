-- Independent, permissioned resource facts. No Google response/photo content is stored here.
create table if not exists public.business_resource_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  category text not null check (category in ('identity','contact','location','social','product','service','color','typography','brief')),
  label text not null check (char_length(btrim(label)) between 2 and 120),
  value text not null check (char_length(btrim(value)) between 1 and 2000),
  source_kind text not null check (source_kind in ('business_owner','official_website','licensed_original')),
  source_url text not null check (char_length(source_url) <= 2000 and source_url ~* '^https?://' and source_url !~* '^https?://([^/]*@)?([^/]*\.)?(google\.[a-z.]+|googleapis\.com|googleusercontent\.com|gstatic\.com|goo\.gl|ggpht\.com|facebook\.com|fbcdn\.net|instagram\.com|cdninstagram\.com|tiktok\.com|linkedin\.com|x\.com|twitter\.com)([:/]|$)'),
  evidence text not null check (char_length(btrim(evidence)) between 15 and 1000),
  export_permission text not null check (export_permission in ('granted','denied')),
  independently_verified boolean not null check (independently_verified),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade
);
create index if not exists business_resources_business_idx on public.business_resource_entries(organization_id, business_id);
create or replace function public.guard_business_resource_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'Resource entries are immutable; revoke and add a corrected entry.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists business_resource_guard on public.business_resource_entries;
create trigger business_resource_guard before update on public.business_resource_entries for each row execute function public.guard_business_resource_entry();
drop trigger if exists business_resource_audit on public.business_resource_entries;
create trigger business_resource_audit after insert or update or delete on public.business_resource_entries for each row execute function public.audit_row_change();
alter table public.business_resource_entries enable row level security;
drop policy if exists business_resource_read on public.business_resource_entries;
create policy business_resource_read on public.business_resource_entries for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists business_resource_insert on public.business_resource_entries;
create policy business_resource_insert on public.business_resource_entries for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
drop policy if exists business_resource_revoke on public.business_resource_entries;
create policy business_resource_revoke on public.business_resource_entries for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','researcher','sales'])) with check (public.has_org_role(organization_id, array['owner','admin','researcher','sales']));
grant select, insert, update on public.business_resource_entries to authenticated;
grant select, insert, update, delete on public.business_resource_entries to service_role;
