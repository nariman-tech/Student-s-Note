-- Миграция 011: поиск по тексту конспектов, а не только по названиям тетрадей.
-- Postgres сам понимает русские словоформы («закон» находит «закона», «законы») и ищет по началу слова,
-- пока вы его печатаете. Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.
-- Файл можно запускать повторно.

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
