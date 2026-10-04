-- Миграция 004: короткий числовой ID пользователя (8 цифр, как в Telegram/Discord) —
-- по нему можно найти друга, если не получается по юзернейму. В отличие от юзернейма, ID
-- не меняется никогда, поэтому подходит для ссылок-приглашений и обращений в поддержку.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.

-- Случайный, а не порядковый номер: по порядковому можно перебрать всех пользователей подряд
-- и узнать, сколько их всего
create or replace function generate_public_id() returns bigint
language plpgsql as $$
declare
  candidate bigint;
begin
  loop
    candidate := 10000000 + floor(random() * 90000000)::bigint;
    exit when not exists (select 1 from public_profiles where public_id = candidate);
  end loop;
  return candidate;
end;
$$;

alter table public_profiles add column if not exists public_id bigint;
update public_profiles set public_id = generate_public_id() where public_id is null;
alter table public_profiles alter column public_id set not null;
do $$ begin
  alter table public_profiles add constraint public_profiles_public_id_key unique (public_id);
exception when duplicate_table or duplicate_object then null;
end $$;

-- ID выдаёт только база: при создании профиля — новый, при изменении — остаётся прежним,
-- что бы ни прислал клиент (политика "update own public profile" разрешает менять свою строку целиком)
create or replace function protect_public_id() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.public_id := generate_public_id();
  else
    new.public_id := old.public_id;
  end if;
  return new;
end;
$$;

drop trigger if exists public_profiles_public_id on public_profiles;
create trigger public_profiles_public_id before insert or update on public_profiles
  for each row execute function protect_public_id();
