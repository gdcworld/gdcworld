// netlify/functions/api.mjs
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // 서버 전용 키
);

// (폴백용) 하드코딩 허용 역할 — DB(roles)가 비어있을 때만 사용
const ALLOWED_ROLES = [
  'admin','staff','member','physio','ptadmin','nurse','frontdesk','radiology','vice'
];

// ───────── Token utils (HS256-like) ─────────
const AUTH_SECRET = process.env.AUTH_SECRET || 'CHANGE_ME_IN_NETLIFY';
const b64  = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const hmac = (str) => crypto.createHmac('sha256', AUTH_SECRET).update(str).digest('base64url');

function signToken(payload){ // { sub,email,role,iat,exp }
  const h = b64({ alg:'HS256', typ:'JWT' });
  const p = b64(payload);
  const s = hmac(`${h}.${p}`);
  return `${h}.${p}.${s}`;
}
function verifyToken(token){
  try{
    const [h,p,s] = String(token||'').split('.');
    if (!h || !p || !s) return null;
    if (hmac(`${h}.${p}`) !== s) return null;
    const payload = JSON.parse(Buffer.from(p,'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { sub,email,role,iat,exp }
  }catch{ return null; }
}
function readAuth(event){
  const raw = (event.headers?.authorization || event.headers?.Authorization || '').trim();
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? verifyToken(m[1]) : null;
}
function requireLogin(auth){
  return auth ? { ok:true } : { ok:false, status:401, message:'unauthorized' };
}
function requireRole(auth, roles=[]){
  const base = requireLogin(auth);
  if (!base.ok) return base;
  if (roles.length && !roles.includes(auth.role)) return { ok:false, status:403, message:'forbidden' };
  return { ok:true };
}

// 공통 응답 헬퍼
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
};
const send = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
const safeJson = (str) => { try { return JSON.parse(str || '{}'); } catch { return null; } };

// DB ↔ 응답 필드 매핑 (snake_case → camelCase)
const toCamel = (row = {}) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  created_at: row.created_at,
  name: row.name ?? null,
  phone: row.phone ?? null,
  status: row.status ?? null,
  hospital: row.hospital ?? null,
  workStatus: row.work_status ?? null,
  adminType: row.admin_type ?? null,
  ward: row.ward ?? null,
  license: row.license ?? null,
  branch: row.branch ?? null,
  area: row.area ?? null,
  position: row.position ?? null,
});

// SELECT 공통 목록
const ACCOUNT_SELECT = `
  id, email, role, created_at,
  name, phone, status,
  hospital, work_status, admin_type, ward, license, branch, area, position
`;

