-- Миграция 007: настоящие группы (участники, вступление по коду) + чат группы с фото и файлами.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.
-- Файл можно запускать повторно.

-- === Участники групп ===

create table if not exists group_members (
  group_id uuid references groups (id) on delete cascade not null,
  user_id uuid references public_profiles (id) on delete cascade not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table group_members enable row level security;

-- "Состою ли я в группе" — через функцию с security definer: правила group_members сами спрашивают
-- про group_members, и без неё Postgres ушёл бы в бесконечную рекурсию проверок
create or replace function is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

-- Создатель группы автоматически становится её участником с ролью owner
create or replace function add_group_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists groups_add_owner on groups;
create trigger groups_add_owner after insert on groups for each row execute function add_group_owner();

-- Для групп, созданных до этой миграции
insert into group_members (group_id, user_id, role)
select g.id, g.owner_id, 'owner' from groups g
where exists (select 1 from public_profiles p where p.id = g.owner_id)
on conflict do nothing;

-- Вступить по коду приглашения. Чужую группу до вступления не видно (правила ниже),
-- поэтому поиск по коду идёт внутри функции с security definer
create or replace function join_group_by_code(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
begin
  if auth.uid() is null then
    raise exception 'Не авторизованы';
  end if;
  select id into gid from groups where invite_code = upper(trim(code));
  if gid is null then
    raise exception 'Группа с таким кодом не найдена' using errcode = 'P0002';
  end if;
  insert into group_members (group_id, user_id, role) values (gid, auth.uid(), 'member')
  on conflict do nothing;
  return gid;
end;
$$;

-- Правила для групп: видят участники, меняет и удаляет только создатель
drop policy if exists "own groups" on groups;
drop policy if exists "members read groups" on groups;
drop policy if exists "create own group" on groups;
drop policy if exists "owner updates group" on groups;
drop policy if exists "owner deletes group" on groups;
create policy "members read groups" on groups for select using (owner_id = auth.uid() or is_group_member(id));
create policy "create own group" on groups for insert with check (owner_id = auth.uid());
create policy "owner updates group" on groups for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes group" on groups for delete using (owner_id = auth.uid());

-- Правила для участников: список видят участники; выйти может сам участник (кроме создателя —
-- он удаляет группу целиком), исключить — создатель. Вступление — только через join_group_by_code
drop policy if exists "members see members" on group_members;
drop policy if exists "leave or kick" on group_members;
create policy "members see members" on group_members for select using (is_group_member(group_id));
create policy "leave or kick" on group_members for delete
  using (
    (user_id = auth.uid() and role <> 'owner')
    or (role <> 'owner' and exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid()))
  );

-- === Чат группы ===

create table if not exists group_messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references groups (id) on delete cascade not null,
  -- если автор удалит аккаунт, его сообщения остаются без подписи, а не пропадают из переписки
  author_id uuid references public_profiles (id) on delete set null,
  body text not null default '' check (char_length(body) <= 4000),
  -- вложение: {url, name, type: "image" | "file", size} — сам файл лежит в Storage (бакет uploads)
  attachment jsonb,
  created_at timestamptz default now(),
  check (char_length(trim(body)) > 0 or attachment is not null)
);

create index if not exists group_messages_group_created_idx on group_messages (group_id, created_at desc);

alter table group_messages enable row level security;

drop policy if exists "members read messages" on group_messages;
drop policy if exists "members send messages" on group_messages;
drop policy if exists "delete own or as owner" on group_messages;
create policy "members read messages" on group_messages for select using (is_group_member(group_id));
create policy "members send messages" on group_messages for insert
  with check (author_id = auth.uid() and is_group_member(group_id));
create policy "delete own or as owner" on group_messages for delete
  using (author_id = auth.uid() or exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid()));

-- Новые сообщения приходят в открытый чат сразу (Supabase Realtime), без обновления страницы
do $$ begin
  alter publication supabase_realtime add table group_messages;
exception when duplicate_object then null;
end $$;
