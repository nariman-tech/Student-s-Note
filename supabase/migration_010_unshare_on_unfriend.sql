-- Миграция 010: когда дружба заканчивается (заявку удалили — кнопкой «Удалить из друзей» или как угодно ещё),
-- база сама закрывает доступ к тетрадям и модулям флеш-карт, которыми эти двое делились друг с другом.
-- Раньше это делало только приложение, и доступ мог остаться, если дружбу удалили другим путём.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше. Можно запускать повторно.

create or replace function unshare_on_unfriend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from notebook_shares
  where (owner_id = old.from_id and shared_with = old.to_id) or (owner_id = old.to_id and shared_with = old.from_id);
  delete from flashcard_set_shares
  where (owner_id = old.from_id and shared_with = old.to_id) or (owner_id = old.to_id and shared_with = old.from_id);
  return old;
end;
$$;

drop trigger if exists friend_requests_unshare on friend_requests;
create trigger friend_requests_unshare after delete on friend_requests
  for each row execute function unshare_on_unfriend();

-- Разовая уборка: доступы, оставшиеся от уже закончившихся дружб
delete from notebook_shares s
where not exists (
  select 1 from friend_requests f
  where f.status = 'accepted'
    and ((f.from_id = s.owner_id and f.to_id = s.shared_with) or (f.to_id = s.owner_id and f.from_id = s.shared_with))
);
delete from flashcard_set_shares s
where not exists (
  select 1 from friend_requests f
  where f.status = 'accepted'
    and ((f.from_id = s.owner_id and f.to_id = s.shared_with) or (f.to_id = s.owner_id and f.from_id = s.shared_with))
);
