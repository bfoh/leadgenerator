-- Digital Opportunity Finder — messaging infrastructure (autonomous platform, phase 7).
--
-- * message_templates: email and WhatsApp templates. Email templates are approved by an owner or
--   admin; WhatsApp templates take their status only from Meta, synchronised by the server with the
--   service role. Editing a template's content returns it to draft.
-- * outreach_messages: the outbound queue. A message is drafted for one contact point, approved by
--   an owner or admin against a stored eligibility decision, queued, then dispatched by the server.
--   Content is fixed once the draft is approved. Only the service role (the server) records
--   dispatch and delivery. The address is not copied: the server resolves it from the contact
--   point at dispatch and checks it against the stored hash. A queued message has a dedupe key, so
--   the same text cannot be queued twice for the same recipient.
-- * eligibility_decisions: append-only record of every gateway decision with its checks and inputs.
-- * inbound_messages: replies received through provider webhooks (or logged by a person) with the
--   deterministic opt-out result; an opt-out suppresses the sender on every channel.
-- * channel_events: each provider webhook event once (deduplication); no payloads are stored.
-- * Bounces and complaints suppress the recipient; suppressions gains the sources inbound_opt_out
--   and provider_event.
-- * Sending to businesses stays unavailable: public.outbound_available() is unchanged (false), so
--   the outreach modes cannot be selected and the emergency stop cannot be lifted. The server
--   dispatches only to the sandbox test recipients configured in its environment.
-- * Additive and re-runnable; needs migration 005. Existing rows are not modified.
--   Rollback: supabase/rollback/006_messaging_down.sql.

-- ─── Templates ───────────────────────────────────────────────────────────────────────────────────

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  purpose text not null check (purpose in ('introduction', 'follow_up', 'proposal', 'reply')),
  language text not null default 'en' check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 5000),
  -- WhatsApp: the template's name in the WhatsApp Business Account.
  provider_template_name text check (provider_template_name ~ '^[a-z0-9_]+$' and char_length(provider_template_name) <= 512),
  provider_template_id text check (char_length(provider_template_id) <= 100),
  provider_category text check (provider_category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  status_reason text check (char_length(status_reason) <= 1000),
  status_checked_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_name_key unique (organization_id, channel, name, language),
  constraint message_templates_channel_fields_check check (
    (channel = 'email' and char_length(btrim(coalesce(subject, ''))) > 0 and provider_template_name is null)
    or (channel = 'whatsapp' and provider_template_name is not null and subject is null)
  ),
  constraint message_templates_email_status_check check (channel <> 'email' or status in ('draft', 'approved', 'paused', 'disabled'))
);
create index if not exists message_templates_org_idx on public.message_templates(organization_id, channel, status);

