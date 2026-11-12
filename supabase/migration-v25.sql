-- ============================================================================
--  SAMOT Launcher — Migration v25: новости бренда SAMOT и событий в карусели
--  kind: 'project' (новость проекта, как раньше) | 'samot' (от лица бренда)
--        | 'event' (общее событие: фестиваль / акция)
--  carousel: показывать в карусели «Главной» (вместо отдельной публикации)
--  cta_url: внешняя ссылка для слайда (если есть — кнопка ведёт туда)
-- ============================================================================

-- 1) project_id может быть NULL (новость бренда/события не привязана к проекту)
alter table public.news alter column project_id drop not null;

-- 2) новые колонки
alter table public.news add column if not exists kind text not null default 'project';
alter table public.news add column if not exists carousel boolean not null default false;
alter table public.news add column if not exists cta_url text not null default '';
alter table public.news drop constraint if exists news_kind_check;
alter table public.news add constraint news_kind_check check (kind in ('project', 'samot', 'event'));
create index if not exists news_carousel_idx on public.news (carousel, published_at desc) where carousel = true;
create index if not exists news_kind_idx on public.news (kind, published_at desc) where kind in ('samot', 'event');

-- 3) RLS: публичное чтение уже "active or is_member" — NULL-сценарий покрыт is_super()
--    для вставки/правки бренд-новостей только super-админ (kind <> 'project')
drop policy if exists news_member_insert on public.news;
create policy news_member_insert on public.news for insert
  with check (public.is_member(project_id) and (kind = 'project' or public.is_super()));

drop policy if exists news_member_update on public.news;
create policy news_member_update on public.news for update
  using (public.is_member(project_id))
  with check (public.is_member(project_id) and (kind = 'project' or public.is_super()));

-- удаление: super всегда, член проекта — по проекту
drop policy if exists news_member_delete on public.news;
create policy news_member_delete on public.news for delete
  using (public.is_member(project_id));
