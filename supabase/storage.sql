-- Хранилище файлов (картинки, обложки, аватарки, PDF) — Supabase Storage вместо base64 в таблицах.
-- Выполните этот файл в Supabase SQL Editor один раз (Project → SQL Editor → New query → Run).
-- Для нового проекта он уже включён в конец schema.sql — отдельно запускать не нужно.

-- Бакет "uploads": файлы до 20 МБ. public = true значит, что файл открывается по прямой ссылке
-- без входа — это нужно, чтобы <img> и PDF в конспекте показывались без лишних запросов.
-- Ссылки содержат случайный uuid, угадать их нельзя, а получить список файлов чужого человека
-- политики ниже не дают.
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', true, 20971520)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Каждый пользователь работает только со своей папкой {user_id}/...
drop policy if exists "uploads: read own" on storage.objects;
drop policy if exists "uploads: insert own" on storage.objects;
drop policy if exists "uploads: update own" on storage.objects;
drop policy if exists "uploads: delete own" on storage.objects;

create policy "uploads: read own" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads: insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads: update own" on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
