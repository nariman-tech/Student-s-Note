-- Миграция 013: общие тетради группы — все участники группы читают и дописывают конспекты курса.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше. Можно запускать повторно.

-- Тетрадь группы — обычная тетрадь с group_id. owner_id — кто её создал.
alter table notebooks add column if not exists group_id uuid references groups (id) on delete cascade;
create index if not exists notebooks_group_idx on notebooks (group_id) where group_id is not null;

-- Кто последним изменил страницу — «изменено @anna»; и для защиты от затирания чужих правок
alter table notes add column if not exists updated_by uuid references public_profiles (id) on delete set null;

-- Свою тетрадь можно положить только в группу, где состоишь (иначе можно было бы подкинуть
-- тетрадь в чужую группу)
drop policy if exists "own notebooks" on notebooks;
create policy "own notebooks" on notebooks for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (group_id is null or is_group_member(group_id)));

-- Участники группы: видят и меняют тетради группы (название, обложку)
drop policy if exists "group members read group notebooks" on notebooks;
drop policy if exists "group members update group notebooks" on notebooks;
drop policy if exists "group owner deletes group notebooks" on notebooks;
create policy "group members read group notebooks" on notebooks for select
  using (group_id is not null and is_group_member(group_id));
create policy "group members update group notebooks" on notebooks for update
  using (group_id is not null and is_group_member(group_id))
  with check (group_id is not null and is_group_member(group_id));
-- Удалить тетрадь группы может её автор (правило "own notebooks") или создатель группы
create policy "group owner deletes group notebooks" on notebooks for delete
  using (group_id is not null and exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid()));

-- Автора и группу тетради менять нельзя — ни владельцу, ни участникам
create or replace function protect_notebook_owner() returns trigger
language plpgsql as $$
begin
  new.owner_id := old.owner_id;
  new.group_id := old.group_id;
  return new;
end;
$$;
drop trigger if exists notebooks_protect_owner on notebooks;
create trigger notebooks_protect_owner before update on notebooks
  for each row execute function protect_notebook_owner();

-- Страницы тетрадей группы: участники читают, добавляют, правят и удаляют любые страницы
drop policy if exists "group members read group pages" on notes;
drop policy if exists "group members add group pages" on notes;
drop policy if exists "group members edit group pages" on notes;
drop policy if exists "group members delete group pages" on notes;
create policy "group members read group pages" on notes for select
  using (exists (select 1 from notebooks n where n.id = notes.notebook_id and n.group_id is not null and is_group_member(n.group_id)));
create policy "group members add group pages" on notes for insert
  with check (
    owner_id = auth.uid()
    and exists (select 1 from notebooks n where n.id = notes.notebook_id and n.group_id is not null and is_group_member(n.group_id))
  );
create policy "group members edit group pages" on notes for update
  using (exists (select 1 from notebooks n where n.id = notes.notebook_id and n.group_id is not null and is_group_member(n.group_id)))
  with check (exists (select 1 from notebooks n where n.id = notes.notebook_id and n.group_id is not null and is_group_member(n.group_id)));
create policy "group members delete group pages" on notes for delete
  using (exists (select 1 from notebooks n where n.id = notes.notebook_id and n.group_id is not null and is_group_member(n.group_id)));

-- Правки страницы приходят другим участникам сразу, без обновления (Supabase Realtime)
do $$ begin
  alter publication supabase_realtime add table notes;
exception when duplicate_object then null;
end $$;
