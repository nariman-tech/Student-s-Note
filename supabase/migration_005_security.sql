-- Миграция 005: закрываем дыры в правилах доступа (RLS), найденные при проверке безопасности.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.
-- Файл можно запускать повторно — ничего не сломается.

-- 1. Заявки в друзья.
-- Было: отправитель мог сразу вставить заявку со status = 'accepted' — и стать "другом" кого угодно
-- без согласия. А адресат при "принятии" мог заодно переписать from_id на любого другого человека.
-- Стало: новая заявка — только 'pending' и не самому себе; принять — только свою входящую
-- pending-заявку, и менять при этом можно только status.
drop policy if exists "send request" on friend_requests;
create policy "send request" on friend_requests for insert
  with check (from_id = auth.uid() and status = 'pending' and from_id <> to_id);

drop policy if exists "accept request" on friend_requests;
create policy "accept request" on friend_requests for update
  using (to_id = auth.uid() and status = 'pending')
  with check (to_id = auth.uid() and status = 'accepted');

revoke update on friend_requests from anon, authenticated;
grant update (status) on friend_requests to authenticated;

-- 2. Заметки.
-- Было: проверялся только owner_id, поэтому можно было создать заметку с notebook_id чужой тетради
-- (если узнать её id) — и владелец больше не смог бы сохранить свой конспект.
-- Стало: заметку можно создать/изменить только в своей тетради.
drop policy if exists "own notes" on notes;
create policy "own notes" on notes for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from notebooks n where n.id = notebook_id and n.owner_id = auth.uid())
  );

-- 3. Флеш-карты — то же самое: карточку можно добавить только в свой набор.
drop policy if exists "own flashcards" on flashcards;
create policy "own flashcards" on flashcards for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from flashcard_sets s where s.id = set_id and s.owner_id = auth.uid())
  );

-- 4. Юзернейм: раньше формат проверялся только в приложении, а напрямую через API можно было
-- записать что угодно (пробелы, эмодзи, текст на 10 000 символов). not valid — старые юзернеймы
-- не проверяются, правило действует для новых и изменённых.
do $$ begin
  alter table public_profiles add constraint public_profiles_username_format
    check (username ~ '^[a-z0-9_]{1,30}$') not valid;
exception when duplicate_object then null;
end $$;
