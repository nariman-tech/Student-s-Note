-- Миграция 006: настоящий "поделиться" — владелец открывает тетрадь другу (только чтение).
-- Друг видит её в разделе «Со мной поделились» и может читать конспект, но не менять.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.
-- Файл можно запускать повторно.

create table if not exists notebook_shares (
  notebook_id uuid references notebooks (id) on delete cascade not null,
  -- owner_id дублирует notebooks.owner_id специально: так правила ниже не ссылаются на notebooks
  -- по кругу (notebooks → notebook_shares → notebooks), иначе Postgres выдаёт "infinite recursion"
  owner_id uuid references public_profiles (id) on delete cascade not null,
  shared_with uuid references public_profiles (id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (notebook_id, shared_with)
);

alter table notebook_shares enable row level security;

drop policy if exists "see my shares" on notebook_shares;
drop policy if exists "share own notebook with friend" on notebook_shares;
drop policy if exists "remove share" on notebook_shares;

-- Запись видят оба: владелец (кому открыл) и получатель (что открыли ему)
create policy "see my shares" on notebook_shares for select
  using (owner_id = auth.uid() or shared_with = auth.uid());

-- Открыть можно только свою тетрадь и только другу (принятая заявка в любую сторону)
create policy "share own notebook with friend" on notebook_shares for insert
  with check (
    owner_id = auth.uid()
    and exists (select 1 from notebooks n where n.id = notebook_id and n.owner_id = auth.uid())
    and exists (
      select 1 from friend_requests f
      where f.status = 'accepted'
        and ((f.from_id = auth.uid() and f.to_id = shared_with) or (f.to_id = auth.uid() and f.from_id = shared_with))
    )
  );

-- Закрыть доступ может владелец, а получатель — убрать тетрадь из своего списка
create policy "remove share" on notebook_shares for delete
  using (owner_id = auth.uid() or shared_with = auth.uid());

-- Получатель может читать саму тетрадь и конспект (только select — менять по-прежнему может лишь владелец)
drop policy if exists "read shared notebooks" on notebooks;
create policy "read shared notebooks" on notebooks for select
  using (exists (select 1 from notebook_shares s where s.notebook_id = notebooks.id and s.shared_with = auth.uid()));

drop policy if exists "read shared notes" on notes;
create policy "read shared notes" on notes for select
  using (exists (select 1 from notebook_shares s where s.notebook_id = notes.notebook_id and s.shared_with = auth.uid()));
