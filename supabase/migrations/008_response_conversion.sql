-- Digital Opportunity Finder — responses and conversion (autonomous platform, phase 9).
--
-- * reply_classifications: an append-only history of what each received message means (interested,
--   meeting request, pricing or proposal question, not now, not interested, opt-out, wrong contact,
--   automatic reply, unclear…), from the deterministic rules, the optional AI classifier or a
--   person's correction. The latest row is the current reading; the prospect is the message's own
--   (a message can be linked to a prospect after it arrives). An opt-out reply can only ever be
--   classified as an opt-out: suppression takes precedence over any classifier or person.
-- * proposal_change_requests: what a client asked to change in an issued proposal (price, scope,
--   timeline, payment or contract terms). Sales records them; only an owner or admin approves or
--   declines one, with a note. Requests are never deleted.
-- * Acceptance guard on proposals: a proposal cannot be recorded as accepted while a change request
--   is open, or while an approved change has not been written into a revised proposal that was
--   approved again. Negotiated terms therefore always pass a person's approval. To make that hold,
--   the approval time is stamped by the database when a proposal is approved and cannot be set
--   any other way (clearing it on revision is still allowed).
-- * Additive and re-runnable; needs migrations 002 and 006. Existing rows are not modified.
--   Rollback: supabase/rollback/008_response_conversion_down.sql.

do $$
begin
  if to_regclass('public.inbound_messages') is null or to_regclass('public.proposals') is null then
    raise exception 'Migration 008 needs migrations 002 (workspace) and 006 (messaging); apply them first.';
  end if;
end $$;

-- ─── Reply classifications ───────────────────────────────────────────────────────────────────────

create table if not exists public.reply_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inbound_message_id uuid not null references public.inbound_messages(id) on delete cascade,
  intent text not null check (intent in (
    'interested', 'meeting_request', 'pricing_question', 'proposal_question', 'more_information',
    'not_now', 'not_interested', 'opt_out', 'wrong_contact', 'auto_reply', 'unclear')),
  confidence smallint not null check (confidence between 0 and 100),
  source text not null check (source in ('rules', 'ai', 'person')),
  summary text check (char_length(summary) <= 500),
  classifier_version text not null check (char_length(classifier_version) between 1 and 60),
  model text check (char_length(model) <= 100),
  actor_type text not null default 'user' check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists reply_classifications_message_idx on public.reply_classifications(inbound_message_id, created_at desc);
create index if not exists reply_classifications_org_idx on public.reply_classifications(organization_id, created_at desc);

create or replace function public.guard_reply_classification() returns trigger
language plpgsql set search_path = '' as $$
declare
  m public.inbound_messages%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Classifications are not edited; record a new one.' using errcode = '23514';
  end if;
  select * into m from public.inbound_messages im where im.id = new.inbound_message_id;
  if m.id is null or m.organization_id <> new.organization_id then
    raise exception 'Received message not found.' using errcode = '23503';
  end if;
  -- Suppression takes precedence: an opt-out reply stays an opt-out, whoever classifies it.
  if m.opt_out and new.intent <> 'opt_out' then
    raise exception 'This reply is an opt-out; it cannot be classified as anything else.' using errcode = '23514';
  end if;
  new.actor_id := auth.uid();
  new.created_at := now();
  if new.actor_id is null then
    new.actor_type := 'system';
  elsif new.actor_type = 'system' then
    new.actor_type := 'user';
  end if;
  if new.source = 'person' and (new.actor_id is null or new.actor_type <> 'user') then
    raise exception 'A correction is recorded by a signed-in person.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists reply_classifications_guard on public.reply_classifications;
create trigger reply_classifications_guard before insert or update on public.reply_classifications
  for each row execute function public.guard_reply_classification();

-- ─── Proposal change requests ────────────────────────────────────────────────────────────────────

create table if not exists public.proposal_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null,
  business_id uuid,
  inbound_message_id uuid references public.inbound_messages(id) on delete set null,
  kind text not null check (kind in ('price', 'scope', 'timeline', 'payment_terms', 'contract_terms', 'other')),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'approved', 'declined', 'withdrawn')),
  decision_note text check (char_length(decision_note) <= 1000),
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (proposal_id, organization_id) references public.proposals(id, organization_id) on delete cascade,
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  constraint proposal_change_requests_decision_check check ((status = 'open') = (decided_at is null))
);
create index if not exists proposal_change_requests_proposal_idx on public.proposal_change_requests(proposal_id, status);
create index if not exists proposal_change_requests_org_idx on public.proposal_change_requests(organization_id, status, created_at desc);