create or replace function public.guard_message_template() returns trigger
language plpgsql set search_path = '' as $$
declare
  worker boolean := auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.version := 1;
    -- People and email templates start as drafts; the server records what Meta reports for WhatsApp.
    if not worker or new.channel = 'email' then
      new.status := 'draft';
      new.status_reason := null;
      new.status_checked_at := null;
      new.approved_by := null;
      new.approved_at := null;
      new.provider_template_id := case when worker then new.provider_template_id end;
    elsif new.status = 'approved' then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := null;
    end if;
    return new;
  end if;

  if not worker then
    -- Provider facts are only written by the server.
    new.provider_template_id := old.provider_template_id;
    new.provider_category := old.provider_category;
    new.status_checked_at := old.status_checked_at;
  end if;

  if (new.channel, new.name, new.purpose, new.language, new.subject, new.body, new.provider_template_name)
     is distinct from (old.channel, old.name, old.purpose, old.language, old.subject, old.body, old.provider_template_name) then
    if new.channel <> old.channel then
      raise exception 'A template keeps its channel; create a new template instead.' using errcode = '23514';
    end if;
    new.version := old.version + 1;
    new.approved_by := null;
    new.approved_at := null;
    -- Edited content needs a new approval (email) or a new review by Meta (WhatsApp).
    if not worker or new.channel = 'email' then
      new.status := case when old.status = 'disabled' then 'disabled' else 'draft' end;
      new.status_reason := null;
    elsif old.status = 'disabled' then
      -- A sync that brings new text from Meta still never re-enables a template a person disabled.
      new.status := 'disabled';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.channel = 'email' then
      if worker then
        raise exception 'Email templates are approved by a person.' using errcode = '42501';
      end if;
      if not public.has_org_role(new.organization_id, array['owner', 'admin']) then
        raise exception 'Only owners and administrators can approve, pause or disable templates.' using errcode = '42501';
      end if;
      if not (
        (old.status = 'draft' and new.status in ('approved', 'disabled'))
        or (old.status = 'approved' and new.status in ('paused', 'disabled', 'draft'))
        or (old.status = 'paused' and new.status in ('approved', 'disabled', 'draft'))
        or (old.status = 'disabled' and new.status = 'draft')
      ) then
        raise exception 'This template status change is not allowed.' using errcode = '23514';
      end if;
    elsif not worker then
      -- WhatsApp: people may only take a template out of use locally, or put it back for the next sync.
      if not ((new.status = 'disabled') or (old.status = 'disabled' and new.status = 'pending')) then
        raise exception 'WhatsApp template status comes from Meta; synchronise the templates instead.' using errcode = '23514';
      end if;
      if not public.has_org_role(new.organization_id, array['owner', 'admin']) then
        raise exception 'Only owners and administrators can disable templates.' using errcode = '42501';
      end if;
    elsif old.status = 'disabled' then
      -- A sync never re-enables a template a person disabled.
      new.status := 'disabled';
    end if;
    new.approved_by := case when new.status = 'approved' and not worker then auth.uid() when new.status = 'approved' then null else old.approved_by end;
    new.approved_at := case when new.status = 'approved' then coalesce(case when worker then new.approved_at end, now()) else old.approved_at end;
  elsif not worker then
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

drop trigger if exists message_templates_guard on public.message_templates;
create trigger message_templates_guard before insert or update on public.message_templates
  for each row execute function public.guard_message_template();

-- ─── Eligibility decisions (append-only) ─────────────────────────────────────────────────────────

create table if not exists public.eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- No foreign key: the decision outlives the message it was made for.
  message_id uuid,
  -- Cleared if the business is deleted.
  business_id uuid,
  contact_point_id uuid,
  channel text not null check (channel in ('email', 'whatsapp')),
  purpose text not null check (purpose in ('introduction', 'follow_up', 'proposal', 'reply')),
  stage text not null check (stage in ('preview', 'approval', 'dispatch')),
  outcome text not null check (outcome in ('eligible', 'blocked')),
  sandbox boolean not null default false,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array' and octet_length(reasons::text) <= 10000),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array' and octet_length(checks::text) <= 20000),
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 20000),
  body_hash text check (body_hash ~ '^[0-9a-f]{64}$'),
  recipient_hash text check (recipient_hash ~ '^[0-9a-f]{64}$'),
  gateway_version text not null check (char_length(gateway_version) between 1 and 60),
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete set null (business_id),
  constraint eligibility_decisions_outcome_reasons_check check ((outcome = 'eligible') = (jsonb_array_length(reasons) = 0))
);
create index if not exists eligibility_decisions_message_idx on public.eligibility_decisions(message_id, created_at desc);
create index if not exists eligibility_decisions_business_idx on public.eligibility_decisions(business_id);

create or replace function public.guard_eligibility_decision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- A signed-in person is always the actor of their own decisions; the server names the person it acts for.
    if auth.uid() is not null then
      new.actor_id := auth.uid();
      new.actor_type := 'user';
    elsif new.actor_type = 'user' and new.actor_id is null then
      raise exception 'A decision made for a person names that person.' using errcode = '23514';
    end if;
    return new;
  end if;
  -- Append-only. The one permitted change is the foreign key clearing a deleted business.
  if new.business_id is not null or (to_jsonb(new) - 'business_id') is distinct from (to_jsonb(old) - 'business_id') then
    raise exception 'Eligibility decisions are never edited.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists eligibility_decisions_guard on public.eligibility_decisions;