// ✅ 역할 캐시 로더: roles 테이블에서 단일 소스로 로딩
let __rolesCache = null;
async function loadRolesFromDB() {
  if (__rolesCache) return __rolesCache;
  const { data, error } = await supabase.from('roles').select('role').order('role');
  if (error) { __rolesCache = []; return __rolesCache; }
  __rolesCache = (data || []).map(r => r.role);
  return __rolesCache;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return send(204, {});

  // 실제 path 계산 (프록시/직접호출 모두 지원)
  const rawUrl  = event.rawUrl ? new URL(event.rawUrl) : null;
  const rawPath = rawUrl ? rawUrl.pathname : (event.path || '');

  // /.netlify/functions/api/...  또는 /api/...  모두 제거
  let path = (rawPath || '')
    .replace(/\/.netlify\/functions\/api/i, '')
    .replace(/^\/api/i, '');
  if (!path || path === '') path = '/';
  if (!path.startsWith('/')) path = '/' + path;

  const method  = (event.httpMethod || 'GET').toUpperCase();

  // ───────── 디버그/헬스체크 ─────────
  if (rawUrl && rawUrl.searchParams.get('__whoami') === '1') {
    const url = process.env.SUPABASE_URL || '';
    const m   = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const ref = m ? m[1] : null;
    return send(200, { ok: true, supabaseUrl: url, projectRef: ref });
  }
  if (path === '/whoami' && method === 'GET') {
    const url = process.env.SUPABASE_URL || '';
    const m   = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const ref = m ? m[1] : null;
    return send(200, { ok: true, supabaseUrl: url, projectRef: ref });
  }
  if (path === '/health' && method === 'GET') {
    return send(200, { ok: true, message: 'alive', time: new Date().toISOString() });
  }
  if (path === '/' && method === 'GET') {
    return send(404, { ok: false, message: 'Not Found' });
  }

  try {
    // 👇 로그인한 사용자/역할 파싱 (없으면 null)
    const auth = readAuth(event);

    // ✅ 역할 목록 라우트: GET /api/roles  (로그인 필요)
    if (path === '/roles' && method === 'GET') {
      const check = requireLogin(auth);
      if (!check.ok) return send(check.status, { ok:false, message:check.message });
      const roles = await loadRolesFromDB();
      return send(200, { ok: true, items: roles });
    }

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

      // ★ 토큰 발급 (8시간)
      const now = Date.now();
      const token = signToken({
        sub: user.id, email: user.email, role: user.role,
        iat: now, exp: now + 1000*60*60*8
      });

      return send(200, { ok:true, user:{ id:user.id, email:user.email, role:user.role }, token });
    }

    // ───────── 계정 CRUD ─────────
    // /api/accounts  (관리자만 허용)
    if (path === '/accounts') {
      const check = requireRole(auth, ['admin']); // 원하면 ['admin','ptadmin'] 등으로 확장
      if (!check.ok) return send(check.status, { ok:false, message: check.message });

      // 목록
      if (method === 'GET') {
        const { data, error } = await supabase
          .from('accounts')
          .select(ACCOUNT_SELECT)
          .order('created_at', { ascending:false });
        if (error) return send(500, { ok:false, message:error.message });
        return send(200, { ok:true, items: (data || []).map(toCamel) });
      }

      // 생성
      if (method === 'POST') {
        const body = safeJson(event.body) || {};
        const {
          email, password, role, name,
          phone, status,
          hospital, workStatus, adminType, ward, license, branch, area, position
        } = body;

        if (!email || !password || !role) return send(400, { ok:false, message:'email/password/role 필요' });

        // ✅ 역할 검증: DB roles 우선(비어있으면 상수 폴백)
        {
          const roles = await loadRolesFromDB();
          const allowed = roles && roles.length ? roles : ALLOWED_ROLES;
          if (!allowed.includes(role)) return send(400, { ok:false, message:'허용되지 않은 role' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const emailNorm = String(email).toLowerCase();

        const insertRow = {
          email: emailNorm,
          password_hash,
          role,
          name: name || null,
          phone: phone || null,
          status: status || null,
          hospital: hospital || null,
          work_status: workStatus || null,
          admin_type: adminType || null,
          ward: ward || null,
          license: license || null,
          branch: branch || null,
          area: area || null,
          position: position || null,
        };

        const { data, error } = await supabase
          .from('accounts')
          .insert([insertRow])
          .select(ACCOUNT_SELECT)
          .single();

        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true, item: toCamel(data) });
      }

      // 수정
      if (method === 'PATCH') {
        const body = safeJson(event.body) || {};
        const { id } = body;
        if (!id) return send(400, { ok:false, message:'id 필요' });

        const {
          email, password, role, name,
          phone, status,
          hospital, workStatus, adminType, ward, license, branch, area, position
        } = body;

        const updates = {};
        if (email) updates.email = String(email).toLowerCase();
        if (name !== undefined) updates.name = name;
        if (role) {
          // ✅ 역할 검증: DB roles 우선(비어있으면 상수 폴백)
          const roles = await loadRolesFromDB();
          const allowed = roles && roles.length ? roles : ALLOWED_ROLES;
          if (!allowed.includes(role)) return send(400, { ok:false, message:'허용되지 않은 role' });
          updates.role = role;
        }
        if (password) updates.password_hash = await bcrypt.hash(password, 10);

        if (phone !== undefined)      updates.phone       = phone;
        if (status !== undefined)     updates.status      = status;
        if (hospital !== undefined)   updates.hospital    = hospital;
        if (workStatus !== undefined) updates.work_status = workStatus;
        if (adminType !== undefined)  updates.admin_type  = adminType;
        if (ward !== undefined)       updates.ward        = ward;
        if (license !== undefined)    updates.license     = license;
        if (branch !== undefined)     updates.branch      = branch;
        if (area !== undefined)       updates.area        = area;
        if (position !== undefined)   updates.position    = position;

        const { data, error } = await supabase
          .from('accounts')
          .update(updates)
          .eq('id', id)
          .select(ACCOUNT_SELECT)
          .single();

        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true, item: toCamel(data) });
      }

      // 삭제
      if (method === 'DELETE') {
        const { id } = safeJson(event.body) || {};
        if (!id) return send(400, { ok:false, message:'id 필요' });

        const { error } = await supabase.from('accounts').delete().eq('id', id);
        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true });
      }

      return send(405, { ok:false, message:'Method Not Allowed' });
    }

    // ───────── C-arm 일일 기록 ─────────
    // GET  /api/carm?from=YYYY-MM-DD&to=YYYY-MM-DD
    // POST /api/carm { workDate, items: [{ type:'carm'|'arthro', qty:number }] }
    if (path === '/carm') {
      // 방사선사 또는 관리자만
      const check = requireRole(auth, ['radiology','admin']);
      if (!check.ok) return send(check.status, { ok:false, message:check.message });

      const meId = auth?.sub;
      if (!meId) return send(401, { ok:false, message:'unauthorized' });

      if (method === 'GET') {
        const url  = new URL(event.rawUrl);
        const from = url.searchParams.get('from');
        const to   = url.searchParams.get('to');

        let q = supabase.from('carm_daily')
          .select('id, work_date, proc_type, qty, created_at, updated_at, created_by')
          .order('work_date', { ascending:false })
          .order('proc_type', { ascending:true })
          .gte('work_date', from || '1900-01-01')
          .lte('work_date', to   || '2999-12-31');

        // radiology는 본인 것만, admin은 전체
        if (auth.role !== 'admin') q = q.eq('created_by', meId);

        const { data, error } = await q;
        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true, items: data });
      }

      if (method === 'POST') {
        const body = safeJson(event.body) || {};
        const workDate = body.workDate;
        const items = Array.isArray(body.items) ? body.items : [];

        if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
          return send(400, { ok:false, message:'workDate (YYYY-MM-DD) required' });
        }

        // upsert 2종(carm/arthro)
        const rows = items
          .filter(it => it && (it.type === 'carm' || it.type === 'arthro'))
          .map(it => ({
            work_date: workDate,
            proc_type: it.type,
            qty: Math.max(0, parseInt(it.qty ?? 0, 10)),
            created_by: meId
          }));

        if (!rows.length) return send(400, { ok:false, message:'items empty' });

        const { data, error } = await supabase
          .from('carm_daily')
          .upsert(rows, { onConflict: 'work_date,proc_type,created_by' })
          .select('id, work_date, proc_type, qty, created_at, updated_at, created_by');

        if (error) return send(400, { ok:false, message:error.message });
        return send(200, { ok:true, items: data });
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
