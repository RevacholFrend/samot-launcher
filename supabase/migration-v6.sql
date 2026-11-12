-- ============================================================
--  SAMOT — v6: глобальная таблица автообновления для клиента и админки
--  Применять на текущем Supabase-проекте.
-- ============================================================

create table if not exists public.app_updates (
  tool           text primary key,
  latest_version text not null default '1.0.0',
  download_url   text not null default '',
  updated_at     timestamptz not null default now()
);

alter table public.app_updates enable row level security;

drop policy if exists app_updates_read_all on public.app_updates;
create policy app_updates_read_all on public.app_updates for select using (true);

drop policy if exists app_updates_auth_write on public.app_updates;
create policy app_updates_auth_write on public.app_updates for all
  using (public.is_super()) with check (public.is_super());

grant select on public.app_updates to anon, authenticated;
grant insert, update, delete on public.app_updates to authenticated;

insert into public.app_updates (tool, latest_version, download_url) values
  ('launcher', '1.0.0', ''),
  ('admin',    '1.0.0', '')
on conflict (tool) do nothing;
