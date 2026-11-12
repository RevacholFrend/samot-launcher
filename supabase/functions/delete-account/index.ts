// ============================================================================
//  delete-account — удаление аккаунта пользователя по его запросу.
//  Требует JWT пользователя (не анонимный ключ).
//  Удаляет всё, что ссылается на пользователя, и запись в auth.users.
//  Деплой: npx supabase functions deploy delete-account --no-verify-jwt
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors() });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Авторизация: bearer (JWT пользователя-админа или сам пользователь)
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'missing token' }, 401);

  const anon = createClient(Deno.env.get('SUPABASE_URL')!, ANON_KEY!, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: me, error: meErr } = await anon.auth.getUser(token);
  if (meErr || !me?.user) return json({ error: 'invalid token' }, 401);
  const meId = me.user.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const target = String(body?.targetUserId ?? '').trim();

  // Режим 1: сам удаляет свой аккаунт (target пуст)
  // Режим 2: администратор удаляет чужой по запросу (super-only)
  let userId = meId;
  if (target) {
    // Проверяю, что вызывающий — super admin
    const { data: isSuper, error: rpcErr } = await anon.rpc('is_super');
    if (rpcErr) return json({ error: 'super-check failed: ' + rpcErr.message }, 403);
    if (!isSuper) return json({ error: 'only super admin can delete other accounts' }, 403);
    userId = target;
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Кастомные таблицы
  await admin.from('user_devices').delete().eq('user_id', userId);

  // 2) Системные каскады: project_members, bans
  await admin.from('admins').delete().eq('user_id', userId);

  // 3) Проекты, созданные этим пользователем — становятся без владельца
  await admin.from('projects').update({ created_by: null }).eq('created_by', userId);

  // 4) Удаление из auth.users
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: 'delete failed: ' + delErr.message }, 500);

  return json({ ok: true });
});
