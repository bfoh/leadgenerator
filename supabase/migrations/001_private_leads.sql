-- Run in Supabase SQL editor or via Supabase CLI. Private per-account prospect records.
create table if not exists public.leads (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id text not null,
 name text not null,
 city text not null default 'Accra',
 sector text not null default 'Other',
 "websiteStatus" text not null default 'Unverified',
 confidence text not null default 'low',
 priority integer not null default 50 check (priority between 0 and 100),
 phone text not null default '',
 email text not null default '',
 source text not null default '',
 notes text not null default '',
 suggestion text not null default '',
 stage text not null default 'Research',
 consent text not null default 'Unknown',
 "reviewedAt" text,
 "verificationOutcome" text,
 "websiteEvidence" text,
 "contactEvidence" text,
 "verifiedBy" text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(owner_id,id)
);
create index if not exists leads_owner_city_idx on public.leads(owner_id,city);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select,insert,update,delete on public.leads to authenticated;
create policy "Read own leads" on public.leads for select to authenticated using ((select auth.uid())=owner_id);
create policy "Insert own leads" on public.leads for insert to authenticated with check ((select auth.uid())=owner_id);
create policy "Update own leads" on public.leads for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy "Delete own leads" on public.leads for delete to authenticated using ((select auth.uid())=owner_id);
