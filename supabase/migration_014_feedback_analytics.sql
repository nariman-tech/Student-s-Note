-- Миграция 014: отзывы пользователей и аналитика для администратора.
-- Аналитика хранит только числа (кто был активен в какой день и сколько раз нажимали функции) —
-- содержимое конспектов и сообщений она не читает.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше. Можно запускать повторно.
--
-- ⚠️ После миграции сделайте себя администратором (один раз), подставив свою почту:
--   insert into admins (user_id) select id from auth.users where email = 'ваша@почта';

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