create or replace function public.guard_proposal_change_request() returns trigger
language plpgsql set search_path = '' as $$
declare
  p public.proposals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Change requests are recorded and decided by people.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select * into p from public.proposals pr where pr.id = new.proposal_id and pr.organization_id = new.organization_id;
    if p.id is null then
      raise exception 'Proposal not found.' using errcode = '23503';
    end if;
    if p.status not in ('approved', 'sent') then
      raise exception 'Change requests are recorded against an approved or issued proposal.' using errcode = '23514';
    end if;
    new.business_id := p.business_id;
    new.status := 'open';
    new.decision_note := null;
    new.requested_by := auth.uid();
    new.decided_by := null;
    new.decided_at := null;
    new.created_at := now();
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'This change request has been decided; record a new one.' using errcode = '23514';
  end if;
  if new.organization_id <> old.organization_id or new.proposal_id <> old.proposal_id or new.business_id is distinct from old.business_id
     or new.inbound_message_id is distinct from old.inbound_message_id or new.kind <> old.kind or new.summary <> old.summary
     or new.requested_by is distinct from old.requested_by or new.created_at <> old.created_at then
    raise exception 'A change request keeps what the client asked for; record a new one instead.' using errcode = '23514';
  end if;
  if new.status = 'open' then
    raise exception 'Approve, decline or withdraw the change request.' using errcode = '23514';
  end if;
  if new.status in ('approved', 'declined') then
    -- Commercial terms are an owner's or admin's decision.
    if not public.has_org_role(old.organization_id, array['owner', 'admin']) then
      raise exception 'Only owners and administrators decide change requests.' using errcode = '42501';
    end if;
    if coalesce(btrim(new.decision_note), '') = '' then
      raise exception 'Explain the decision.' using errcode = '23514';
    end if;
  elsif new.status = 'withdrawn' then
    if old.requested_by is distinct from auth.uid() and not public.has_org_role(old.organization_id, array['owner', 'admin']) then
      raise exception 'Only the person who recorded it, an owner or an administrator withdraws a change request.' using errcode = '42501';
    end if;
  end if;
  new.decided_by := auth.uid();
  new.decided_at := now();
  return new;
end $$;

drop trigger if exists proposal_change_requests_guard on public.proposal_change_requests;
create trigger proposal_change_requests_guard before insert or update on public.proposal_change_requests
  for each row execute function public.guard_proposal_change_request();
drop trigger if exists proposal_change_requests_touch on public.proposal_change_requests;
create trigger proposal_change_requests_touch before update on public.proposal_change_requests for each row execute function public.touch_updated_at();
drop trigger if exists proposal_change_requests_audit on public.proposal_change_requests;
create trigger proposal_change_requests_audit after insert or update or delete on public.proposal_change_requests
  for each row execute function public.audit_row_change();

-- ─── Acceptance guard ────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_proposal_acceptance() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- The approval time is the database's: stamped on approval, otherwise only ever cleared.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  elsif new.approved_at is distinct from old.approved_at and new.approved_at is not null then
    raise exception 'The approval time is set when the proposal is approved.' using errcode = '23514';
  end if;
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    if exists (select 1 from public.proposal_change_requests c where c.proposal_id = new.id and c.status = 'open') then
      raise exception 'Decide the open change requests before recording acceptance.' using errcode = '23514';
    end if;
    if exists (select 1 from public.proposal_change_requests c
               where c.proposal_id = new.id and c.status = 'approved' and (old.approved_at is null or c.decided_at > old.approved_at)) then
      raise exception 'An agreed change is not in the proposal yet: revise it, approve it again and issue it before recording acceptance.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists proposals_acceptance_guard on public.proposals;
create trigger proposals_acceptance_guard before update on public.proposals
  for each row execute function public.guard_proposal_acceptance();

-- ─── Row Level Security and grants ───────────────────────────────────────────────────────────────

alter table public.reply_classifications enable row level security;
alter table public.proposal_change_requests enable row level security;

drop policy if exists reply_classifications_select on public.reply_classifications;
create policy reply_classifications_select on public.reply_classifications for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists reply_classifications_insert on public.reply_classifications;
create policy reply_classifications_insert on public.reply_classifications for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));
-- No update or delete policy: the history is append-only.

drop policy if exists proposal_change_requests_select on public.proposal_change_requests;
create policy proposal_change_requests_select on public.proposal_change_requests for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists proposal_change_requests_insert on public.proposal_change_requests;
create policy proposal_change_requests_insert on public.proposal_change_requests for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));
drop policy if exists proposal_change_requests_update on public.proposal_change_requests;
create policy proposal_change_requests_update on public.proposal_change_requests for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));
-- No delete policy: change requests are withdrawn, never deleted.

revoke all on public.reply_classifications, public.proposal_change_requests from anon;
revoke update, delete, truncate on public.reply_classifications from authenticated;
revoke delete, truncate on public.proposal_change_requests from authenticated;
grant select, insert on public.reply_classifications to authenticated;
grant select, insert, update on public.proposal_change_requests to authenticated;
-- The server classifies replies that arrive by webhook (rules only); it never decides commercial terms.
revoke update, delete, truncate on public.reply_classifications from service_role;
grant select, insert on public.reply_classifications to service_role;
revoke insert, update, delete, truncate on public.proposal_change_requests from service_role;
grant select on public.proposal_change_requests to service_role;
