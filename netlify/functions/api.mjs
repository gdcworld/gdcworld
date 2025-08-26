import { randomUUID } from "crypto";

// 메모리 저장소 (배포/콜드스타트 시 초기화됨)
const DB = { accounts: new Map() };

// 공통 응답
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
};
const res = (status, data = "") => ({
  statusCode: status,
  headers,
  body: typeof data === "string" ? data : JSON.stringify(data),
});

function parseJSON(body) {
  if (!body) return null;
  try { return JSON.parse(body); } catch { return Symbol.for("INVALID_JSON"); }
}

// /.netlify/functions/api/* 또는 /api/* 둘 다 허용
function getRoute(path) {
  const full = path || "";
  return full.replace(/^\/(?:\.netlify\/functions\/api|api)/, "") || "/";
}

// 프론트에서 쓰는 역할까지 허용
const ALLOWED_ROLES = [
  "admin", "staff", "member",
  "physio", "ptadmin", "nurse", "frontdesk", "radiology", "vice"
];

// ---- 유틸
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s || "");
const listAccounts = () => Array.from(DB.accounts.values());
const findByEmail = (email) => listAccounts().find(a => (a.email || "").toLowerCase() === (email||"").toLowerCase());

// ---- 밸리데이션
function validateForCreate({ name, email, password, role }) {
  if (!name || name.length < 2) return "name_required_or_too_short";
  if (!isEmail(email)) return "invalid_email";
  if (!password || password.length < 6) return "password_too_short";
  if (role && !ALLOWED_ROLES.includes(role)) return "invalid_role";
  return null;
}
function validateForUpdate({ name, email, password, role }) {
  if (!name || name.length < 2) return "name_required_or_too_short";
  if (email && !isEmail(email)) return "invalid_email";
  if (password && password.length < 6) return "password_too_short";
  if (role && !ALLOWED_ROLES.includes(role)) return "invalid_role";
  return null;
}

// ---- /health
async function handleHealth(event, route) {
  if ((route === "/" || route === "/health") && event.httpMethod === "GET") {
    return res(200, { ok: true, message: "alive", time: new Date().toISOString() });
  }
  return null;
}

// ---- /login  (POST { email, password })
async function handleLogin(event, route) {
  if (!(route === "/login" && event.httpMethod === "POST")) return null;

  const data = parseJSON(event.body);
  if (data === Symbol.for("INVALID_JSON")) return res(400, { ok:false, error:"invalid_json" });

  const { email, password } = data || {};
  if (!isEmail(email) || !password) return res(400, { ok:false, error:"email_and_password_required" });

  const user = findByEmail(email);
  if (!user || user.password !== password) return res(401, { ok:false, error:"invalid_credentials" });

  // 실제 운영이라면 여기서 JWT 발급/세션쿠키 설정 필요.
  // 연습용으로 토큰 없이 사용자 정보만 반환(비번 제거)
  const { password: _, ...safe } = user;
  return res(200, { ok: true, user: safe });
}

// ---- /accounts, /accounts/:id
async function handleAccounts(event, route) {
  const m = route.match(/^\/accounts(?:\/([^\/]+))?$/);
  if (!m) return null;

  const id = m[1];
  const method = event.httpMethod;

  // 목록
  if (!id && method === "GET") {
    return res(200, { items: listAccounts() });
  }

  // 생성
  if (!id && method === "POST") {
    const data = parseJSON(event.body);
    if (data === Symbol.for("INVALID_JSON"))
      return res(400, { ok:false, error:"invalid_json" });

    const err = validateForCreate(data || {});
    if (err) return res(400, { ok:false, error: err });

    const now = new Date().toISOString();
    const newObj = {
      id: randomUUID(),
      name: data.name,
      email: data.email,
      password: data.password, // ⚠️ 연습용 평문 (운영 시 반드시 해시)
      role: data.role || "member",
      createdAt: now,
      updatedAt: now,
    };
    DB.accounts.set(newObj.id, newObj);
    return res(201, newObj);
  }

  // 단건 조회
  if (id && method === "GET") {
    const found = DB.accounts.get(id);
    if (!found) return res(404, { ok:false, error:"not_found" });
    return res(200, found);
  }

  // 수정
  if (id && method === "PATCH") {
    const data = parseJSON(event.body);
    if (data === Symbol.for("INVALID_JSON"))
      return res(400, { ok:false, error:"invalid_json" });

    const cur = DB.accounts.get(id);
    if (!cur) return res(404, { ok:false, error:"not_found" });

    const next = { ...cur, ...data, updatedAt: new Date().toISOString() };
    const err = validateForUpdate(next);
    if (err) return res(400, { ok:false, error: err });

    DB.accounts.set(id, next);
    return res(200, next);
  }

  // 삭제
  if (id && method === "DELETE") {
    const existed = DB.accounts.delete(id);
    if (!existed) return res(404, { ok:false, error:"not_found" });
    return res(200, { ok:true, id });
  }

  return res(405, { ok:false, error:"method_not_allowed" });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return res(204);

  const route = getRoute(event.path);

  // health
  const health = await handleHealth(event, route); if (health) return health;

  // login
  const login = await handleLogin(event, route); if (login) return login;

  // accounts
  const accounts = await handleAccounts(event, route); if (accounts) return accounts;

  return res(404, { ok:false, error:"route_not_found", route, path:event.path });
}
