-- Миграция 017: закреплённое сообщение в чате группы и счётчик непрочитанных.
-- Выполните в Supabase SQL Editor (Run). Можно запускать повторно.

-- === Закреплённое сообщение ===
-- Одно на группу. Закрепить и открепить может любой участник. Если сообщение удалят,
-- закрепление снимется само (on delete set null)
alter table groups add column if not exists pinned_message_id uuid references group_messages (id) on delete set null;
alter table groups add column if not exists pinned_by uuid references public_profiles (id) on delete set null;
alter table groups add column if not exists pinned_at timestamptz;

-- Менять группу напрямую может только создатель (правило "owner updates group"), поэтому
-- закрепление — через функцию: она проверяет, что вы участник и сообщение из этой группы
create or replace function pin_group_message(gid uuid, mid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_group_member(gid) then
    raise exception 'Вы не состоите в этой группе' using errcode = '42501';
  end if;
  if mid is not null and not exists (select 1 from group_messages where id = mid and group_id = gid) then
    raise exception 'Сообщение не найдено' using errcode = 'P0002';
  end if;
  update groups
    set pinned_message_id = mid,
        pinned_by = case when mid is null then null else auth.uid() end,
        pinned_at = case when mid is null then null else now() end
    where id = gid;
end;
$$;
revoke all on function pin_group_message(uuid, uuid) from public, anon;
grant execute on function pin_group_message(uuid, uuid) to authenticated;

-- Закрепление появляется у всех участников сразу, без обновления страницы (Supabase Realtime)
do $$ begin
  alter publication supabase_realtime add table groups;
exception when duplicate_object then null;
end $$;

-- === Непрочитанные сообщения ===
-- Когда каждый участник последний раз открывал чат группы
create table if not exists group_reads (
  group_id uuid references groups (id) on delete cascade not null,
  user_id uuid references public_profiles (id) on delete cascade not null,
  last_read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table group_reads enable row level security;
drop policy if exists "own reads" on group_reads;
create policy "own reads" on group_reads for select using (user_id = auth.uid());
-- Записывать — только через mark_group_read

create or replace function mark_group_read(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_group_member(gid) then
    return;
  end if;
  insert into group_reads (group_id, user_id, last_read_at) values (gid, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = greatest(group_reads.last_read_at, excluded.last_read_at);
end;
$$;
revoke all on function mark_group_read(uuid) from public, anon;
grant execute on function mark_group_read(uuid) to authenticated;

-- Сколько чужих сообщений пришло в каждой моей группе с тех пор, как я открывал её чат.
-- Если ещё ни разу не открывал — считаем с момента вступления (старая переписка не «непрочитанная»)
create or replace function my_unread_counts() returns table (gid uuid, unread bigint, read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select gm.group_id,
         (select count(*) from group_messages m
            where m.group_id = gm.group_id
              and m.created_at > coalesce(r.last_read_at, gm.joined_at, '-infinity'::timestamptz)
              and m.author_id is distinct from auth.uid()),
         coalesce(r.last_read_at, gm.joined_at)
  from group_members gm
  left join group_reads r on r.group_id = gm.group_id and r.user_id = gm.user_id
  where gm.user_id = auth.uid();
$$;
revoke all on function my_unread_counts() from public, anon;
grant execute on function my_unread_counts() to authenticated;
