-- =============================================================================
-- 0007_rpc_messages.sql — 1:1 chat about a shift and notification housekeeping
-- (ARCHITECTURE §6.3 "Messages & notifications").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- send_message — chat is always between the poster and one other member who
-- has a request on the shift (any status) or is its coverer. The recipient gets
-- at most one unread `message` notification per (shift, sender): later messages
-- refresh that notification (new text, bumped time, pushed again) instead of
-- adding another.
-- -----------------------------------------------------------------------------
create or replace function public.send_message(p_shift_id uuid, p_recipient_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_body text := btrim(p_body);
  v_shift public.shifts;
  v_other uuid;
  v_id uuid;
begin
  if v_body is null or char_length(v_body) = 0 then
    perform private.fail('Type a message first.', 'INVALID_INPUT');
  end if;
  if char_length(v_body) > 1000 then
    perform private.fail('Messages can be at most 1000 characters.', 'INVALID_INPUT');
  end if;

  select * into v_shift from public.shifts s where s.id = p_shift_id;
  if not found then
    perform private.fail('That shift no longer exists.', 'NOT_FOUND');
  end if;

  -- The pair must be {poster, X}; X is whichever of the two isn't the poster.
  v_other := case
    when p_recipient_id is null or p_recipient_id = v_me.id then null
    when v_me.id = v_shift.poster_id then p_recipient_id
    when p_recipient_id = v_shift.poster_id then v_me.id
  end;
  if v_other is null or not (
    v_other is not distinct from v_shift.coverer_id
    or exists (
      select 1 from public.shift_requests r
      where r.shift_id = v_shift.id and r.requester_id = v_other
    )
  ) then
    perform private.fail('You can only message the other member in this trade or request.', 'NOT_PARTICIPANT');
  end if;

  insert into public.messages (shift_id, sender_id, recipient_id, body)
  values (v_shift.id, v_me.id, p_recipient_id, v_body)
  returning id into v_id;

  insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
  values (
    p_recipient_id,
    'message',
    format('Message from %s', v_me.full_name),
    case when char_length(v_body) > 140 then left(v_body, 139) || '…' else v_body end,
    '/trades/' || v_shift.id,
    v_shift.id,
    v_me.id
  )
  on conflict (user_id, shift_id, actor_id) where type = 'message' and read_at is null
  do update set
    title = excluded.title,
    body = excluded.body,
    created_at = now(),
    pushed_at = null;

  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- mark_thread_read — marks the other member's messages to me on this shift as
-- read, together with their chat notification.
-- -----------------------------------------------------------------------------
create or replace function public.mark_thread_read(p_shift_id uuid, p_other_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
begin
  update public.messages m
     set read_at = now()
   where m.shift_id = p_shift_id
     and m.sender_id = p_other_id
     and m.recipient_id = v_me.id
     and m.read_at is null;

  update public.notifications n
     set read_at = now()
   where n.user_id = v_me.id
     and n.type = 'message'
     and n.shift_id = p_shift_id
     and n.actor_id = p_other_id
     and n.read_at is null;
end
$$;

-- -----------------------------------------------------------------------------
-- mark_notifications_read — the given notifications of mine, or all of mine
-- when p_ids is null. Any signed-in member (pending members get notices too).
-- -----------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(false);
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = v_me.id
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
end
$$;
