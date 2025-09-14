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

function normReservation(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['예약','reserved','y','yes','true','1'].includes(s)) return '예약';
  if (['미예약','not_reserved','n','no','false','0'].includes(s)) return '미예약';
  return '체크안함';
}
function normVisitType(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['신환','new'].includes(s)) return '신환';
  if (['재진','revisit'].includes(s)) return '재진';
  return '기타여부';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return send(204, {});

  // 실제 path 계산 (프록시/직접호출 모두 지원)
  const rawUrl  = event.rawUrl ? new URL(event.rawUrl) : null;
const rawPath = rawUrl ? rawUrl.pathname : (event.path || '');
let path = (rawPath || '')
  .replace(/\/.netlify\/functions\/api/i, '')
  .replace(/^\/api/i, '');
if (!path || path === '') path = '/';
if (!path.startsWith('/')) path = '/' + path;

  const method = (event.httpMethod || 'GET').toUpperCase();
  const auth   = readAuth(event); // 로그인 토큰 해석 (없으면 null)

  // ───────── 유틸 라우트 ─────────
  if (rawUrl && rawUrl.searchParams.get('__whoami') === '1') {
    const url = process.env.SUPABASE_URL || '';
    const m   = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const ref = m ? m[1] : null;
    return send(200, { ok:true, supabaseUrl:url, projectRef:ref });
  }
  if (path === '/whoami' && method === 'GET') {
    const url = process.env.SUPABASE_URL || '';
    const m   = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const ref = m ? m[1] : null;
    return send(200, { ok:true, supabaseUrl:url, projectRef:ref });
  }
  if (path === '/health' && method === 'GET') {
    return send(200, { ok:true, message:'alive', time:new Date().toISOString() });
  }
  if (path === '/' && method === 'GET') {
    return send(404, { ok:false, message:'Not Found' });
  }

  // ───────── roles 목록 (로그인 필요) ─────────
  if (path === '/roles' && method === 'GET') {
    const check = requireLogin(auth);
    if (!check.ok) return send(check.status, { ok:false, message:check.message });
    const roles = await loadRolesFromDB();
    return send(200, { ok:true, items: roles });
  }
