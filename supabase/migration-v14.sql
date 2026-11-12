-- ============================================================================
--  SAMOT Launcher — Migration v14: Home carousel + project media + home news
--  Применять через Supabase Dashboard → SQL Editor.
-- ============================================================================

-- 1) Медиа-ассеты проекта
alter table public.projects
  add column if not exists banner_url text default '',
  add column if not exists thumbnail_url text default '',
  add column if not exists card_cover_url text default '',
  add column if not exists news_cover_url text default '',
  add column if not exists screenshots jsonb not null default '[]'::jsonb;

-- 2) Флаг — показывать проект на Главной
alter table public.projects
  add column if not exists show_on_home boolean not null default false;

-- 3) У новостей — флаг «на главной»
alter table public.news
  add column if not exists home boolean not null default false;

-- 4) Порядок проектов на главной (опционально)
alter table public.projects
  add column if not exists home_sort int not null default 0;
