-- Миграция 003: поле пола в профиле (для регистрации email+пароль)
-- Выполните в Supabase SQL Editor, если основной schema.sql уже был запущен раньше.

alter table profiles add column if not exists gender text check (gender in ('male', 'female', 'unspecified'));
