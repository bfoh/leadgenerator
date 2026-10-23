-- Digital Opportunity Finder — sending policy (autonomous platform, phase 8).
--
-- * automation_settings gains the workspace sending policy (quiet hours, sending days, daily limits
--   per channel, per-recipient spacing and caps, follow-up limit, approval age) and a pause switch
--   that holds every dispatch, sandbox tests included. Owners and admins change both; resuming
--   needs a reason. Changes are in the existing audit trail.
-- * message_policies: approved-message policies. An owner or admin's standing approval for one
--   approved template at one version, with a daily cap and an expiry (at most 180 days). Every
--   message that is not a free-text reply must be covered by an active policy to be approved or
--   sent. Policies are never deleted: they are paused or revoked (final).
-- * eligibility_decisions gains the outcome 'deferred' (dispatch only): every failure was a timing
--   rule, so the message stays queued for later.
-- * A send-policy trigger on outreach_messages enforces, independently of the application, what
--   the gateway checks: policy cover on approval and dispatch, a schedule at most 7 days ahead,
--   and at dispatch the pause switch, quiet hours and sending days, the daily limit per channel,
--   the policy's daily cap and per-recipient spacing. Dispatches in one workspace are serialised
--   with an advisory lock so concurrent sends cannot both pass a limit.
-- * Sending to businesses stays unavailable: public.outbound_available() is unchanged (false).
-- * Additive and re-runnable; needs migrations 003 and 006. Existing rows are not modified (existing
--   workspaces get the default policy). Rollback: supabase/rollback/007_sending_policy_down.sql.

do $$
begin
  if to_regclass('public.automation_settings') is null or to_regclass('public.outreach_messages') is null then
    raise exception 'Migration 007 needs migrations 003 (automation) and 006 (messaging); apply them first.';
  end if;
end $$;

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────

-- The clock the send-policy trigger reads: always now() in a deployment. The database test suite
-- replaces it to test quiet hours at a fixed time.
create or replace function public.messaging_now() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;

create or replace function public.hhmm_minutes(t text) returns integer
language sql immutable set search_path = '' as $$
  select split_part(t, ':', 1)::integer * 60 + split_part(t, ':', 2)::integer
$$;

-- Mirrors sendingPolicySchema in src/lib/domain/sending-policy.ts. Keys may be missing (defaults
-- apply); present keys must be valid. Quiet hours always cover 22:00–06:00.
create or replace function public.valid_sending_policy(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  ranges constant jsonb := '{"recipientMinGapDays": [1, 60], "recipientMax30Days": [1, 10], "maxUnansweredFollowUps": [0, 3], "approvalMaxAgeDays": [8, 30]}';
  hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 2000 then
    return false;
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('timezone', 'quietStart', 'quietEnd', 'sendDays', 'dailyLimit', 'recipientMinGapDays', 'recipientMax30Days', 'maxUnansweredFollowUps', 'approvalMaxAgeDays') then
      return false;
    end if;
  end loop;
  if p ? 'timezone' and coalesce(p ->> 'timezone', '') not in ('Africa/Accra', 'Africa/Abidjan', 'Africa/Lagos', 'Europe/London', 'UTC') then
    return false;
  end if;
  if p ? 'quietStart' then
    if coalesce(p ->> 'quietStart', '') !~ hhmm then return false; end if;
    if public.hhmm_minutes(p ->> 'quietStart') not between 17 * 60 and 22 * 60 then return false; end if;
  end if;
  if p ? 'quietEnd' then
    if coalesce(p ->> 'quietEnd', '') !~ hhmm then return false; end if;
    if public.hhmm_minutes(p ->> 'quietEnd') not between 6 * 60 and 10 * 60 then return false; end if;
  end if;
  if p ? 'sendDays' then
    if jsonb_typeof(p -> 'sendDays') <> 'array' or jsonb_array_length(p -> 'sendDays') not between 1 and 7 then return false; end if;
    for v in select jsonb_array_elements(p -> 'sendDays') loop
      if jsonb_typeof(v) <> 'number' or v::text !~ '^[1-7]$' then return false; end if;
    end loop;
  end if;
  if p ? 'dailyLimit' then
    if jsonb_typeof(p -> 'dailyLimit') <> 'object' then return false; end if;
    for k, v in select key, value from jsonb_each(p -> 'dailyLimit') loop
      if k not in ('email', 'whatsapp') or jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,3}$' then return false; end if;
      if v::text::integer > 100 then return false; end if;
    end loop;
  end if;
  for k in select jsonb_object_keys(ranges) loop
    if p ? k then
      v := p -> k;
      if jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,3}$' then return false; end if;
      if v::text::integer not between (ranges -> k ->> 0)::integer and (ranges -> k ->> 1)::integer then return false; end if;
    end if;
  end loop;
  return true;
