-- ============================================================================
--  SAMOT Launcher — Migration v26: безопасность доступа (право релиза)
--  1) project_members: убрать self-join (только владелец/RPC)
--  2) news_public_read: бренд-новости (project_id IS NULL) видны всем (active)
--  3) carousel=true только super (иначе любой владелец продавил бы свой слайд)
--  4) projects: владелец не может менять approved / is_hidden / slug
--  5) app_updates.sha256 — контроль целостности дистрибутива обновления
--  6) warnings: нельзя перепривязать (user_id / project_id / warned_by)
--  7) list_active_bans: только super (подписка на рассылку банов)
-- ============================================================================

-- 1) members_insert_owner без self-join
drop policy if exists members_insert_owner on public.project_members;
create policy members_insert_owner on public.project_members for insert
  with check (public.is_owner(project_id));

-- 2) публичное чтение новостей: бренд/события видны всем, если active
drop policy if exists news_public_read on public.news;
create policy news_public_read on public.news for select
  using (
    (active = true and (
       project_id is null
       or exists (select 1 from public.projects p
                  where p.id = news.project_id and p.approved)
    ))
    or public.is_member(project_id)
  );

-- 3) карусель — только super
drop policy if exists news_member_insert on public.news;
create policy news_member_insert on public.news for insert
  with check (public.is_member(project_id)
              and (kind = 'project' or public.is_super())
              and (carousel = false or public.is_super()));

drop policy if exists news_member_update on public.news;
create policy news_member_update on public.news for update
  using (public.is_member(project_id))
  with check (public.is_member(project_id)
              and (kind = 'project' or public.is_super())
              and (carousel = false or public.is_super()));

-- 4) guard триггер на projects: владелец не трогает служебные поля
create or replace function public.projects_guard()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then
    if new.approved is distinct from old.approved
       or new.is_hidden is distinct from old.is_hidden
       or new.slug is distinct from old.slug
       or new.created_by is distinct from old.created_by
       or new.id is distinct from old.id then
      raise exception 'approved / is_hidden / slug / created_by может менять только супер-администратор';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.projects_guard() from public;
drop trigger if exists projects_guard on public.projects;
create trigger projects_guard
  before update on public.projects
  for each row execute function public.projects_guard();

-- 5) app_updates: sha256 для верификации скачанного обновления
alter table public.app_updates add column if not exists sha256 text;

-- 6) warnings: нельзя перепривязать
create or replace function public.warnings_guard()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then
    if new.user_id is distinct from old.user_id
       or new.project_id is distinct from old.project_id
       or new.warned_by is distinct from old.warned_by then
      raise exception 'Предупреждение нельзя перепривязать к другому пользователю/проекту/автору';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.warnings_guard() from public;
drop trigger if exists warnings_guard on public.warnings;
create trigger warnings_guard
  before update on public.warnings
  for each row execute function public.warnings_guard();

-- 7) список банов — только super
revoke execute on function public.list_active_bans() from authenticated;
