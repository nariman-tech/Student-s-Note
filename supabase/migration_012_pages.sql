-- Миграция 012: страницы внутри тетради. Тетрадь «Физика» → «Лекция 1», «Лекция 2», «Семинар»…
-- Раньше в таблице notes была ровно одна запись на тетрадь; теперь каждая запись — страница.
-- Уже написанные конспекты не теряются: каждый становится «Страницей 1» своей тетради.
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше. Можно запускать повторно.

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