create trigger eligibility_decisions_guard before insert or update on public.eligibility_decisions
  for each row execute function public.guard_eligibility_decision();

-- ─── Outbound queue ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  contact_point_id uuid,
  channel text not null check (channel in ('email', 'whatsapp')),
  purpose text not null check (purpose in ('introduction', 'follow_up', 'proposal', 'reply')),
  template_id uuid references public.message_templates(id) on delete set null,
  template_version integer,
  -- WhatsApp template parameters by name; empty for email and free-form replies.
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object' and octet_length(parameters::text) <= 5000),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 5000),
  -- SHA-256 of subject || newline || body, computed by the database.
  body_hash text not null default '' check (body_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the contact point's suppression key; the address itself is not copied here.
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  recipient_hint text not null check (char_length(recipient_hint) between 1 and 120),
  -- The inbound message this replies to (foreign key added below).
  in_reply_to uuid,
  status text not null default 'draft' check (status in ('draft', 'approved', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'bounced', 'complained', 'delivery_unknown', 'blocked', 'cancelled')),
  status_reason text check (char_length(status_reason) <= 1000),
  sandbox boolean not null default false,
  dedupe_key text check (dedupe_key ~ '^[0-9a-f]{64}$'),
  decision_id uuid references public.eligibility_decisions(id) on delete set null,
  dispatch_decision_id uuid references public.eligibility_decisions(id) on delete set null,
  provider text check (provider in ('resend', 'whatsapp_cloud', 'simulated')),
  provider_message_id text check (char_length(provider_message_id) between 1 and 200),
  created_by uuid,
  agent_version text check (char_length(agent_version) <= 60),
  approved_by uuid,
  approved_at timestamptz,
  queued_at timestamptz,
  scheduled_for timestamptz,
  sending_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (contact_point_id, business_id) references public.contact_points(id, business_id) on delete set null (contact_point_id),
  constraint outreach_messages_channel_fields_check check ((channel = 'email') = (char_length(btrim(coalesce(subject, ''))) > 0)),
  constraint outreach_messages_template_check check (template_id is null or template_version is not null),
  constraint outreach_messages_sent_check check (status not in ('sent', 'delivered', 'read') or (provider is not null and provider_message_id is not null)),
  constraint outreach_messages_approved_check check (status in ('draft', 'cancelled') or approved_at is not null)
);
create unique index if not exists outreach_messages_dedupe_idx on public.outreach_messages(organization_id, dedupe_key)
  where dedupe_key is not null and status not in ('cancelled', 'blocked', 'failed');
create unique index if not exists outreach_messages_provider_idx on public.outreach_messages(provider, provider_message_id) where provider_message_id is not null;
create index if not exists outreach_messages_business_idx on public.outreach_messages(business_id, created_at desc);
create index if not exists outreach_messages_queue_idx on public.outreach_messages(organization_id, status, scheduled_for);
create index if not exists outreach_messages_recipient_idx on public.outreach_messages(organization_id, recipient_hash, created_at desc);

