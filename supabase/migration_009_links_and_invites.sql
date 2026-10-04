-- Миграция 009: добавление друзей в группу + доступ по ссылке (для мессенджеров).
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.
-- Файл можно запускать повторно.

-- === Добавить друга в группу ===
-- Любой участник группы может добавить своего друга (принятая заявка в любую сторону).
-- Через функцию с security definer, потому что напрямую вставлять в group_members запрещено.
create or replace function add_friend_to_group(gid uuid, friend uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Не авторизованы';
  end if;
  if not exists (select 1 from group_members where group_id = gid and user_id = auth.uid()) then
    raise exception 'Вы не состоите в этой группе' using errcode = '42501';
  end if;
  if not exists (
    select 1 from friend_requests f
    where f.status = 'accepted'
      and ((f.from_id = auth.uid() and f.to_id = friend) or (f.to_id = auth.uid() and f.from_id = friend))
  ) then
    raise exception 'Добавить можно только друга' using errcode = '42501';
  end if;
  insert into group_members (group_id, user_id, role) values (gid, friend, 'member')
  on conflict do nothing;
end;
$$;

-- === Доступ по ссылке ===
-- share_token — случайная строка; пока она задана, тетрадь/модуль открывается по ссылке
-- /s/n/<token> или /s/f/<token> даже без аккаунта (только чтение). Владелец может выключить
-- доступ в любой момент — тогда старая ссылка перестанет работать.
alter table notebooks add column if not exists share_token text unique check (share_token is null or char_length(share_token) >= 20);
alter table flashcard_sets add column if not exists share_token text unique check (share_token is null or char_length(share_token) >= 20);

-- Чтение по ссылке — через функции: сами таблицы для гостей закрыты, а функция отдаёт
-- ровно одну тетрадь с совпавшим токеном и только нужные для показа поля
create or replace function get_public_notebook(token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'title', n.title,
    'icon_emoji', n.icon_emoji,
    'cover_image_url', n.cover_image_url,
    'spine_color', n.spine_color,
    'content', coalesce(nt.content, ''),
    'attachments', coalesce(nt.attachments, '[]'::jsonb),
    'owner_username', p.username
  )
  from notebooks n
  left join notes nt on nt.notebook_id = n.id
  left join public_profiles p on p.id = n.owner_id
  where token is not null and n.share_token = token;
$$;

create or replace function get_public_flashcard_set(token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'title', s.title,
    'color', s.color,
    'owner_username', p.username,
    'cards', coalesce((select json_agg(json_build_object('id', c.id, 'front', c.front, 'back', c.back)) from flashcards c where c.set_id = s.id), '[]'::json)
  )
  from flashcard_sets s
  left join public_profiles p on p.id = s.owner_id
  where token is not null and s.share_token = token;
$$;

grant execute on function get_public_notebook(text) to anon, authenticated;
grant execute on function get_public_flashcard_set(text) to anon, authenticated;
