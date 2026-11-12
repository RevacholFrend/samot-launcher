-- ============================================================
--  SAMOT Launcher — v3: баны пользователей и скрытие проектов
--  Идемпотентна. Применять в SQL Editor.
-- ============================================================

-- 1) Скрытие проекта из лаунчера (вместо удаления, если проект "лишний")
alter table public.projects add column if not exists is_hidden boolean not null default false;

-- 2) Таблица банов
create table if not exists public.bans (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  reason      text default '',
  banned_by   uuid references auth.users(id) on delete set null,
  banned_until timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.bans enable row level security;

-- 3) Простой helper: всегда ли этот пользователь забанен (и не истёк ли бан)
create or replace function public.is_banned(target uuid)
returns boolean language sql security definer stable set search_path = public as
$$ select exists(
     select 1 from public.bans
     where user_id = target and banned_until > now()
   ) $$;

-- включить RLS и политики
drop policy if exists bans_admin_all on public.bans;
create policy bans_admin_all on public.bans
  for all using (public.is_super()) with check (public.is_super());

drop policy if exists bans_read_own on public.bans;
create policy bans_read_own on public.bans
  for select using (user_id = auth.uid());

-- гранты
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.bans to authenticated;

-- 4) Проектные владельцы не могут банить глобально. Bans управляет только superadmin.
-- добавим helper для удобства: 'active bans' list для админов
create or replace view public.active_bans
with (security_invoker = on)
as
select b.user_id, b.reason, b.banned_by, b.banned_until, b.created_at,
       u.email
from public.bans b
join auth.users u on u.id = b.user_id
where b.banned_until > now();

grant select on public.active_bans to authenticated;

-- 5) Проверка для клиента: если забанен — пусть RLS блокирует чтение
-- Добавим проверку в projects & news: пользователь не видит ничего, если забанен
drop policy if exists projects_read_all on public.projects;
create policy projects_read_all on public.projects for select
  using (not public.is_banned(auth.uid()));

drop policy if exists members_read_same_project on public.project_members;
create policy members_read_same_project on public.project_members for select
  using (user_id = auth.uid() or public.is_member(project_id));

drop policy if exists news_public_read on public.news;
create policy news_public_read on public.news for select
  using ((active = true or public.is_member(project_id)) and not public.is_banned(auth.uid()));

drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings for select
  using (not public.is_banned(auth.uid()));

-- 6) Удаление проекта — каскад удалит news, members, settings. Удаление разрешено владельцу или superadmin.
drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects for delete
  using (public.is_owner(id));
