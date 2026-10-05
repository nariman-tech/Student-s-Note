-- Схема базы данных приложения Lectiva
-- Выполните этот файл в Supabase SQL Editor (Project → SQL Editor → New query → Run)

create extension if not exists "uuid-ossp";

-- Один ряд на аккаунт Supabase Auth. Создаётся автоматически при первом входе (см. src/lib/auth.ts)
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  gender text check (gender in ('male', 'female', 'unspecified')),
  created_at timestamptz default now()
);

create table notebooks (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references profiles (id) on delete cascade not null,
  title text not null,
  icon_emoji text default '📓',
  cover_image_url text,
  spine_color text default '#8C8FE0',
  course_tag text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Одна заметка на тетрадь. content — HTML конспекта; вставленные картинки/файлы лежат
-- в Supabase Storage (бакет "uploads"), а в HTML только ссылки на них — см. src/lib/upload.ts.
-- attachments — скриншоты решений из режима рисования, jsonb-массив {id,type,url,name}.
create table notes (
  notebook_id uuid primary key references notebooks (id) on delete cascade,
  owner_id uuid references profiles (id) on delete cascade not null,
  content text default '',
  attachments jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

create table flashcard_sets (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references profiles (id) on delete cascade not null,
  title text not null,
  color text default '#8C8FE0',
  created_at timestamptz default now()
);

create table flashcards (
  id uuid primary key default uuid_generate_v4(),
  set_id uuid references flashcard_sets (id) on delete cascade not null,
  owner_id uuid references profiles (id) on delete cascade not null,
  front text not null,
  back text not null
);

-- Публичный профиль (юзернейм + аватарка) — видно другим пользователям при поиске.
-- Отдельно от profiles специально: там лежит email, который чужим людям показывать не нужно —
-- этой таблице можно спокойно разрешить читать всем залогиненным, не раскрывая почту.
create table public_profiles (
  id uuid primary key references profiles (id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{1,30}$'),
  avatar_url text,
  public_id bigint unique not null, -- короткий ID из 8 цифр для поиска друзей, выдаётся триггером ниже
  created_at timestamptz default now()
);

-- Случайный 8-значный ID (не порядковый — иначе можно перебрать всех пользователей подряд)
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

-- Дружба через заявки — отправил, другой принял. Статус 'accepted' с обеих сторон
-- означает настоящих друзей; список друзей пользователя = все accepted-заявки, где он from_id или to_id.
create table friend_requests (
  id uuid primary key default uuid_generate_v4(),
  from_id uuid references public_profiles (id) on delete cascade not null,
  to_id uuid references public_profiles (id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  unique (from_id, to_id)
);

create table groups (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references profiles (id) on delete cascade not null,
  name text not null,
  university text,
  member_count int default 1,
  invite_code text unique not null,
  created_at timestamptz default now()
);

-- Полнотекстовый поиск по названиям тетрадей и тегам курсов
create index notebooks_search_idx on notebooks using gin (to_tsvector('russian', title || ' ' || coalesce(course_tag, '')));

-- Row Level Security — каждый видит и редактирует только свои данные.
-- Простая модель "owner_id = auth.uid()" для всех таблиц: этого достаточно, пока
-- шаринг между людьми — это ссылка-приглашение в мессенджер, а не совместный доступ к записи.
alter table profiles enable row level security;
alter table notebooks enable row level security;
alter table notes enable row level security;
alter table flashcard_sets enable row level security;
alter table flashcards enable row level security;
alter table public_profiles enable row level security;
alter table friend_requests enable row level security;
alter table groups enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own notebooks" on notebooks for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Заметку/карточку можно создать только в своей тетради/наборе — иначе можно было бы занять чужой notebook_id
create policy "own notes" on notes for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from notebooks n where n.id = notebook_id and n.owner_id = auth.uid()));
create policy "own flashcard sets" on flashcard_sets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own flashcards" on flashcards for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from flashcard_sets s where s.id = set_id and s.owner_id = auth.uid()));
create policy "own groups" on groups for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Публичный профиль виден всем залогиненным (нужно для поиска по юзернейму), редактировать может только владелец
create policy "read public profiles" on public_profiles for select using (auth.uid() is not null);
create policy "create own public profile" on public_profiles for insert with check (id = auth.uid());
create policy "update own public profile" on public_profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Заявку видят обе стороны; отправляет только from_id; принять (обновить статус) может только адресат to_id;
-- удалить/отменить может любая из сторон
create policy "see my requests" on friend_requests for select using (from_id = auth.uid() or to_id = auth.uid());
-- Новая заявка — только pending (иначе можно "подружиться" без согласия); принимая, адресат меняет только status
create policy "send request" on friend_requests for insert
  with check (from_id = auth.uid() and status = 'pending' and from_id <> to_id);
create policy "accept request" on friend_requests for update
  using (to_id = auth.uid() and status = 'pending') with check (to_id = auth.uid() and status = 'accepted');
revoke update on friend_requests from anon, authenticated;
grant update (status) on friend_requests to authenticated;
create policy "cancel or remove request" on friend_requests for delete using (from_id = auth.uid() or to_id = auth.uid());

-- Хранилище файлов — то же самое, что в supabase/storage.sql

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

-- "Поделиться": владелец открывает тетрадь другу на чтение — то же самое, что в migration_006_sharing.sql
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

-- Группы: участники, вступление по коду, чат — то же самое, что в migration_007_groups_chat.sql
-- === Участники групп ===

create table if not exists group_members (
  group_id uuid references groups (id) on delete cascade not null,
  user_id uuid references public_profiles (id) on delete cascade not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table group_members enable row level security;

-- "Состою ли я в группе" — через функцию с security definer: правила group_members сами спрашивают
-- про group_members, и без неё Postgres ушёл бы в бесконечную рекурсию проверок
create or replace function is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

-- Создатель группы автоматически становится её участником с ролью owner
create or replace function add_group_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists groups_add_owner on groups;
create trigger groups_add_owner after insert on groups for each row execute function add_group_owner();

-- Для групп, созданных до этой миграции
insert into group_members (group_id, user_id, role)
select g.id, g.owner_id, 'owner' from groups g
where exists (select 1 from public_profiles p where p.id = g.owner_id)
on conflict do nothing;

-- Вступить по коду приглашения. Чужую группу до вступления не видно (правила ниже),
-- поэтому поиск по коду идёт внутри функции с security definer
create or replace function join_group_by_code(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
begin
  if auth.uid() is null then
    raise exception 'Не авторизованы';
  end if;
  select id into gid from groups where invite_code = upper(trim(code));
  if gid is null then
    raise exception 'Группа с таким кодом не найдена' using errcode = 'P0002';
  end if;
  insert into group_members (group_id, user_id, role) values (gid, auth.uid(), 'member')
  on conflict do nothing;
  return gid;
end;
$$;

-- Правила для групп: видят участники, меняет и удаляет только создатель
drop policy if exists "own groups" on groups;
drop policy if exists "members read groups" on groups;
drop policy if exists "create own group" on groups;
drop policy if exists "owner updates group" on groups;
drop policy if exists "owner deletes group" on groups;
create policy "members read groups" on groups for select using (owner_id = auth.uid() or is_group_member(id));
create policy "create own group" on groups for insert with check (owner_id = auth.uid());
create policy "owner updates group" on groups for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes group" on groups for delete using (owner_id = auth.uid());

-- Правила для участников: список видят участники; выйти может сам участник (кроме создателя —
-- он удаляет группу целиком), исключить — создатель. Вступление — только через join_group_by_code
drop policy if exists "members see members" on group_members;
drop policy if exists "leave or kick" on group_members;
create policy "members see members" on group_members for select using (is_group_member(group_id));
create policy "leave or kick" on group_members for delete
  using (
    (user_id = auth.uid() and role <> 'owner')
    or (role <> 'owner' and exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid()))
  );

-- === Чат группы ===

create table if not exists group_messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references groups (id) on delete cascade not null,
  -- если автор удалит аккаунт, его сообщения остаются без подписи, а не пропадают из переписки
  author_id uuid references public_profiles (id) on delete set null,
  body text not null default '' check (char_length(body) <= 4000),
  -- вложение: {url, name, type: "image" | "file", size} — сам файл лежит в Storage (бакет uploads)
  attachment jsonb,
  created_at timestamptz default now(),
  check (char_length(trim(body)) > 0 or attachment is not null)
);

create index if not exists group_messages_group_created_idx on group_messages (group_id, created_at desc);

alter table group_messages enable row level security;

drop policy if exists "members read messages" on group_messages;
drop policy if exists "members send messages" on group_messages;
drop policy if exists "delete own or as owner" on group_messages;
create policy "members read messages" on group_messages for select using (is_group_member(group_id));
create policy "members send messages" on group_messages for insert
  with check (author_id = auth.uid() and is_group_member(group_id));
create policy "delete own or as owner" on group_messages for delete
  using (author_id = auth.uid() or exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid()));

-- Новые сообщения приходят в открытый чат сразу (Supabase Realtime), без обновления страницы
do $$ begin
  alter publication supabase_realtime add table group_messages;
exception when duplicate_object then null;
end $$;

-- "Поделиться" модулем флеш-карт — то же самое, что в migration_008_flashcard_sharing.sql
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

-- Добавление друзей в группу и доступ по ссылке — то же самое, что в migration_009_links_and_invites.sql
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

-- Конец дружбы закрывает общий доступ — то же самое, что в migration_010_unshare_on_unfriend.sql
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

-- Поиск по тексту конспектов — то же самое, что в migration_011_fulltext_search.sql
-- Текст конспекта без HTML-разметки (теги и картинки в них отбрасываются)
create or replace function note_plain_text(html text) returns text
language sql immutable as $$
  select regexp_replace(
    regexp_replace(coalesce(html, ''), '<[^>]*>', ' ', 'g'),
    '&(nbsp|amp|lt|gt|quot|#39);', ' ', 'g'
  );
$$;

-- Готовый поисковый индекс по тексту — пересчитывается сам при каждом сохранении конспекта
alter table notes add column if not exists search_vector tsvector
  generated always as (to_tsvector('russian', note_plain_text(content))) stored;
create index if not exists notes_search_idx on notes using gin (search_vector);

-- Поиск: свои тетради и открытые мне друзьями (правила доступа действуют — функция работает
-- от имени того, кто ищет). snippet — кусочек текста, найденные слова обёрнуты в ⟦ ⟧
create or replace function search_notebooks(q text)
returns table (id uuid, title text, icon_emoji text, owner_id uuid, snippet text, rank real)
language plpgsql stable security invoker set search_path = public as $$
declare
  tsq tsquery;
begin
  -- Каждое слово — с поиском по началу (:*), все слова должны встретиться
  select to_tsquery('russian', string_agg(quote_literal(w) || ':*', ' & '))
  into tsq
  from regexp_split_to_table(lower(coalesce(q, '')), '[^[:alnum:]]+') as w
  where w <> '';

  if tsq is null then
    return;
  end if;

  return query
  select n.id, n.title, n.icon_emoji, n.owner_id,
    case when nt.search_vector @@ tsq then
      ts_headline('russian', note_plain_text(nt.content), tsq,
        'StartSel=⟦, StopSel=⟧, MaxWords=18, MinWords=8, MaxFragments=1')
    end as snippet,
    greatest(
      ts_rank(to_tsvector('russian', n.title || ' ' || coalesce(n.course_tag, '')), tsq) * 2,
      coalesce(ts_rank(nt.search_vector, tsq), 0)
    )::real as rank
  from notebooks n
  left join notes nt on nt.notebook_id = n.id
  where to_tsvector('russian', n.title || ' ' || coalesce(n.course_tag, '')) @@ tsq
     or nt.search_vector @@ tsq
  order by 6 desc, n.updated_at desc -- 6 = rank
  limit 20;
end;
$$;

-- Страницы внутри тетради — то же самое, что в migration_012_pages.sql
alter table notes add column if not exists id uuid;
update notes set id = uuid_generate_v4() where id is null;
alter table notes alter column id set default uuid_generate_v4();
alter table notes alter column id set not null;

alter table notes add column if not exists title text not null default 'Страница 1';
alter table notes alter column title set default 'Новая страница';
alter table notes add column if not exists position int not null default 0;
alter table notes add column if not exists created_at timestamptz default now();

-- Ключ таблицы — теперь id страницы, а не id тетради (иначе в тетради не может быть двух страниц)
do $$ begin
  if exists (
    select 1 from information_schema.key_column_usage
    where table_schema = 'public' and table_name = 'notes' and constraint_name = 'notes_pkey' and column_name = 'notebook_id'
  ) then
    alter table notes drop constraint notes_pkey;
    alter table notes add constraint notes_pkey primary key (id);
  end if;
end $$;

alter table notes drop constraint if exists notes_title_length;
alter table notes add constraint notes_title_length check (char_length(title) between 1 and 120);
create index if not exists notes_notebook_position_idx on notes (notebook_id, position);

-- Поиск: теперь ещё и какая страница подошла лучше всего (page_id, page_title) — по клику открывается она.
-- Тип результата изменился, поэтому функцию пересоздаём
drop function if exists search_notebooks(text);
create function search_notebooks(q text)
returns table (id uuid, title text, icon_emoji text, owner_id uuid, page_id uuid, page_title text, snippet text, rank real)
language plpgsql stable security invoker set search_path = public as $$
declare
  tsq tsquery;
begin
  select to_tsquery('russian', string_agg(quote_literal(w) || ':*', ' & '))
  into tsq
  from regexp_split_to_table(lower(coalesce(q, '')), '[^[:alnum:]]+') as w
  where w <> '';

  if tsq is null then
    return;
  end if;

  return query
  select r.nb_id, r.nb_title, r.nb_icon, r.nb_owner, r.pg_id, r.pg_title, r.pg_snippet, r.score
  from (
    -- По одной строке на тетрадь — с лучше всего подходящей страницей
    select distinct on (n.id)
      n.id as nb_id, n.title as nb_title, n.icon_emoji as nb_icon, n.owner_id as nb_owner, n.updated_at as nb_updated,
      nt.id as pg_id, nt.title as pg_title,
      case when nt.id is not null then
        ts_headline('russian', note_plain_text(nt.content), tsq, 'StartSel=⟦, StopSel=⟧, MaxWords=18, MinWords=8, MaxFragments=1')
      end as pg_snippet,
      greatest(
        ts_rank(to_tsvector('russian', n.title || ' ' || coalesce(n.course_tag, '')), tsq) * 2,
        coalesce(ts_rank(nt.search_vector, tsq), 0)
      )::real as score
    from notebooks n
    left join notes nt on nt.notebook_id = n.id and nt.search_vector @@ tsq
    where to_tsvector('russian', n.title || ' ' || coalesce(n.course_tag, '')) @@ tsq
       or nt.id is not null
    order by n.id, coalesce(ts_rank(nt.search_vector, tsq), 0) desc
  ) r
  order by r.score desc, r.nb_updated desc
  limit 20;
end;
$$;

-- Тетрадь по ссылке: теперь со всеми страницами по порядку
create or replace function get_public_notebook(token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'title', n.title,
    'icon_emoji', n.icon_emoji,
    'cover_image_url', n.cover_image_url,
    'spine_color', n.spine_color,
    'owner_username', p.username,
    'pages', coalesce((
      select json_agg(json_build_object('id', pg.id, 'title', pg.title, 'content', pg.content, 'attachments', pg.attachments)
                      order by pg.position, pg.created_at)
      from notes pg where pg.notebook_id = n.id
    ), '[]'::json)
  )
  from notebooks n
  left join public_profiles p on p.id = n.owner_id
  where token is not null and n.share_token = token;
$$;

-- Общие тетради группы — то же самое, что в migration_013_group_notebooks.sql
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

-- Отзывы и аналитика — то же самое, что в migration_014_feedback_analytics.sql
-- === Администраторы ===
create table if not exists admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table admins enable row level security; -- правил нет: таблица закрыта, проверка — только через is_admin()

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- === Отзывы ===
create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public_profiles (id) on delete set null,
  rating smallint check (rating between 1 and 5),
  category text not null default 'other' check (category in ('like', 'bug', 'idea', 'other')),
  message text not null default '' check (char_length(message) <= 2000),
  page text check (char_length(page) <= 200),        -- где был пользователь, когда писал отзыв
  user_agent text check (char_length(user_agent) <= 300), -- браузер/устройство — помогает разбирать ошибки
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz default now(),
  check (rating is not null or char_length(trim(message)) > 0)
);
create index if not exists feedback_created_idx on feedback (created_at desc);
alter table feedback enable row level security;

