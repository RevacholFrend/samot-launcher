// admin-signout — принудительный выход из всех сессий пользователя.
// Используется: админка («Полное вытеснение» супер-админом).
// Авторизация: bearer (JWT пользователя-админа); проверяем is_super через RPC.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!serviceRole || !url) return json({ error: 'service role not available' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401);
  const jwt = authHeader.slice('Bearer '.length).trim();

  // Caller client uses their own JWT to check is_super
  const caller = createClient(url, jwt, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: isSuper, error: rpcErr } = await caller.rpc('is_super');
  if (rpcErr || !isSuper) return json({ error: 'forbidden: super admin only' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const target = String(body.target_user_id ?? '').trim();
  if (!target) return json({ error: 'target_user_id required' }, 400);

  // Admin client uses service_role to actually sign out
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.signOut(target, 'global');
  if (error) return json({ error: error.message ?? String(error) }, 500);

  // Optional: clean up device records for that user
  if (body.clearDevices !== false) {
    await admin.from('user_devices').delete().eq('user_id', target);
  }

  return json({ ok: true });
});