end $$;

-- ─── Workspace sending policy and pause ──────────────────────────────────────────────────────────

alter table public.automation_settings
  add column if not exists sending_policy jsonb not null default
    '{"timezone": "Africa/Accra", "quietStart": "19:00", "quietEnd": "08:00", "sendDays": [1, 2, 3, 4, 5, 6], "dailyLimit": {"email": 20, "whatsapp": 20}, "recipientMinGapDays": 7, "recipientMax30Days": 3, "maxUnansweredFollowUps": 2, "approvalMaxAgeDays": 14}'::jsonb,
  add column if not exists sending_paused boolean not null default false,
  add column if not exists sending_pause_reason text,
  add column if not exists sending_paused_at timestamptz,
  add column if not exists sending_paused_by uuid references auth.users(id) on delete set null;

alter table public.automation_settings drop constraint if exists automation_settings_sending_policy_check;
alter table public.automation_settings add constraint automation_settings_sending_policy_check check (public.valid_sending_policy(sending_policy));
alter table public.automation_settings drop constraint if exists automation_settings_sending_pause_reason_check;
alter table public.automation_settings add constraint automation_settings_sending_pause_reason_check check (char_length(sending_pause_reason) <= 500);

create or replace function public.guard_sending_controls() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sending_policy is distinct from old.sending_policy and not public.has_org_role(new.organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and administrators change the sending policy.' using errcode = '42501';
  end if;
  if new.sending_paused is distinct from old.sending_paused then
    if not public.has_org_role(new.organization_id, array['owner', 'admin']) then
      raise exception 'Only owners and administrators pause or resume sending.' using errcode = '42501';
    end if;
    -- Pausing is always allowed; resuming needs a new reason.
    if not new.sending_paused and (coalesce(btrim(new.sending_pause_reason), '') = '' or new.sending_pause_reason is not distinct from old.sending_pause_reason) then
      raise exception 'Record why sending is being resumed.' using errcode = '23514';
    end if;
    new.sending_pause_reason := left(coalesce(nullif(btrim(new.sending_pause_reason), ''), 'Sending paused.'), 500);
    new.sending_paused_at := now();
    new.sending_paused_by := auth.uid();
  else
    new.sending_pause_reason := old.sending_pause_reason;
    new.sending_paused_at := old.sending_paused_at;
    new.sending_paused_by := old.sending_paused_by;
  end if;
  return new;
end $$;

drop trigger if exists automation_settings_sending_guard on public.automation_settings;
create trigger automation_settings_sending_guard before update on public.automation_settings
  for each row execute function public.guard_sending_controls();

-- ─── Approved-message policies ───────────────────────────────────────────────────────────────────

create table if not exists public.message_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  channel text not null check (channel in ('email', 'whatsapp')),
  purpose text not null check (purpose in ('introduction', 'follow_up', 'proposal')),
  -- No action (not cascade): a template with a policy is disabled, not deleted.
  template_id uuid not null references public.message_templates(id),
  template_version integer not null check (template_version >= 1),
  daily_cap integer not null default 10 check (daily_cap between 1 and 50),
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  note text check (char_length(note) <= 1000),
  approved_by uuid,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_by uuid,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_policies_revoked_check check ((status = 'revoked') = (revoked_at is not null)),
  constraint message_policies_expiry_check check (expires_at > approved_at and expires_at <= approved_at + interval '180 days')
);
-- One live policy per template version.
create unique index if not exists message_policies_cover_idx on public.message_policies(organization_id, template_id, template_version) where status <> 'revoked';
create index if not exists message_policies_org_idx on public.message_policies(organization_id, status);