-- Who may move a message between which statuses. People draft, approve, queue and cancel; only the
-- server (service role) dispatches and records delivery.
create or replace function public.guard_outreach_message() returns trigger
language plpgsql set search_path = '' as $$
declare
  lifecycle text[] := array['status', 'status_reason', 'sandbox', 'dedupe_key', 'decision_id', 'dispatch_decision_id', 'provider', 'provider_message_id',
    'approved_by', 'approved_at', 'queued_at', 'scheduled_for', 'sending_at', 'sent_at', 'delivered_at', 'read_at', 'failed_at', 'cancelled_by', 'cancelled_at',
    'updated_at', 'contact_point_id', 'template_id'];
  worker boolean := auth.uid() is null;
  d public.eligibility_decisions%rowtype;
  person_moves text[] := array['draft>approved', 'approved>draft', 'approved>queued', 'draft>cancelled', 'approved>cancelled', 'queued>cancelled'];
  worker_moves text[] := array['approved>queued', 'queued>sending', 'queued>blocked', 'queued>cancelled', 'draft>cancelled', 'approved>cancelled',
    -- A webhook can arrive before the provider's answer to the send request does.
    'sending>sent', 'sending>failed', 'sending>delivery_unknown', 'sending>delivered', 'sending>read', 'sending>bounced', 'sending>complained',
    'sent>delivered', 'sent>read', 'sent>failed', 'sent>bounced', 'sent>complained',
    'delivered>read', 'delivered>bounced', 'delivered>complained', 'read>complained',
    'delivery_unknown>sent', 'delivery_unknown>delivered', 'delivery_unknown>read', 'delivery_unknown>failed', 'delivery_unknown>bounced', 'delivery_unknown>complained'];
  move text;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.status <> 'draft' then
      raise exception 'Messages start as drafts.' using errcode = '23514';
    end if;
    if worker and new.agent_version is null then
      raise exception 'A draft made by an automated worker names the agent version.' using errcode = '23514';
    end if;
    new.body_hash := encode(sha256(convert_to(coalesce(new.subject, '') || chr(10) || new.body, 'UTF8')), 'hex');
    new.status_reason := null;
    new.sandbox := false;
    new.dedupe_key := null;
    new.decision_id := null;
    new.dispatch_decision_id := null;
    new.provider := null;
    new.provider_message_id := null;
    new.approved_by := null;
    new.approved_at := null;
    new.queued_at := null;
    new.scheduled_for := null;
    new.sending_at := null;
    new.sent_at := null;
    new.delivered_at := null;
    new.read_at := null;
    new.failed_at := null;
    new.cancelled_by := null;
    new.cancelled_at := null;
    return new;
  end if;

  -- Content (everything but the lifecycle) is editable only while the message is a draft.
  if (to_jsonb(new) - lifecycle) is distinct from (to_jsonb(old) - lifecycle) then
    if old.status <> 'draft' or new.status <> 'draft' then
      raise exception 'Only a draft can be edited; cancel this message and draft a new one.' using errcode = '23514';
    end if;
    if new.business_id <> old.business_id or new.channel <> old.channel or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at or new.agent_version is distinct from old.agent_version then
      raise exception 'A draft keeps its prospect, channel and author.' using errcode = '23514';
    end if;
    new.body_hash := encode(sha256(convert_to(coalesce(new.subject, '') || chr(10) || new.body, 'UTF8')), 'hex');
  end if;
  -- Foreign keys may clear these; nobody re-points them once the draft is approved.
  if old.status <> 'draft' and ((new.contact_point_id is not null and new.contact_point_id is distinct from old.contact_point_id)
     or (new.template_id is not null and new.template_id is distinct from old.template_id)) then
    raise exception 'Only a draft can be edited; cancel this message and draft a new one.' using errcode = '23514';
  end if;

  move := old.status || '>' || new.status;
  if not worker then
    -- People change the status (and give a reason); every other lifecycle fact is stamped below or
    -- belongs to the server.
    if new.status <> old.status and not (move = any (person_moves)) then
      raise exception 'Sending and delivery are recorded by the server; this status change is not allowed (%).', move using errcode = '42501';
    end if;
    new.sandbox := old.sandbox;
    new.dedupe_key := old.dedupe_key;
    new.decision_id := case when move = 'draft>approved' then new.decision_id else old.decision_id end;
    new.dispatch_decision_id := old.dispatch_decision_id;
    new.provider := old.provider;
    new.provider_message_id := old.provider_message_id;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.queued_at := old.queued_at;
    new.scheduled_for := case when move = 'approved>queued' then new.scheduled_for else old.scheduled_for end;
    new.sending_at := old.sending_at;
    new.sent_at := old.sent_at;
    new.delivered_at := old.delivered_at;
    new.read_at := old.read_at;
    new.failed_at := old.failed_at;
    new.cancelled_by := old.cancelled_by;
    new.cancelled_at := old.cancelled_at;
  elsif new.status <> old.status and not (move = any (worker_moves)) then
    raise exception 'This message status change is not allowed (%).', move using errcode = '23514';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if new.status = 'approved' then
    if not public.has_org_role(new.organization_id, array['owner', 'admin']) then
      raise exception 'Only owners and administrators can approve messages.' using errcode = '42501';
    end if;
    select * into d from public.eligibility_decisions e where e.id = new.decision_id and e.organization_id = new.organization_id;
    if d.id is null or d.message_id is distinct from new.id or d.stage <> 'approval' or d.outcome <> 'eligible'
       or d.body_hash is distinct from new.body_hash or d.recipient_hash is distinct from new.recipient_hash
       or d.actor_id is distinct from auth.uid() or d.created_at < now() - interval '1 hour' then
      raise exception 'Approval needs a current eligibility decision for this exact message.' using errcode = '23514';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
    new.decision_id := null;
  elsif new.status = 'queued' then
    new.queued_at := now();
    new.scheduled_for := coalesce(new.scheduled_for, now());
    new.dedupe_key := encode(sha256(convert_to(new.organization_id::text || ':' || new.channel || ':' || new.recipient_hash || ':' || new.body_hash, 'UTF8')), 'hex');
  elsif new.status = 'sending' then
    select * into d from public.eligibility_decisions e where e.id = new.dispatch_decision_id and e.organization_id = new.organization_id;
    if d.id is null or d.message_id is distinct from new.id or d.stage <> 'dispatch' or d.outcome <> 'eligible'
       or d.body_hash is distinct from new.body_hash or d.recipient_hash is distinct from new.recipient_hash or d.created_at < now() - interval '10 minutes' then
      raise exception 'Dispatch needs a current eligibility decision for this exact message.' using errcode = '23514';
    end if;
    new.sandbox := d.sandbox;
    new.sending_at := now();
  elsif new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  elsif new.status = 'delivered' then
    new.sent_at := coalesce(new.sent_at, now());
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif new.status = 'read' then
    new.sent_at := coalesce(new.sent_at, now());
    new.read_at := coalesce(new.read_at, now());
  elsif new.status in ('failed', 'bounced', 'complained', 'blocked') then
    new.failed_at := coalesce(new.failed_at, now());
  elsif new.status = 'cancelled' then
    new.cancelled_by := auth.uid();
    new.cancelled_at := now();
  end if;
  return new;
