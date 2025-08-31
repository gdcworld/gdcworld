// netlify/functions/api.mjs
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // 서버에서만 사용!
);

const ALLOWED_ROLES = [
  'admin','staff','member','physio','ptadmin','nurse','frontdesk','radiology','vice'
];

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handler(event, context) {
  try {
    const url = new URL(event.rawUrl);
    const path = url.pathname.replace(/^\/.netlify\/functions\/api/, ''); // "", "/accounts", "/login", "/health"
    const method = event.httpMethod.toUpperCase();

    // Health check
    if (path === '/health') {
      return json(200, { ok: true });
    }

    // ----- /api/accounts -----
    if (path === '' || path === '/accounts') {
      if (method === 'GET') {
        const { data, error } = await supabase
          .from('accounts')
          .select('id,email,role,created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return json(200, { ok: true, items: data });
      }

      if (method === 'POST') {
        const body = JSON.parse(event.body || '{}');
        const { email, password, role } = body;

        if (!email || !password || !role) {
          return json(400, { ok: false, message: 'email, password, role 필요' });
        }
        if (!ALLOWED_ROLES.includes(role)) {
          return json(400, { ok: false, message: '허용되지 않은 role' });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const { data, error } = await supabase
          .from('accounts')
          .insert([{ email, password_hash, role }])
          .select('id,email,role,created_at')
          .single();

        if (error) {
          // unique 위반 등
          return json(400, { ok: false, message: error.message });
        }
        return json(200, { ok: true, item: data });
      }

      if (method === 'PATCH') {
        const body = JSON.parse(event.body || '{}');
        const { id, email, password, role } = body;
        if (!id) return json(400, { ok: false, message: 'id 필요' });

        const updates = {};
        if (email) updates.email = email;
        if (role) {
          if (!ALLOWED_ROLES.includes(role)) {
            return json(400, { ok: false, message: '허용되지 않은 role' });
          }
          updates.role = role;
        }
        if (password) {
          updates.password_hash = await bcrypt.hash(password, 10);
        }

        const { data, error } = await supabase
          .from('accounts')
          .update(updates)
          .eq('id', id)
          .select('id,email,role,created_at')
          .single();

        if (error) return json(400, { ok: false, message: error.message });
        return json(200, { ok: true, item: data });
      }

      if (method === 'DELETE') {
        const body = JSON.parse(event.body || '{}');
        const { id } = body;
        if (!id) return json(400, { ok: false, message: 'id 필요' });

        const { error } = await supabase.from('accounts').delete().eq('id', id);
        if (error) return json(400, { ok: false, message: error.message });
        return json(200, { ok: true });
      }

      return json(405, { ok: false, message: 'Method Not Allowed' });
    }

    // ----- /api/login -----
    if (path === '/login' && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { email, password } = body;
      if (!email || !password) return json(400, { ok: false, message: 'email, password 필요' });

      const { data: user, error } = await supabase
        .from('accounts')
        .select('id,email,role,password_hash')
        .eq('email', email)
        .single();

      if (error || !user) return json(401, { ok: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });

      const ok = await bcrypt.compare(password, user.password_hash || '');
      if (!ok) return json(401, { ok: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });

      // 프론트에 저장할 최소 정보만 반환
      const { id, role } = user;
      return json(200, { ok: true, user: { id, email, role } });
    }

    // not found
    return json(404, { ok: false, message: 'Not Found' });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, message: e.message || 'Server error' });
  }
}