// ───────── C-arm 사용자 목록 (admin + radiology 전용) ─────────
if (path === '/carm/users' && method === 'GET') {
  const check = requireRole(auth, ['admin','radiology']);
  if (!check.ok) return send(check.status, { ok:false, message: check.message });

  const { data: admins, error: e1 } = await supabase
    .from('accounts').select('id,name').eq('role','admin')
    .order('created_at', { ascending: true });
  if (e1) return send(400, { ok:false, message: e1.message });

  const { data: rads, error: e2 } = await supabase
    .from('accounts').select('id,name').eq('role','radiology')
    .order('name', { ascending: true });
  if (e2) return send(400, { ok:false, message: e2.message });

  return send(200, { ok:true, admins: admins || [], radiology: rads || [] });
}



  // ───────── 로그인 ─────────
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

    // 토큰 발급 (8시간)
    const now = Date.now();
    const token = signToken({
      sub: user.id, email: user.email, role: user.role,
      iat: now, exp: now + 1000*60*60*8
    });

    return send(200, { ok:true, user:{ id:user.id, email:user.email, role:user.role }, token });
  }

  // ───────── 계정 CRUD (관리자) ─────────
  if (path === '/accounts') {
    const check = requireRole(auth, ['admin']);
    if (!check.ok) return send(check.status, { ok:false, message: check.message });

    if (method === 'GET') {
      const { data, error } = await supabase
        .from('accounts')
        .select(ACCOUNT_SELECT)
        .order('created_at', { ascending:false });
      if (error) return send(500, { ok:false, message:error.message });
      return send(200, { ok:true, items: (data || []).map(toCamel) });
    }

    if (method === 'POST') {
      const body = safeJson(event.body) || {};
      const {
        email, password, role, name,
        phone, status,
        hospital, workStatus, adminType, ward, license, branch, area, position
      } = body;

      if (!email || !password || !role) return send(400, { ok:false, message:'email/password/role 필요' });

      const roles = await loadRolesFromDB();
      const allowed = roles && roles.length ? roles : ALLOWED_ROLES;
      if (!allowed.includes(role)) return send(400, { ok:false, message:'허용되지 않은 role' });

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
  // POST /api/carm { workDate, items:[{type:'carm'|'arthro', qty}], createdBy? }
  if (path === '/carm') {
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

    if (auth.role !== 'admin') q = q.eq('created_by', meId);

    const { data, error } = await q;
    if (error) return send(400, { ok:false, message:error.message });
    return send(200, { ok:true, items: data });
  }

  if (method === 'POST') {
  const body = safeJson(event.body) || {};
  const workDate = body.workDate;
  const items    = Array.isArray(body.items) ? body.items : [];
  const mode     = (body.mode || 'add').toLowerCase(); // 'add' | 'set'

  if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return send(400, { ok:false, message:'workDate (YYYY-MM-DD) required' });
  }

  // 관리자면 지정 사용자, 아니면 본인
  const targetId = (auth.role === 'admin' && body.createdBy)
    ? String(body.createdBy)
    : meId;

  // 관심 타입만
  const wanted = items
    .filter(it => it && (it.type === 'carm' || it.type === 'arthro'))
    .map(it => ({ type: it.type, qty: Math.max(0, parseInt(it.qty ?? 0, 10)) }));

  if (!wanted.length) return send(400, { ok:false, message:'items empty' });

  // ── 기존 값 조회 (누적 모드에서만 필요하지만, 비용 작아서 공통으로 둬도 OK)
  const { data: existing, error: selErr } = await supabase
    .from('carm_daily')
    .select('proc_type, qty')
    .eq('work_date', workDate)
    .eq('created_by', targetId)
    .in('proc_type', wanted.map(w => w.type));

  if (selErr) return send(400, { ok:false, message: selErr.message });

  const prevMap = Object.fromEntries((existing || []).map(r => [r.proc_type, Number(r.qty || 0)]));

  // ── 모드별 계산: set = 덮어쓰기, add = 누적
  const rows = wanted.map(w => ({
    work_date:  workDate,
    proc_type:  w.type,
    created_by: targetId,
    qty: mode === 'set' ? w.qty : (prevMap[w.type] || 0) + w.qty
  }));

  const { data, error } = await supabase
    .from('carm_daily')
    .upsert(rows, { onConflict: 'work_date,proc_type,created_by' })
    .select('id, work_date, proc_type, qty, created_at, updated_at, created_by');

  if (error) return send(400, { ok:false, message:error.message });
  return send(200, { ok:true, items: data });
}

  return send(405, { ok:false, message:'Method Not Allowed' });
}

  // ───────── C-arm 월간 요약 ─────────
  // GET /api/carm/summary?month=YYYY-MM
  if (path === '/carm/summary' && method === 'GET') {
  const check = requireRole(auth, ['radiology','admin']);
  if (!check.ok) return send(check.status, { ok:false, message:check.message });

  const url   = new URL(event.rawUrl);
  const month = url.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return send(400, { ok:false, message:'month (YYYY-MM) required' });
  }

  const from = `${month}-01`;
  const [yy, mm] = month.split('-').map(Number);
  const nextMonth = (mm === 12)
    ? `${yy + 1}-01-01`
    : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;

  let q = supabase.from('carm_daily')
    .select('work_date, proc_type, qty, created_by')
    .gte('work_date', from).lt('work_date', nextMonth)
    .order('work_date', { ascending: true });

  // radiology는 admin+radiology 두 역할만 합쳐서 보이게, 그 외는 본인만
  if (auth.role === 'radiology') {
    const { data: admins } = await supabase.from('accounts').select('id').eq('role', 'admin');
    const { data: radios } = await supabase.from('accounts').select('id').eq('role', 'radiology');
    const adminIds = (admins || []).map(a => a.id);
    const radioIds = (radios  || []).map(a => a.id);
    q = q.in('created_by', [...adminIds, ...radioIds]);
  } else if (auth.role !== 'admin') {
    q = q.eq('created_by', auth.sub);
  }

  const { data, error } = await q;
  if (error) return send(400, { ok: false, message: error.message });

  // id → 이름 매핑
  const ids = Array.from(new Set((data || []).map(r => r.created_by))).filter(Boolean);
  let id2name = {};
  if (ids.length) {
    const { data:accs, error:err2 } = await supabase
      .from('accounts').select('id,name').in('id', ids);
    if (err2) return send(400, { ok:false, message:err2.message });
    id2name = Object.fromEntries((accs || []).map(a => [a.id, a.name || '무명']));
  }

  // 집계
  const days   = {}; // 일자 x 사용자
  const users  = {};
  const totals = {}; // 사용자별 합계
  const daysSum = {}; // ✅ 일자별 총합 (C/A)

  for (const r of (data || [])) {
    const day = Number(String(r.work_date).slice(-2));
    const uname = id2name[r.created_by] || '무명';
    users[uname] = true;

    (days[day] ??= {}); (days[day][uname] ??= { carm:0, arthro:0 });
    days[day][uname][r.proc_type] += Number(r.qty || 0);

    (totals[uname] ??= { carm:0, arthro:0 })[r.proc_type] += Number(r.qty || 0);
    (daysSum[day] ??= { carm:0, arthro:0 })[r.proc_type] += Number(r.qty || 0); // ✅ 추가
  }

 const userList = Object.keys(users).sort((a,b)=>a.localeCompare(b,'ko'));
