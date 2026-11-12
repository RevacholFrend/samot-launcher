// send_report — отправляет письма на скрытый адрес revacholfrend@gmail.com.
// kind: 'bug' | 'contact' | 'unban' → темы: bag | Связь | Разбан.
// userEmail — почта отправителя (подставляется в письмо и как reply_to).

const REPORT_TO = 'revacholfrend@gmail.com';
const FROM = 'Xuita Launcher <onboarding@resend.dev>';
const SUBJECTS: Record<string, string> = {
  bug: 'bag',
  contact: 'Связь',
  unban: 'Разбан',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 20000);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function isValidBase64(s) {
  const compact = String(s || '').replace(/\s/g, '');
  if (compact.length < 64 || compact.length > 5600000) return null;
  return /^[A-Za-z0-9+/=]+$/.test(compact) ? compact : null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return json({ error: 'RESEND_API_KEY is not configured in Supabase secrets' }, 500);

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const message = String(body.message ?? '').trim();
  if (!message) return json({ error: 'message is required' }, 400);
  if (message.length > 5000) return json({ error: 'message too long' }, 400);

  const kind = String(body.kind || 'bug').trim().toLowerCase();
  const subject = SUBJECTS[kind] || SUBJECTS.bug;

  const contact = String(body.contact ?? '').trim().slice(0, 300);
  const tool = String(body.tool ?? 'client').trim().slice(0, 50);
  const userEmail = String(body.userEmail ?? '').trim().slice(0, 300);
  const systemInfo = String(body.systemInfo ?? '').trim().slice(0, 4000);
  const logs = String(body.logs ?? '').trim().slice(0, 20000);
  const replyTo = EMAIL_RE.test(userEmail) ? userEmail : undefined;

  let attachment = null;
  const image = body.image;
  if (image && typeof image === 'object') {
    const compact = isValidBase64(image.content);
    const name = String(image.filename || 'screenshot.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    if (compact) attachment = { filename: name || 'screenshot.jpg', content: compact };
  }

  const html = `
    <h2>${esc(subject)} — ${esc(tool)}</h2>
    <p><b>От кого:</b> ${esc(userEmail || 'не авторизован')}</p>
    <p><b>Контакт:</b> ${esc(contact || '— не указан —')}</p>
    <p><b>Вложение:</b> ${attachment ? esc(attachment.filename) : '— нет —'}</p>
    <h3>Сообщение</h3>
    <p style="white-space:pre-wrap">${esc(message)}</p>
    <h3>Системные данные</h3>
    <pre style="white-space:pre-wrap;font-size:12px">${esc(systemInfo)}</pre>
    <h3>Логи (последние)</h3>
    <pre style="white-space:pre-wrap;font-size:11px">${esc(logs || '(логов не накопилось)')}</pre>
  `;

  try {
    const payload = {
      from: FROM,
      to: [REPORT_TO],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachment ? { attachments: [attachment] } : {}),
    };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('resend error', res.status, text);
      return json({ error: 'email provider rejected the message', detail: String(text).slice(0, 300) }, 502);
    }
    return json({ ok: true, attached: !!attachment, subject });
  } catch (e) {
    console.error('send_report failed', e);
    return json({ error: 'failed to send email' }, 500);
  }
});
