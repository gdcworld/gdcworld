import { randomUUID } from "crypto";

// 메모리 저장소
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

// JSON 파서
function parseJSON(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return Symbol.for("INVALID_JSON");
  }
}

// 경로 파싱
function getRoute(path) {
  const full = path || "";
  return full.replace(/^\/(?:\.netlify\/functions\/api|api)/, "") || "/";
}

// 밸리데이션 함수
function validateAccount({ name, email, password, role }) {
  if (!name || name.length < 2) return "name_required_or_too_short";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "invalid_email";
  if (!password || password.length < 6) return "password_too_short";
  if (role && !["admin", "staff", "member"].includes(role)) return "invalid_role";
  return null; // 에러 없음
}

// 엔드포인트
async function handleAccounts(event, route) {
  const m = route.match(/^\/accounts(?:\/([^\/]+))?$/);
  if (!m) return null;

  const id = m[1];
  const method = event.httpMethod;

  // GET /accounts (목록)
  if (!id && method === "GET") {
    return res(200, { items: Array.from(DB.accounts.values()) });
  }

  // POST /accounts (생성)
  if (!id && method === "POST") {
    const data = parseJSON(event.body);
    if (data === Symbol.for("INVALID_JSON"))
      return res(400, { ok: false, error: "invalid_json" });

    const error = validateAccount(data || {});
    if (error) return res(400, { ok: false, error });

    const now = new Date().toISOString();
    const newObj = {
      id: randomUUID(),
      name: data.name,
      email: data.email,
      password: data.password, // ⚠️ 여기서는 평문 저장 (실제로는 해시해야 함)
      role: data.role || "member",
      createdAt: now,
      updatedAt: now,
    };
    DB.accounts.set(newObj.id, newObj);
    return res(201, newObj);
  }

  // GET /accounts/:id
  if (id && method === "GET") {
    const found = DB.accounts.get(id);
    if (!found) return res(404, { ok: false, error: "not_found" });
    return res(200, found);
  }

  // PATCH /accounts/:id
  if (id && method === "PATCH") {
    const data = parseJSON(event.body);
    if (data === Symbol.for("INVALID_JSON"))
      return res(400, { ok: false, error: "invalid_json" });

    const cur = DB.accounts.get(id);
    if (!cur) return res(404, { ok: false, error: "not_found" });

    const next = { ...cur, ...data, updatedAt: new Date().toISOString() };
    const error = validateAccount(next);
    if (error) return res(400, { ok: false, error });

    DB.accounts.set(id, next);
    return res(200, next);
  }

  // DELETE /accounts/:id
  if (id && method === "DELETE") {
    const existed = DB.accounts.delete(id);
    if (!existed) return res(404, { ok: false, error: "not_found" });
    return res(200, { ok: true, id });
  }

  return res(405, { ok: false, error: "method_not_allowed" });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return res(204);

  const route = getRoute(event.path);

  if ((route === "/" || route === "/health") && event.httpMethod === "GET") {
    return res(200, { ok: true, message: "alive", time: new Date().toISOString() });
  }

  const accounts = await handleAccounts(event, route);
  if (accounts) return accounts;

  return res(404, { ok: false, error: "route_not_found", route, path: event.path });
}
