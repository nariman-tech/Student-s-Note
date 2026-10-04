-- Миграция 015: исправление функции track из migration_014 — параметр назывался так же, как колонка
-- таблицы (event), и PostgreSQL не мог понять, что имеется в виду («column reference "event" is ambiguous»).
-- Из-за этого аналитика не записывала события. Выполните в Supabase SQL Editor. Можно запускать повторно.

drop function if exists track(text);
create function track(event_name text) returns void
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
