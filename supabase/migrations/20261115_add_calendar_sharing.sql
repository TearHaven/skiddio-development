alter table public.tasks
  add column if not exists end_date date;

update public.tasks
set end_date = task_date
where end_date is null;

alter table public.tasks
  alter column end_date set not null;

create table if not exists public.calendar_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  permission text not null default 'view' check (permission in ('view', 'edit')),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.calendar_shares enable row level security;

revoke all on table public.calendar_shares from public, anon, authenticated;
grant select, insert, update on table public.calendar_shares to authenticated;

drop policy if exists calendar_shares_select_owner on public.calendar_shares;
create policy calendar_shares_select_owner
  on public.calendar_shares for select
  using (auth.uid() = owner_id);

drop policy if exists calendar_shares_insert_owner on public.calendar_shares;
create policy calendar_shares_insert_owner
  on public.calendar_shares for insert
  with check (auth.uid() = owner_id);

drop policy if exists calendar_shares_update_owner on public.calendar_shares;
create policy calendar_shares_update_owner
  on public.calendar_shares for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function public.get_shared_calendar(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_permission text;
  v_events jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select cs.owner_id, cs.permission
    into v_owner_id, v_permission
    from public.calendar_shares cs
   where cs.token_hash = pg_catalog.encode(
     pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')),
     'hex'
   )
     and cs.revoked_at is null;

  if not found then
    return null;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'task_date', t.task_date,
        'end_date', t.end_date,
        'start_time', t.start_time,
        'end_time', t.end_time,
        'completed', t.completed,
        'is_rescheduled', t.is_rescheduled,
        'reschedule_reason', t.reschedule_reason,
        'note', t.note
      )
      order by t.task_date, t.start_time, t.id
    ),
    '[]'::jsonb
  )
    into v_events
    from public.tasks t
   where t.user_id = v_owner_id;

  return pg_catalog.jsonb_build_object(
    'permission', v_permission,
    'events', v_events
  );
end;
$$;

create or replace function public.save_shared_task(
  p_token text,
  p_task_id text,
  p_title text,
  p_task_date date,
  p_end_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_permission text;
  v_task public.tasks%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'This share link is invalid or has been revoked.';
  end if;

  select cs.owner_id, cs.permission
    into v_owner_id, v_permission
    from public.calendar_shares cs
   where cs.token_hash = pg_catalog.encode(
     pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')),
     'hex'
   )
     and cs.revoked_at is null
   for share;

  if not found then
    raise exception 'This share link is invalid or has been revoked.';
  end if;
  if v_permission <> 'edit' then
    raise exception 'This share link only allows viewing.';
  end if;
  if p_title is null or pg_catalog.length(pg_catalog.btrim(p_title)) = 0 or pg_catalog.length(pg_catalog.btrim(p_title)) > 120 then
    raise exception 'A schedule title must be between 1 and 120 characters.';
  end if;
  if p_task_date is null or p_end_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Choose valid start and end dates and times.';
  end if;
  if p_end_date < p_task_date then
    raise exception 'The end date must be on or after the start date.';
  end if;
  if p_end_date - p_task_date > 6 then
    raise exception 'A schedule can span at most 7 calendar days.';
  end if;
  if p_end_date = p_task_date and p_end_time <= p_start_time then
    raise exception 'The end time must be after the start time.';
  end if;
  if p_note is not null and pg_catalog.length(p_note) > 500 then
    raise exception 'Schedule notes must be 500 characters or fewer.';
  end if;

  if p_task_id is null then
    insert into public.tasks (
      user_id, title, task_date, end_date, start_time, end_time, note
    ) values (
      v_owner_id, pg_catalog.btrim(p_title), p_task_date, p_end_date, p_start_time, p_end_time, p_note
    )
    returning * into v_task;
  else
    update public.tasks t
       set title = pg_catalog.btrim(p_title),
           task_date = p_task_date,
           end_date = p_end_date,
           start_time = p_start_time,
           end_time = p_end_time,
           note = p_note
     where t.id::text = p_task_id
       and t.user_id = v_owner_id
    returning t.* into v_task;

    if not found then
      raise exception 'This schedule no longer exists.';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_task.id,
    'title', v_task.title,
    'task_date', v_task.task_date,
    'end_date', v_task.end_date,
    'start_time', v_task.start_time,
    'end_time', v_task.end_time,
    'completed', v_task.completed,
    'is_rescheduled', v_task.is_rescheduled,
    'reschedule_reason', v_task.reschedule_reason,
    'note', v_task.note
  );
end;
$$;

create or replace function public.set_shared_task_completion(
  p_token text,
  p_task_id text,
  p_completed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_permission text;
  v_task public.tasks%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'This share link is invalid or has been revoked.';
  end if;
  if p_completed is null then
    raise exception 'A completion value is required.';
  end if;

  select cs.owner_id, cs.permission
    into v_owner_id, v_permission
    from public.calendar_shares cs
   where cs.token_hash = pg_catalog.encode(
     pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')),
     'hex'
   )
     and cs.revoked_at is null
   for share;

  if not found then
    raise exception 'This share link is invalid or has been revoked.';
  end if;
  if v_permission <> 'edit' then
    raise exception 'This share link only allows viewing.';
  end if;

  update public.tasks t
     set completed = p_completed
   where t.id::text = p_task_id
     and t.user_id = v_owner_id
  returning t.* into v_task;

  if not found then
    raise exception 'This schedule no longer exists.';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_task.id,
    'completed', v_task.completed
  );
end;
$$;

revoke all on function public.get_shared_calendar(text) from public;
revoke all on function public.save_shared_task(text, text, text, date, date, time without time zone, time without time zone, text) from public;
revoke all on function public.set_shared_task_completion(text, text, boolean) from public;

grant execute on function public.get_shared_calendar(text) to anon, authenticated;
grant execute on function public.save_shared_task(text, text, text, date, date, time without time zone, time without time zone, text) to anon, authenticated;
grant execute on function public.set_shared_task_completion(text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
