// netlify/functions/api.mjs
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // 서버 전용 키
);

// 허용 역할
const ALLOWED_ROLES = [
  'admin','staff','member','physio','ptadmin','nurse','frontdesk','radiology','vice'
];

// 공통 응답 헬퍼
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
};
const send = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
const safeJson = (str) => { try { return JSON.parse(str || '{}'); } catch { return null; } };

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return send(204, {});

  // 실제 path 계산
  -  const rawUrl  = event.rawUrl ? new URL(event.rawUrl) : null;
-  const rawPath = rawUrl ? rawUrl.pathname : (event.path || '');
-  const path    = (rawPath || '').replace(/\/.netlify\/functions\/api/i, '') || '/';
+  const rawUrl  = event.rawUrl ? new URL(event.rawUrl) : null;
+  const rawPath = rawUrl ? rawUrl.pathname : (event.path || '');
+  // ✅ 두 패턴 모두 정규화: "/.netlify/functions/api/..." 와 "/api/..."
+  let path = (rawPath || '')
+    .replace(/\/.netlify\/functions\/api/i, '')
+    .replace(/^\/api/i, '');
+  if (!path.startsWith('/')) path = '/' + path;


  // ───────── 디버그/헬스체크 ─────────
  // 1) 쿼리로 whoami: /.netlify/functions/api?__whoami=1
  if (rawUrl && rawUrl.searchParams.get('__whoami') === '1') {
    const url = process.env.SUPABASE_URL || '';
    const m   = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const ref = m ? m[1] : null;
    return send(200, { ok: true, supabaseUrl: url, projectRef: ref });
  }

  // 2) 라우트 whoami: /api/whoami
  if (path === '/whoami' && method === 'GET') {
    const url = process.env.SUPABASE_URL || '';
    const m   = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const ref = m ? m[1] : null;
    return send(200, { ok: true, supabaseUrl: url, projectRef: ref });
  }

  // 3) 헬스체크: /api/health
  if (path === '/health' && method === 'GET') {
    return send(200, { ok: true, message: 'alive', time: new Date().toISOString() });
  }
  if (path === '/' && method === 'GET') {
    return send(404, { ok: false, message: 'Not Found' });
  }

  try {
    // ───────── 로그인 ─────────
    // POST /api/login  { email, password }
    if (path === '/login' && method === 'POST') {
      const { email, password } = safeJson(event.body) || {};
      if (!email || !password) return send(400, { ok:false, message:'email, password 필요' });

      const { data:user, error } = await supabase
        .from('accounts')
        .select('id,email,role,password_hash')
        .eq('email', String(email).toLowerCase())
        .single();

      if (error || !user) return send(401, { ok:false, message:'이메일 또는 비밀번호가 올바르지 않습니다.' });

      const passOK = await bcrypt.compare(password, user.password_hash || '');
      if (!passOK) return send(401, { ok:false, message:'이메일 또는 비밀번호가 올바르지 않습니다.' });

      return send(200, { ok:true, user:{ id:user.id, email:user.email, role:user.role } });
    }

    // ───────── 계정 CRUD ─────────
    // /api/accounts
    if (path === '/accounts') {
      if (method === 'GET') {
        const { data, error } = await supabase
          .from('accounts')
          .select('id,email,role,created_at')
          .order('created_at', { ascending:false });
        if (error) return send(500, { ok:false, message:error.message });
        return send(200, { ok:true, items:data });
      }

      if (method === 'POST') {
        const { email, password, role, name } = safeJson(event.body) || {};
        if (!email || !password || !role) return send(400, { ok:false, message:'email/password/role 필요' });
        if (!ALLOWED_ROLES.includes(role)) return send(400, { ok:false, message:'허용되지 않은 role' });

        const password_hash = await bcrypt.hash(password, 10);
        const emailNorm = String(email).toLowerCase();

        const { data, error } = await supabase
          .from('accounts')
          .insert([{ email:emailNorm, password_hash, role, name: name || null }])
          .select('id,email,role,created_at')
          .single();

        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true, item:data });
      }

      if (method === 'PATCH') {
        const { id, email, password, role, name } = safeJson(event.body) || {};
        if (!id) return send(400, { ok:false, message:'id 필요' });

        const updates = {};
        if (email) updates.email = String(email).toLowerCase();
        if (name)  updates.name  = name;
        if (role) {
          if (!ALLOWED_ROLES.includes(role)) return send(400, { ok:false, message:'허용되지 않은 role' });
          updates.role = role;
        }
        if (password) updates.password_hash = await bcrypt.hash(password, 10);

        const { data, error } = await supabase
          .from('accounts')
          .update(updates)
          .eq('id', id)
          .select('id,email,role,created_at')
          .single();

        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true, item:data });
      }

      if (method === 'DELETE') {
        const { id } = safeJson(event.body) || {};
        if (!id) return send(400, { ok:false, message:'id 필요' });

        const { error } = await supabase.from('accounts').delete().eq('id', id);
        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true });
      }

      return send(405, { ok:false, message:'Method Not Allowed' });
    }

    // 라우트 없음
    return send(404, { ok:false, error:'route_not_found', route:path, path:rawPath });
  } catch (e) {
    console.error(e);
    return send(500, { ok:false, message:e?.message || 'Server error' });
  }
}