end $$;

drop trigger if exists outreach_messages_guard on public.outreach_messages;
create trigger outreach_messages_guard before insert or update on public.outreach_messages
  for each row execute function public.guard_outreach_message();

-- A permanent bounce or a complaint suppresses the recipient (a complaint on every channel).
create or replace function public.suppress_on_delivery_failure() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status not in ('bounced', 'complained') or old.status = new.status then
    return new;
  end if;
  insert into public.suppressions (organization_id, kind, value_hash, channel, hint, reason, source, note)
  values (new.organization_id, case when new.channel = 'email' then 'email' else 'phone' end, new.recipient_hash,
    case when new.status = 'bounced' then new.channel end, new.recipient_hint,
    case when new.status = 'bounced' then 'bounced' else 'complaint' end, 'provider_event', left(new.status_reason, 500))
  on conflict (organization_id, kind, match_key, channel_key) where lifted_at is null do nothing;
  return new;
end $$;

drop trigger if exists outreach_messages_delivery_suppression on public.outreach_messages;
create trigger outreach_messages_delivery_suppression after update of status on public.outreach_messages
  for each row execute function public.suppress_on_delivery_failure();

-- ─── Inbound messages ────────────────────────────────────────────────────────────────────────────

create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  -- manual: logged by a person. Manual entries never open a reply window.
  provider text not null check (provider in ('resend', 'whatsapp_cloud', 'simulated', 'manual')),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 300),
  business_id uuid,
  contact_point_id uuid,
  reply_to_message_id uuid references public.outreach_messages(id) on delete set null,
  -- SHA-256 of the sender's suppression key, so replies match contact points and suppressions.
  sender_hash text not null check (sender_hash ~ '^[0-9a-f]{64}$'),
  sender_hint text not null check (char_length(sender_hint) between 1 and 120),
  subject text check (char_length(subject) <= 300),
  -- Null when the provider does not deliver the text in its event (Resend inbound email).
  body text check (char_length(body) <= 10000),
  received_at timestamptz not null,
  opt_out boolean not null default false,
  opt_out_match text check (char_length(opt_out_match) <= 60),
  handled_at timestamptz,
  handled_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (business_id, organization_id) references public.businesses(id, organization_id) on delete cascade,
  foreign key (contact_point_id) references public.contact_points(id) on delete set null,
  constraint inbound_messages_provider_key unique (organization_id, provider, provider_message_id),
  constraint inbound_messages_opt_out_check check (opt_out = (opt_out_match is not null))
);
create index if not exists inbound_messages_sender_idx on public.inbound_messages(organization_id, sender_hash, received_at desc);
create index if not exists inbound_messages_business_idx on public.inbound_messages(business_id, received_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outreach_messages_in_reply_to_fkey') then
    alter table public.outreach_messages add constraint outreach_messages_in_reply_to_fkey
      foreign key (in_reply_to) references public.inbound_messages(id) on delete set null;
  end if;
end $$;

create or replace function public.guard_inbound_message() returns trigger
language plpgsql set search_path = '' as $$
declare
  mutable text[] := array['business_id', 'contact_point_id', 'reply_to_message_id', 'handled_at', 'handled_by'];
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.created_by is not null and new.provider <> 'manual' then
      raise exception 'Provider messages are recorded by the server; log a reply received elsewhere as manual.' using errcode = '42501';
    end if;
    if new.created_by is null and new.provider = 'manual' then
      raise exception 'A manual entry is recorded by a signed-in person.' using errcode = '23514';
    end if;
    if new.received_at > now() + interval '5 minutes' then
      raise exception 'A message cannot be received in the future.' using errcode = '23514';
    end if;
    new.handled_at := null;
    new.handled_by := null;
    return new;
  end if;
  if (to_jsonb(new) - mutable) is distinct from (to_jsonb(old) - mutable) then
    raise exception 'Received messages are not edited; only their link to a prospect and their handling change.' using errcode = '23514';
  end if;
  if new.handled_at is distinct from old.handled_at then
    new.handled_by := case when new.handled_at is null then null else auth.uid() end;
    new.handled_at := case when new.handled_at is null then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists inbound_messages_guard on public.inbound_messages;
create trigger inbound_messages_guard before insert or update on public.inbound_messages
  for each row execute function public.guard_inbound_message();

-- An opt-out reply suppresses the sender on every channel (WhatsApp policy: honour opt-outs made on
-- or off the channel). A person confirms it and records the withdrawal; nothing lifts it automatically.
create or replace function public.suppress_on_inbound_opt_out() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.opt_out then
    return new;
  end if;
  insert into public.suppressions (organization_id, kind, value_hash, business_id, channel, hint, reason, source, note)
  values (new.organization_id, case when new.channel = 'email' then 'email' else 'phone' end, new.sender_hash, null, null, new.sender_hint, 'opted_out', 'inbound_opt_out',
    left('Reply matched "' || new.opt_out_match || '"', 500))
  on conflict (organization_id, kind, match_key, channel_key) where lifted_at is null do nothing;
  return new;
end $$;

drop trigger if exists inbound_messages_opt_out on public.inbound_messages;
create trigger inbound_messages_opt_out after insert on public.inbound_messages
  for each row execute function public.suppress_on_inbound_opt_out();

-- ─── Webhook events (deduplication) ──────────────────────────────────────────────────────────────

create table if not exists public.channel_events (
  id uuid primary key default gen_random_uuid(),
  -- Null when an event matches no workspace (it is recorded and ignored).
  organization_id uuid references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('resend', 'whatsapp_cloud')),
  event_id text not null check (char_length(event_id) between 1 and 300),
  event_type text not null check (char_length(event_type) between 1 and 80),
  message_id uuid,
  outcome text not null default 'received' check (outcome in ('received', 'processed', 'ignored', 'failed')),
  detail text check (char_length(detail) <= 500),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint channel_events_event_key unique (provider, event_id)
);
create index if not exists channel_events_org_idx on public.channel_events(organization_id, received_at desc);

