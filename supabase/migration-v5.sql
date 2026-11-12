-- ============================================================
--  Xuita Launcher — v4: download_available у проектов + pinned у новостей
--  Применять после v3.
-- ============================================================

alter table public.projects add column if not exists download_available boolean not null default true;
alter table public.news     add column if not exists pinned boolean not null default false;

-- индексы для ускорения выборок
create index if not exists idx_projects_pinned_available on public.projects (is_hidden, download_available, id);
create index if not exists idx_news_pinned_published on public.news (pinned desc, published_at desc);

-- дать гранты если нужно (SELECT порядок обычно не требует)
grant select on public.projects to anon, authenticated;
grant select on public.news to anon, authenticated;
