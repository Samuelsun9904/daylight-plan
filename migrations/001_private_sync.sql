-- Run once in the SAME Supabase project as 周期记.
-- This script only creates 日序 objects; it does not touch 周期记 tables.
begin;
create table if not exists public.rixu_tasks (
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null check (length(task_id) between 1 and 100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, task_id)
);
create table if not exists public.rixu_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  primary key (owner_id, operation_id)
);
alter table public.rixu_tasks enable row level security;
alter table public.rixu_operations enable row level security;
revoke all on public.rixu_tasks, public.rixu_operations from anon, authenticated;
grant select on public.rixu_tasks to authenticated;
drop policy if exists "rixu_read_own_tasks" on public.rixu_tasks;
create policy "rixu_read_own_tasks" on public.rixu_tasks for select to authenticated
using (owner_id = (select auth.uid()));

create or replace function public.rixu_apply_operations(operations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid(); op jsonb; current_payload jsonb; merged jsonb;
  patch jsonb; baseline jsonb; field text; conflicted boolean; target_id text;
begin
  if account is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(operations) <> 'array' or jsonb_array_length(operations) > 100 then
    raise exception 'Invalid operations';
  end if;
  -- Serialize writes per account so concurrent first inserts are also safe.
  perform pg_advisory_xact_lock(hashtextextended(account::text, 0));
  for op in select value from jsonb_array_elements(operations) loop
    target_id := op->>'id'; patch := op->'patch'; baseline := op->'base';
    if nullif(op->>'opId','') is null or length(op->>'opId') > 100
       or target_id is null or length(target_id) not between 1 and 100
       or jsonb_typeof(patch) is distinct from 'object' then raise exception 'Invalid operation'; end if;
    if exists(select 1 from public.rixu_operations where owner_id=account and operation_id=op->>'opId') then continue; end if;
    if exists(select 1 from jsonb_object_keys(patch) k where k not in
      ('title','date','time','notes','category','priority','completed','completedDate','createdAt','updatedAt','deletedAt','subtasks')) then raise exception 'Invalid fields'; end if;
    select payload into current_payload from public.rixu_tasks where owner_id=account and task_id=target_id;
    conflicted := false;
    if current_payload is not null and jsonb_typeof(baseline)='object' then
      for field in select jsonb_object_keys(patch) loop
        if field not in ('updatedAt','createdAt') and baseline ? field
          and current_payload->field is distinct from baseline->field
          and current_payload->field is distinct from patch->field then conflicted := true; end if;
      end loop;
    end if;
    if conflicted then
      -- Keep the previously saved version as a distinct recoverable record.
      insert into public.rixu_tasks(owner_id,task_id,payload)
      values(account, gen_random_uuid()::text, current_payload || jsonb_build_object(
        'title', left(current_payload->>'title',180)||'（冲突保留副本）',
        'updatedAt',now()::text));
    end if;
    merged := coalesce(current_payload,'{}'::jsonb) || patch;
    if jsonb_typeof(merged->'title') is distinct from 'string' or length(trim(merged->>'title')) not between 1 and 200
      or jsonb_typeof(merged->'completed') is distinct from 'boolean'
      or length(coalesce(merged->>'notes',''))>10000 then raise exception 'Invalid task'; end if;
    if merged ? 'subtasks' then
      if jsonb_typeof(merged->'subtasks') is distinct from 'array'
        or jsonb_array_length(merged->'subtasks') > 100 then raise exception 'Invalid subtasks'; end if;
      if exists(select 1 from jsonb_array_elements(merged->'subtasks') child where
        jsonb_typeof(child->'id') is distinct from 'string' or length(child->>'id') not between 1 and 100
        or jsonb_typeof(child->'title') is distinct from 'string' or length(trim(child->>'title')) not between 1 and 200
        or jsonb_typeof(child->'completed') is distinct from 'boolean'
        or jsonb_typeof(child->'completedAt') is distinct from 'string'
        or ((child->>'completed')::boolean and nullif(child->>'completedAt','') is null)
        or (not (child->>'completed')::boolean and child->>'completedAt' <> '')) then raise exception 'Invalid subtask fields'; end if;
      if (select count(*) from jsonb_array_elements(merged->'subtasks')) <>
        (select count(distinct child->>'id') from jsonb_array_elements(merged->'subtasks') child) then raise exception 'Duplicate subtask IDs'; end if;
      perform (child->>'completedAt')::timestamptz from jsonb_array_elements(merged->'subtasks') child where (child->>'completed')::boolean;
    end if;
    insert into public.rixu_tasks(owner_id,task_id,payload,updated_at)
    values(account,target_id,merged,now())
    on conflict(owner_id,task_id) do update set payload=excluded.payload, updated_at=excluded.updated_at;
    insert into public.rixu_operations values(account,op->>'opId');
  end loop;
end;
$$;
revoke all on function public.rixu_apply_operations(jsonb) from public, anon;
grant execute on function public.rixu_apply_operations(jsonb) to authenticated;
commit;
