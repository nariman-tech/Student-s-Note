-- Миграция 018: «живые» обновления через Broadcast вместо Postgres Changes.
-- Выполните в Supabase SQL Editor (Run). Можно запускать повторно.
--
-- Зачем: раньше каждое новое сообщение в чате база проверяла отдельно для КАЖДОГО онлайн-пользователя
-- (так устроены Postgres Changes) — при тысячах онлайн это упирается в один поток и тормозит всё.
-- Теперь база один раз отправляет событие в «комнату» (топик), а права на комнату проверяются
-- один раз — когда человек к ней подключается.
--
-- Комнаты:
--   group:<id группы>  — новые и удалённые сообщения чата, закрепление; слушают участники группы
--   page:<id страницы> — страницу тетради группы кто-то изменил; слушают те, кто может её читать
--
-- Приложение само проверяет, выполнена ли эта миграция (realtime_broadcast_enabled), и без неё
-- работает по-старому.

-- === Кто может слушать какую комнату ===
-- security invoker: проверка «может ли читать страницу» идёт по обычным правилам таблицы notes
create or replace function public.realtime_topic_allowed(topic text) returns boolean
language plpgsql stable security invoker set search_path = public as $$
declare
  kind text := split_part(topic, ':', 1);
  rid text := split_part(topic, ':', 2);
begin
  if rid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if kind = 'group' then
    return is_group_member(rid::uuid);
  elsif kind = 'page' then
    return exists (select 1 from notes where id = rid::uuid);
  end if;
  return false;
end;
$$;

-- Получать события — только из разрешённых комнат. Отправлять в эти комнаты из приложения нельзя
-- (правила на insert нет): события присылает только сама база, триггерами ниже
drop policy if exists "lectiva receive broadcasts" on realtime.messages;
create policy "lectiva receive broadcasts" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.realtime_topic_allowed((select realtime.topic())));

-- === Сообщения чата ===
create or replace function public.broadcast_group_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform realtime.send(to_jsonb(new), 'message_insert', 'group:' || new.group_id::text, true);
  elsif tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', old.id), 'message_delete', 'group:' || old.group_id::text, true);
  end if;
  return null;
end;
$$;
drop trigger if exists group_messages_broadcast on group_messages;
create trigger group_messages_broadcast after insert or delete on group_messages
  for each row execute function public.broadcast_group_message();

-- === Закреплённое сообщение ===
create or replace function public.broadcast_group_pin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pinned_message_id is distinct from old.pinned_message_id then
    perform realtime.send(
      jsonb_build_object('pinned_message_id', new.pinned_message_id, 'pinned_by', new.pinned_by),
      'pin', 'group:' || new.id::text, true);
  end if;
  return null;
end;
$$;
drop trigger if exists groups_pin_broadcast on groups;
create trigger groups_pin_broadcast after update on groups
  for each row execute function public.broadcast_group_pin();

-- === Страница тетради изменилась ===
-- Отправляем только «кто и когда», без текста: конспект может быть большим, приложение
-- само дозагрузит страницу
create or replace function public.broadcast_note_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.updated_at is distinct from old.updated_at then
    perform realtime.send(
      jsonb_build_object('id', new.id, 'updated_at', new.updated_at, 'updated_by', new.updated_by),
      'page_update', 'page:' || new.id::text, true);
  end if;
  return null;
end;
$$;
drop trigger if exists notes_broadcast on notes;
create trigger notes_broadcast after update on notes
  for each row execute function public.broadcast_note_change();

-- Метка для приложения: Broadcast включён
create or replace function public.realtime_broadcast_enabled() returns boolean
language sql stable as $$ select true $$;
grant execute on function public.realtime_broadcast_enabled() to authenticated;