create or replace function public.guard_message_policy() returns trigger
language plpgsql set search_path = '' as $$
declare
  t public.message_templates%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Message policies are set by people, not by automated workers.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select * into t from public.message_templates mt where mt.id = new.template_id and mt.organization_id = new.organization_id;
    if t.id is null then
      raise exception 'Template not found.' using errcode = '23503';
    end if;
    if t.status <> 'approved' then
      raise exception 'Only an approved template can be covered by a message policy.' using errcode = '23514';
    end if;
    if t.purpose = 'reply' then
      raise exception 'Replies are answered inside the reply window and need no message policy.' using errcode = '23514';
    end if;
    -- The policy covers the template exactly as it is now; the creator is the approver.
    new.channel := t.channel;
    new.purpose := t.purpose;
    new.template_version := t.version;
    new.status := 'active';
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.revoked_by := null;
    new.revoked_at := null;
    new.created_by := auth.uid();
    new.created_at := now();
    return new;
  end if;

  if old.status = 'revoked' then
    raise exception 'A revoked policy is final; create a new one.' using errcode = '23514';
  end if;
  if new.organization_id <> old.organization_id or new.template_id <> old.template_id or new.template_version <> old.template_version
     or new.channel <> old.channel or new.purpose <> old.purpose or new.approved_by is distinct from old.approved_by
     or new.approved_at <> old.approved_at or new.expires_at <> old.expires_at or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'A policy keeps its template, version, approver and expiry; create a new policy instead.' using errcode = '23514';
  end if;
  if new.status = 'active' and old.status <> 'active' then
    if old.expires_at <= now() then
      raise exception 'The policy has expired; create a new one.' using errcode = '23514';
    end if;
    select * into t from public.message_templates mt where mt.id = old.template_id and mt.organization_id = old.organization_id;
    if t.id is null or t.status <> 'approved' or t.version <> old.template_version then
      raise exception 'The template changed or is no longer approved; create a new policy for its current version.' using errcode = '23514';
    end if;
  end if;
  if new.status = 'revoked' then
    new.revoked_by := auth.uid();
    new.revoked_at := now();
  else
    new.revoked_by := null;
    new.revoked_at := null;
  end if;
  return new;
end $$;

drop trigger if exists message_policies_guard on public.message_policies;
create trigger message_policies_guard before insert or update on public.message_policies
  for each row execute function public.guard_message_policy();
drop trigger if exists message_policies_touch on public.message_policies;
create trigger message_policies_touch before update on public.message_policies for each row execute function public.touch_updated_at();
drop trigger if exists message_policies_audit on public.message_policies;
create trigger message_policies_audit after insert or update or delete on public.message_policies
  for each row execute function public.audit_row_change();

-- ─── Deferred decisions ──────────────────────────────────────────────────────────────────────────

alter table public.eligibility_decisions drop constraint if exists eligibility_decisions_outcome_check;
alter table public.eligibility_decisions add constraint eligibility_decisions_outcome_check
  check (outcome in ('eligible', 'blocked', 'deferred') and (outcome <> 'deferred' or stage = 'dispatch'));

-- ─── Send-policy enforcement ─────────────────────────────────────────────────────────────────────