drop policy if exists "send own feedback" on feedback;
drop policy if exists "see own feedback or admin" on feedback;
drop policy if exists "admin updates feedback" on feedback;
drop policy if exists "admin deletes feedback" on feedback;
create policy "send own feedback" on feedback for insert with check (user_id = auth.uid() and status = 'new');
create policy "see own feedback or admin" on feedback for select using (user_id = auth.uid() or is_admin());
create policy "admin updates feedback" on feedback for update using (is_admin()) with check (is_admin());
create policy "admin deletes feedback" on feedback for delete using (is_admin());

-- === Аналитика ===
-- Кто был активен в какой день (одна строка на человека в день — таблица растёт медленно)
create table if not exists active_days (
  user_id uuid references auth.users (id) on delete cascade not null,
  day date not null default current_date,
  primary key (user_id, day)
);
-- Сколько раз за день пользовались функцией (одна строка на функцию в день)
create table if not exists usage_daily (
  day date not null default current_date,
  event text not null,
  count int not null default 0,
  primary key (day, event)
);
alter table active_days enable row level security; -- правил нет: пишет только track(), читает только admin_stats()
alter table usage_daily enable row level security;

-- Приложение сообщает о событии. Разрешены только события из списка — произвольный текст не запишешь
create or replace function track(event_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if event_name not in ('app_open', 'pdf_export', 'card_from_selection', 'search', 'share_link_enabled',
                        'group_notebook_created', 'drawing_attached', 'feedback_sent') then
    raise exception 'Неизвестное событие: %', event_name;
  end if;
  insert into active_days (user_id, day) values (auth.uid(), current_date) on conflict do nothing;
  insert into usage_daily as u (day, event, count) values (current_date, event_name, 1)
  on conflict (day, event) do update set count = u.count + 1;
end;
$$;

-- Сводка для страницы «Аналитика» — только администратору
create or replace function admin_stats(days int default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  since date := current_date - (greatest(1, least(days, 365)) - 1);
begin
  if not is_admin() then
    raise exception 'Только для администратора' using errcode = '42501';
  end if;

  return json_build_object(
    'totals', json_build_object(
      'users', (select count(*) from public_profiles),
      'notebooks', (select count(*) from notebooks),
      'group_notebooks', (select count(*) from notebooks where group_id is not null),
      'pages', (select count(*) from notes),
      'flashcard_sets', (select count(*) from flashcard_sets),
      'flashcards', (select count(*) from flashcards),
      'groups', (select count(*) from groups),
      'messages', (select count(*) from group_messages),
      'friendships', (select count(*) from friend_requests where status = 'accepted'),
      'feedback', (select count(*) from feedback),
      'feedback_new', (select count(*) from feedback where status = 'new'),
      'avg_rating', (select round(avg(rating)::numeric, 2) from feedback where rating is not null)
    ),
    'active', json_build_object(
      'today', (select count(*) from active_days where day = current_date),
      'week', (select count(distinct user_id) from active_days where day > current_date - 7),
      'month', (select count(distinct user_id) from active_days where day > current_date - 30)
    ),
    -- По дням за период: активные, новые пользователи, созданные тетради/страницы/сообщения
    'daily', (
      select json_agg(json_build_object(
        'day', d::date,
        'active', (select count(*) from active_days a where a.day = d::date),
        'new_users', (select count(*) from public_profiles p where p.created_at::date = d::date),
        'notebooks', (select count(*) from notebooks n where n.created_at::date = d::date),
        'pages', (select count(*) from notes nt where nt.created_at::date = d::date),
        'messages', (select count(*) from group_messages m where m.created_at::date = d::date)
      ) order by d)
      from generate_series(since, current_date, interval '1 day') as d
    ),
    -- Использование функций за период
    'events', (
      select coalesce(json_object_agg(event, total), '{}'::json)
      from (select event, sum(count) as total from usage_daily where day >= since group by event) e
    )
  );
end;
$$;
