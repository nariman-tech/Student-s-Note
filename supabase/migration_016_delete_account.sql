-- Миграция 016: удаление аккаунта из приложения (Настройки → «Удалить аккаунт»).
-- Выполните в Supabase SQL Editor (Run). Можно запускать повторно.
--
-- Что происходит при удалении:
--   • личные тетради, страницы, флеш-карты, друзья, заявки, профиль — удаляются (on delete cascade);
--   • группы, которые создал пользователь, переходят к участнику, вступившему раньше всех;
--     группа удаляется, только если в ней больше никого нет;
--   • тетради групп и страницы, которые он писал в общих тетрадях, остаются у группы —
--     их автором становится создатель группы (или владелец тетради);
--   • сообщения в чатах групп остаются без автора (author_id = null), как и раньше.
-- Файлы (картинки, PDF) приложение удаляет само перед вызовом этой функции.

-- Автора тетради менять нельзя (migration_013) — кроме как при удалении аккаунта: функция ниже
-- включает флаг только внутри своей транзакции, из приложения его не выставить
create or replace function protect_notebook_owner() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('lectiva.account_deletion', true), '') = 'on' then
    return new;
  end if;
  new.owner_id := old.owner_id;
  new.group_id := old.group_id;
  return new;
end;
$$;

create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g record;
  heir uuid;
begin
  if me is null then
    raise exception 'Не авторизованы';
  end if;

  perform set_config('lectiva.account_deletion', 'on', true);

  -- 1. Группы, которые я создал: передаём самому раннему участнику или удаляем пустые
  for g in select id from groups where owner_id = me loop
    select user_id into heir
      from group_members
      where group_id = g.id and user_id <> me
      order by joined_at asc nulls last
      limit 1;
    if heir is null then
      delete from groups where id = g.id;
    else
      update groups set owner_id = heir where id = g.id;
      update group_members set role = 'owner' where group_id = g.id and user_id = heir;
    end if;
  end loop;

  -- 2. Тетради групп, которые я создал, остаются группе — автором становится создатель группы
  update notebooks n
    set owner_id = gr.owner_id
    from groups gr
    where n.group_id = gr.id and n.owner_id = me and gr.owner_id <> me;

  -- 3. Мои страницы в чужих тетрадях (общие тетради групп) — переходят владельцу тетради
  update notes nt
    set owner_id = n.owner_id
    from notebooks n
    where nt.notebook_id = n.id and nt.owner_id = me and n.owner_id <> me;

  -- 4. Сам аккаунт — остальное удалится каскадом (profiles → тетради, карты, друзья…)
  delete from auth.users where id = me;
end;
$$;

-- Приложение спрашивает это перед тем, как стирать файлы: если миграция не выполнена,
-- файлы не трогаем (иначе аккаунт остался бы, а картинки в тетрадях пропали)
create or replace function account_deletion_available() returns boolean
language sql stable as $$ select true $$;
grant execute on function account_deletion_available() to authenticated;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
