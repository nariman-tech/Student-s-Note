-- Миграция 008: "поделиться" модулем флеш-карт с другом — так же, как тетрадью (только изучать, не менять).
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.
-- Файл можно запускать повторно.

create table if not exists flashcard_set_shares (
  set_id uuid references flashcard_sets (id) on delete cascade not null,
  -- owner_id дублирует flashcard_sets.owner_id, чтобы правила не ссылались друг на друга по кругу
  owner_id uuid references public_profiles (id) on delete cascade not null,
  shared_with uuid references public_profiles (id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (set_id, shared_with)
);

alter table flashcard_set_shares enable row level security;

drop policy if exists "see my set shares" on flashcard_set_shares;
drop policy if exists "share own set with friend" on flashcard_set_shares;
drop policy if exists "remove set share" on flashcard_set_shares;

create policy "see my set shares" on flashcard_set_shares for select
  using (owner_id = auth.uid() or shared_with = auth.uid());

create policy "share own set with friend" on flashcard_set_shares for insert
  with check (
    owner_id = auth.uid()
    and exists (select 1 from flashcard_sets s where s.id = set_id and s.owner_id = auth.uid())
    and exists (
      select 1 from friend_requests f
      where f.status = 'accepted'
        and ((f.from_id = auth.uid() and f.to_id = shared_with) or (f.to_id = auth.uid() and f.from_id = shared_with))
    )
  );

create policy "remove set share" on flashcard_set_shares for delete
  using (owner_id = auth.uid() or shared_with = auth.uid());

drop policy if exists "read shared sets" on flashcard_sets;
create policy "read shared sets" on flashcard_sets for select
  using (exists (select 1 from flashcard_set_shares s where s.set_id = flashcard_sets.id and s.shared_with = auth.uid()));

drop policy if exists "read shared flashcards" on flashcards;
create policy "read shared flashcards" on flashcards for select
  using (exists (select 1 from flashcard_set_shares s where s.set_id = flashcards.set_id and s.shared_with = auth.uid()));
