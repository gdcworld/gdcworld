// netlify/functions/api.mjs
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // 서버 전용! 브라우저에 넣지 말 것
);

// 서버가 허용하는 역할 (DB enum과 일치)
const ALLOWED_ROLES = [
  'admin','staff','member','physio','ptadmin','nurse','frontdesk','radiology','vice'
];

// 공통 응답 유틸(+CORS)
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
};
const send = (statusCode, data) => ({
  statusCode,
  headers,
  body: JSON.stringify(data)
});

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return send(204, {});

  // path: "/.netlify/functions/api", "/.netlify/functions/api/health", ...
  const path = (event.path || '').replace(/\/.netlify\/functions\/api/i, '') || '/';
  const method = event.httpMethod.toUpperCase();

  try {
    // 헬스체크
    if (path === '/' || path === '/health') {
      if (path === '/health') return send(200, { ok: true });
      // 루트("/") 접근은 Not Found로
      if (path === '/') return send(404, { ok: false, message: 'Not Found' });
    }

    // ----- 로그인 -----
    if (path === '/login' && method === 'POST') {
      const { email, password } = safeJson(event.body) || {};
      if (!email || !password) return send(400, { ok: false, message: 'email, password 필요' });

      const { data: user, error } = await supabase
        .from('accounts')
        .select('id,email,role,password_hash')
        .eq('email', String(email).toLowerCase())
        .single();

      if (error || !user) return send(401, { ok: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });

      const passOK = await bcrypt.compare(password, user.password_hash || '');
      if (!passOK) return send(401, { ok: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });

      // 비밀번호는 제거하고 최소정보만 반환
      return send(200, { ok: true, user: { id: user.id, email: user.email, role: user.role } });
    }

    // ----- 계정 목록/생성/수정/삭제 -----
    if (path === '/accounts') {
      // 목록
      if (method === 'GET') {
        const { data, error } = await supabase
          .from('accounts')
          .select('id,email,role,created_at')
          .order('created_at', { ascending: false });
        if (error) return send(500, { ok: false, message: error.message });
        return send(200, { ok: true, items: data });
      }

      // 생성
      if (method === 'POST') {
        const { email, password, role } = safeJson(event.body) || {};
        if (!email || !password || !role) return send(400, { ok: false, message: 'email/password/role 필요' });
        if (!ALLOWED_ROLES.includes(role)) return send(400, { ok: false, message: '허용되지 않은 role' });

        const password_hash = await bcrypt.hash(password, 10);
        const emailNorm = String(email).toLowerCase();

        const { data, error } = await supabase
          .from('accounts')
          .insert([{ email: emailNorm, password_hash, role }])
          .select('id,email,role,created_at')
          .single();

        if (error) {
          // 중복 이메일 등
          return send(400, { ok: false, message: error.message });
        }
        return send(200, { ok: true, item: data });
      }

      // 수정
      if (method === 'PATCH') {
        const { id, email, password, role } = safeJson(event.body) || {};
        if (!id) return send(400, { ok: false, message: 'id 필요' });

        const updates = {};
        if (email) updates.email = String(email).toLowerCase();
        if (role) {
          if (!ALLOWED_ROLES.includes(role)) return send(400, { ok: false, message: '허용되지 않은 role' });
          updates.role = role;
        }
        if (password) updates.password_hash = await bcrypt.hash(password, 10);

        const { data, error } = await supabase
          .from('accounts')
          .update(updates)
          .eq('id', id)
          .select('id,email,role,created_at')
          .single();

        if (error) return send(400, { ok: false, message: error.message });
        return send(200, { ok: true, item: data });
      }

      // 삭제
      if (method === 'DELETE') {
        const { id } = safeJson(event.body) || {};
        if (!id) return send(400, { ok: false, message: 'id 필요' });

        const { error } = await supabase.from('accounts').delete().eq('id', id);
        if (error) return send(400, { ok: false, message: error.message });
        return send(200, { ok: true });
      }

      return send(405, { ok: false, message: 'Method Not Allowed' });
    }

    return send(404, { ok: false, message: 'Not Found' });
  } catch (e) {
    console.error(e);
    return send(500, { ok: false, message: e?.message || 'Server error' });
  }
}

function safeJson(str) {
  try { return JSON.parse(str || '{}'); } catch { return null; }
}