const rows = [];

// month는 "YYYY-MM"; mm는 1~12. JS Date에서 month+1 을 주고 day=0이면 그 달의 마지막 일수를 얻음.
const lastDay = new Date(yy, mm, 0).getDate();

for (let d = 1; d <= lastDay; d++) {
  const row = { day: d };
  for (const u of userList) {
    const v = (days[d]?.[u]) || { carm:0, arthro:0 };
    row[`${u}__carm`]   = v.carm;
    row[`${u}__arthro`] = v.arthro;
  }
  rows.push(row);
}

return send(200, { ok:true, users: userList, rows, totals, daysSum });
}
// ───────── 지출(Expenses) ─────────
// GET  /api/expenses?month=YYYY-MM&method=hospital_card
// POST /api/expenses { payDate, amount, merchant, purpose, method?, note? }
// PATCH /api/expenses { id, ...fields }
// DELETE /api/expenses { id }
if (path === '/expenses') {
  const check = requireRole(auth, ['admin','frontdesk']); // 필요 시 다른 역할 허용
  if (!check.ok) return send(check.status, { ok:false, message: check.message });

  if (method === 'GET') {
    const url   = new URL(event.rawUrl);
    const month = url.searchParams.get('month'); // YYYY-MM
    const methodFilter = (url.searchParams.get('method') || 'hospital_card').toLowerCase();

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return send(400, { ok:false, message:'month (YYYY-MM) required' });
    }

    const [yy, mm] = month.split('-').map(Number);
    const from = `${month}-01`;
    const nextMonth = (mm === 12) ? `${yy+1}-01-01` : `${yy}-${String(mm+1).padStart(2,'0')}-01`;

    const { data, error } = await supabase
      .from('expenses')
      .select('id, pay_date, amount, merchant, purpose, method, note, created_by, created_at')
      .eq('method', methodFilter)
      .gte('pay_date', from).lt('pay_date', nextMonth)
      .order('pay_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) return send(400, { ok:false, message: error.message });

    // 월 합계
    const total = (data || []).reduce((s, r)=> s + (Number(r.amount)||0), 0);
    return send(200, { ok:true, items: data || [], total });
  }

  if (method === 'POST') {
    const body = safeJson(event.body) || {};
    const payDate = body.payDate;
    const amount = Number(body.amount || 0);
    const merchant = (body.merchant || '').trim();
    const purpose  = (body.purpose  || '').trim();
    const methodName = (body.method || 'hospital_card').toLowerCase();
    const note = (body.note || '').trim();

    if (!payDate || !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return send(400, { ok:false, message:'payDate (YYYY-MM-DD) required' });
    if (!merchant || !purpose) return send(400, { ok:false, message:'merchant/purpose required' });
    if (!amount || amount <= 0) return send(400, { ok:false, message:'amount > 0 required' });

    const row = {
      pay_date: payDate,
      amount, merchant, purpose,
      method: methodName,
      note: note || null,
      created_by: auth?.sub || null
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert([row])
      .select('id, pay_date, amount, merchant, purpose, method, note, created_by, created_at')
      .single();

    if (error) return send(400, { ok:false, message: error.message });
    return send(200, { ok:true, item: data });
  }

  if (method === 'PATCH') {
    const body = safeJson(event.body) || {};
    const { id } = body;
    if (!id) return send(400, { ok:false, message:'id required' });

    const updates = {};
    if (body.payDate)        updates.pay_date = body.payDate;
    if (body.amount!=null)   updates.amount   = Number(body.amount||0);
    if (body.merchant!=null) updates.merchant = String(body.merchant||'').trim();
    if (body.purpose!=null)  updates.purpose  = String(body.purpose||'').trim();
    if (body.method)         updates.method   = String(body.method||'').toLowerCase();
    if (body.note!=null)     updates.note     = String(body.note||'').trim();

    const { data, error } = await supabase
      .from('expenses')
      .update(updates)
      .eq('id', id)
      .select('id, pay_date, amount, merchant, purpose, method, note, created_by, created_at')
      .single();

    if (error) return send(400, { ok:false, message: error.message });
    return send(200, { ok:true, item: data });
  }

  if (method === 'DELETE') {
    const { id } = safeJson(event.body) || {};
    if (!id) return send(400, { ok:false, message:'id required' });
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) return send(400, { ok:false, message: error.message });
    return send(200, { ok:true });
  }

  return send(405, { ok:false, message:'Method Not Allowed' });
}
// ───────── 도수치료 (DOSU) 임시 라우트 ─────────
// GET  /api/dosu/summary?start=YYYY-MM-DD&end=YYYY-MM-DD&physioId=optional
// GET  /api/dosu/daily?start=YYYY-MM-DD&end=YYYY-MM-DD&physioId=optional
// POST /api/dosu/records { writtenAt, hospital, physioId, patient, room, incentive, visitType, amount, treat:{only,inj,eswt}, reservation }
if (path.startsWith('/dosu/')) {
  const check = requireRole(auth, ['admin','physio','ptadmin']);
  if (!check.ok) return send(check.status, { ok:false, message: check.message });

  const url = event.rawUrl ? new URL(event.rawUrl) : null;
  const start = url?.searchParams.get('start') || new Date().toISOString().slice(0,10);
  const end   = url?.searchParams.get('end')   || start;
  const physioId = url?.searchParams.get('physioId') || null;

  // ✅ 요약 조회
  if (path === '/dosu/summary' && method === 'GET') {
  let q = supabase.from('dosu_records')
    .select('visit_type, amount') 
    .gte('written_at', start).lte('written_at', end);
  if (physioId) q = q.eq('physio_id', Number(physioId));
  const { data, error } = await q;
    if (error) return send(400, { ok:false, message:error.message });

    const kpi = {
      current: data.length,
      new: data.filter(r=>r.visit_type==='신환').length,
      revisit: data.filter(r=>r.visit_type==='재진').length,
      revisitRate: Math.round(data.filter(r=>r.visit_type==='재진').length * 100 / (data.length||1)),
      revenue: data.reduce((s,r)=>s+Number(r.amount||0),0)
    };

    return send(200, { ok:true, kpi, therapists:[], newDist:[], revisit:[] });
  }

  // ✅ 일별 조회
  if (path === '/dosu/daily' && method === 'GET') {
  let q = supabase
    .from('dosu_records')
    .select('written_at, visit_type, amount')
    .gte('written_at', start).lte('written_at', end);

 if (physioId) q = q.eq('physio_id', Number(physioId));

  const { data, error } = await q;
  if (error) return send(400, { ok:false, message:error.message });

  const byDate = {};
  (data||[]).forEach(r => {
    const d = r.written_at;
    if (!byDate[d]) byDate[d] = { date:d, visits:0, new:0, revisit:0, revenue:0, rate:0 };
    byDate[d].visits++;
    if (r.visit_type === '신환')   byDate[d].new++;
    if (r.visit_type === '재진')   byDate[d].revisit++;
    byDate[d].revenue += Number(r.amount || 0);
  });

  Object.values(byDate).forEach(v => {
  v.rate = v.visits ? Math.round((v.revisit * 100) / v.visits) : 0;
});

const items = Object.values(byDate).sort((a,b) => String(a.date).localeCompare(String(b.date)));
return send(200, { ok:true, items });
}

  // ✅ 기록 추가
  if (path === '/dosu/records' && method === 'POST') {
  const body = safeJson(event.body) || {};
  if (!body.physioId || !body.patient) {
    return send(400, { ok:false, message:'physioId, patient 필수' });
  }

  const row = {
  written_at: body.writtenAt,
  hospital: body.hospital || null,
  physio_id: body.physioId ? Number(body.physioId) : null,
  patient: (body.patient || '').trim(),
  room: body.room || null,
  incentive: body.incentive || null,
  visit_type: normVisitType(body.visitType),     // ← 한글 반환
  amount: Number(body.amount || 0) || 0,
  treat: body.treat || {},
  reservation: normReservation(body.reservation), // ← 한글 반환
  created_by: auth?.sub || null
};

  const { data, error } = await supabase
    .from('dosu_records')
    .insert([row])
    .select()
    .single();

  if (error) return send(400, { ok:false, message:error.message });
  return send(200, { ok:true, item:data });
}

  return send(405, { ok:false, message:'Method Not Allowed' });
}


  // 라우트 없음
  return send(404, { ok:false, error:'route_not_found', route:path, path:rawPath });
}