-- Runs after guard_outreach_message (triggers fire in name order) on every status change.
create or replace function public.enforce_send_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  at timestamptz := public.messaging_now();
  counted constant text[] := array['sending', 'sent', 'delivered', 'read', 'bounced', 'complained', 'delivery_unknown'];
  p jsonb;
  paused boolean;
  tz text;
  local_ts timestamp;
  mins integer;
  days integer[];
  day_start timestamptz;
  day_end timestamptz;
  pol public.message_policies%rowtype;
  n integer;
  last_at timestamptz;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('approved', 'sending') then
    if new.template_id is not null then
      select * into pol from public.message_policies mp
      where mp.organization_id = new.organization_id and mp.template_id = new.template_id and mp.template_version = new.template_version
        and mp.channel = new.channel and mp.purpose = new.purpose and mp.status = 'active' and mp.expires_at > at
      limit 1;
      if pol.id is null then
        raise exception 'No active message policy covers this template version.' using errcode = '23514';
      end if;
    elsif new.purpose <> 'reply' then
      raise exception 'Messages that do not reply to the business need a template covered by a message policy.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'queued' and new.scheduled_for > at + interval '7 days' then
    raise exception 'Messages can be scheduled up to 7 days ahead.' using errcode = '23514';
  end if;

  if new.status <> 'sending' then
    return new;
  end if;

  -- One dispatch at a time per workspace, so the counts below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('outreach-send:' || new.organization_id::text, 0));

  select s.sending_policy, s.sending_paused into p, paused from public.automation_settings s where s.organization_id = new.organization_id;
  p := coalesce(p, '{}'::jsonb);
  if coalesce(paused, false) then
    raise exception 'Sending is paused for this workspace.' using errcode = '23514';
  end if;

  tz := coalesce(p ->> 'timezone', 'Africa/Accra');
  local_ts := at at time zone tz;
  mins := extract(hour from local_ts)::integer * 60 + extract(minute from local_ts)::integer;
  days := array(select x::integer from jsonb_array_elements_text(coalesce(p -> 'sendDays', '[1, 2, 3, 4, 5, 6]'::jsonb)) x);
  if not (extract(isodow from local_ts)::integer = any (days))
     or mins < public.hhmm_minutes(coalesce(p ->> 'quietEnd', '08:00'))
     or mins >= public.hhmm_minutes(coalesce(p ->> 'quietStart', '19:00')) then
    raise exception 'Outside the sending window set by the sending policy.' using errcode = '23514';
  end if;

  day_start := date_trunc('day', local_ts) at time zone tz;
  day_end := (date_trunc('day', local_ts) + interval '1 day') at time zone tz;
  select count(*) into n from public.outreach_messages m
  where m.organization_id = new.organization_id and m.id <> new.id and m.channel = new.channel
    and m.status = any (counted) and m.sending_at >= day_start and m.sending_at < day_end;
  if n >= coalesce((p -> 'dailyLimit' ->> new.channel)::integer, 20) then
    raise exception 'The daily % limit set by the sending policy has been reached.', new.channel using errcode = '23514';
  end if;

  if pol.id is not null then
    select count(*) into n from public.outreach_messages m
    where m.organization_id = new.organization_id and m.id <> new.id and m.template_id = pol.template_id
      and m.status = any (counted) and m.sending_at >= day_start and m.sending_at < day_end;
    if n >= pol.daily_cap then
      raise exception 'The daily cap of message policy "%" has been reached.', pol.name using errcode = '23514';
    end if;
  end if;

  -- Per-recipient spacing for business-initiated messages (replies answer the business).
  if new.purpose <> 'reply' then
    select max(m.sending_at), count(*) filter (where m.sending_at > at - interval '30 days') into last_at, n
    from public.outreach_messages m
    where m.organization_id = new.organization_id and m.id <> new.id and m.recipient_hash = new.recipient_hash
      and m.purpose <> 'reply' and m.status = any (counted) and m.sending_at is not null;
    if last_at > at - make_interval(days => coalesce((p ->> 'recipientMinGapDays')::integer, 7)) then
      raise exception 'This recipient was messaged too recently for the sending policy.' using errcode = '23514';
    end if;
    if n >= coalesce((p ->> 'recipientMax30Days')::integer, 3) then
      raise exception 'This recipient has had the most messages the sending policy allows in 30 days.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists outreach_messages_send_policy on public.outreach_messages;
create trigger outreach_messages_send_policy before update on public.outreach_messages
  for each row execute function public.enforce_send_policy();

-- ─── Row Level Security and grants ───────────────────────────────────────────────────────────────

alter table public.message_policies enable row level security;

drop policy if exists message_policies_select on public.message_policies;
create policy message_policies_select on public.message_policies for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists message_policies_insert on public.message_policies;
create policy message_policies_insert on public.message_policies for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']));
drop policy if exists message_policies_update on public.message_policies;
create policy message_policies_update on public.message_policies for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));
-- No delete policy: policies are paused or revoked, never deleted.

revoke all on public.message_policies from anon;
revoke delete, truncate on public.message_policies from authenticated;
grant select, insert, update on public.message_policies to authenticated;
-- The server reads policies; it never sets them.
revoke insert, update, delete, truncate on public.message_policies from service_role;
grant select on public.message_policies to service_role;
