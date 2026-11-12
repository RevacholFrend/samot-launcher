-- ============================================================
--  Xuita Launcher — v7: project.approved
--  Новые проекты скрыты от игроков до явного подтверждения.
--  Применять в SQL Editor на текущем Supabase проекте.
-- ============================================================

alter table public.projects
  add column if not exists approved boolean not null default false;

-- старые проекты считаем одобренными
update public.projects set approved = true where approved = false;

-- RLS: игроки видят только одобренные проекты
drop policy if exists projects_read_all on public.projects;
create policy projects_read_all on public.projects for select
  using (approved or public.is_member(id) or public.is_super());

-- RLS: новости видны только для одобренных проектов
drop policy if exists news_public_read on public.news;
create policy news_public_read on public.news for select
  using (
    (active = true or public.is_member(project_id))
    and exists (select 1 from public.projects p where p.id = project_id and p.approved)
  );

-- RLS: настройки видны только для одобренных проектов
drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings for select
  using (
    exists (select 1 from public.projects p where p.id = project_id and p.approved)
    or public.is_member(project_id)
  );

grant select on public.projects to anon, authenticated;