-- ─── Suppression sources ─────────────────────────────────────────────────────────────────────────

alter table public.suppressions drop constraint if exists suppressions_source_check;
alter table public.suppressions add constraint suppressions_source_check
  check (source in ('manual', 'consent_withdrawal', 'business_opt_out', 'agent', 'inbound_opt_out', 'provider_event'));

-- ─── Shared triggers ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists message_templates_touch on public.message_templates;
create trigger message_templates_touch before update on public.message_templates for each row execute function public.touch_updated_at();
drop trigger if exists outreach_messages_touch on public.outreach_messages;
create trigger outreach_messages_touch before update on public.outreach_messages for each row execute function public.touch_updated_at();

-- Decisions are their own audit record; inbound bodies stay out of the audit log.
do $$
declare
  t text;
begin
  foreach t in array array['message_templates', 'outreach_messages'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ─── Row Level Security ──────────────────────────────────────────────────────────────────────────

alter table public.message_templates enable row level security;
alter table public.eligibility_decisions enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.channel_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['message_templates', 'eligibility_decisions', 'outreach_messages', 'inbound_messages', 'channel_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_select', t);
  end loop;
end $$;

drop policy if exists message_templates_insert on public.message_templates;
create policy message_templates_insert on public.message_templates for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']));
drop policy if exists message_templates_update on public.message_templates;
create policy message_templates_update on public.message_templates for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));
drop policy if exists message_templates_delete on public.message_templates;
create policy message_templates_delete on public.message_templates for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists eligibility_decisions_insert on public.eligibility_decisions;
create policy eligibility_decisions_insert on public.eligibility_decisions for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));

