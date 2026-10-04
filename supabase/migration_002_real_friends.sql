-- Миграция 002: юзернеймы, аватарки, настоящая система друзей по заявкам
-- Выполните в Supabase SQL Editor — у вас уже есть база с основным schema.sql,
-- этот файл только добавляет новое и не трогает существующие тетради/заметки/флеш-карты.

create table if not exists public_profiles (
  id uuid primary key references profiles (id) on delete cascade,
  username text unique not null,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public_profiles enable row level security;

create policy "read public profiles" on public_profiles for select using (auth.uid() is not null);
create policy "create own public profile" on public_profiles for insert with check (id = auth.uid());
create policy "update own public profile" on public_profiles for update using (id = auth.uid()) with check (id = auth.uid());

create table if not exists friend_requests (
  id uuid primary key default uuid_generate_v4(),
  from_id uuid references public_profiles (id) on delete cascade not null,
  to_id uuid references public_profiles (id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  unique (from_id, to_id)
);

alter table friend_requests enable row level security;

create policy "see my requests" on friend_requests for select using (from_id = auth.uid() or to_id = auth.uid());
create policy "send request" on friend_requests for insert with check (from_id = auth.uid());
create policy "accept request" on friend_requests for update using (to_id = auth.uid()) with check (to_id = auth.uid());
create policy "cancel or remove request" on friend_requests for delete using (from_id = auth.uid() or to_id = auth.uid());

-- Старая таблица "друзья по имени" (friends) больше не используется в коде — заменена
-- на public_profiles + friend_requests выше. Данные в ней не трогаем автоматически.
-- Если хотите её удалить (когда убедитесь, что всё остальное работает), выполните отдельно:
-- drop table if exists friends;