drop policy if exists outreach_messages_insert on public.outreach_messages;
create policy outreach_messages_insert on public.outreach_messages for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));
drop policy if exists outreach_messages_update on public.outreach_messages;
create policy outreach_messages_update on public.outreach_messages for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));
-- Only unsent drafts and cancelled messages can be deleted; sent messages are the record of contact.
drop policy if exists outreach_messages_delete on public.outreach_messages;
create policy outreach_messages_delete on public.outreach_messages for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']) and status in ('draft', 'cancelled'));

drop policy if exists inbound_messages_insert on public.inbound_messages;
create policy inbound_messages_insert on public.inbound_messages for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']) and provider = 'manual');
drop policy if exists inbound_messages_update on public.inbound_messages;
create policy inbound_messages_update on public.inbound_messages for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'sales']))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'sales']));
drop policy if exists inbound_messages_delete on public.inbound_messages;
create policy inbound_messages_delete on public.inbound_messages for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']));

-- channel_events: written only by the server (no insert or update policy for people).

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────
-- Supabase's default privileges grant every role everything on new tables; take back what the
-- model forbids: decisions are append-only, webhook events are the server's.

revoke all on public.message_templates, public.eligibility_decisions, public.outreach_messages, public.inbound_messages, public.channel_events from anon;
grant select, insert, update, delete on public.message_templates, public.outreach_messages, public.inbound_messages to authenticated, service_role;
revoke update, delete, truncate on public.eligibility_decisions from authenticated, service_role;
grant select, insert on public.eligibility_decisions to authenticated, service_role;
revoke insert, update, delete, truncate on public.channel_events from authenticated;
grant select on public.channel_events to authenticated;
grant select, insert, update on public.channel_events to service_role;
revoke delete, truncate on public.channel_events from service_role;
