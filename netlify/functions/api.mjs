// netlify/functions/api.mjs
import { randomUUID } from "crypto";

// ⚠️ 메모리 저장소 (배포/콜드스타트 시 초기화됨)
const DB = {
  accounts: new Map(), // id -> { id, name, email, role, createdAt, updatedAt }
};

// 공통 응답 헬퍼
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

// 경로 파싱: 둘 다 허용 (/.netlify/functions/api/*, /api/*)
function getRoute(path) {
  const full = path || "";
  return full.replace(/^\/(?:\.netlify\/functions\/api|api)/, "") || "/";
}

// 엔드포인트 구현
async function handleHealth(event, route) {
  if ((route === "/" || route === "/health") && event.httpMethod === "GET") {
    return res(200, {
      ok: true,
      message: "Netlify function is alive",
      path: event.path,
      time: new Date().toISOString(),
      hint: "Try GET /api/accounts",
    });
  }
  return null;
}

function toList(map) {
  return Array.from(map.values()).sort((a, b) =>
    (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
  );
}

async function handleAccounts(event, route) {
  // /accounts 또는 /accounts/:id
  const m = route.match(/^\/accounts(?:\/([^\/]+))?$/);
  if (!m) return null;

  const id = m[1]; // 존재하면 단건
  const method = event.httpMethod;

  // GET /accounts  (목록)
  if (!id && method === "GET") {
    const q = new URLSearchParams(event.queryStringParameters || {}).get("q");
    let items = toList(DB.accounts);
    if (q) {
      const s = q.toLowerCase();
      items = items.filter(
        (a) =>
          (a.name || "").toLowerCase().includes(s) ||
          (a.email || "").toLowerCase().includes(s) ||
          (a.role || "").toLowerCase().includes(s)
      );
    }
    return res(200, { items, count: items.length });
  }

  // GET /accounts/:id (조회)
  if (id && method === "GET") {
    const found = DB.accounts.get(id);
    if (!found) return res(404, { ok: false, error: "not_found" });
    return res(200, found);
  }

  // POST /accounts (생성)
  if (!id && method === "POST") {
    const data = parseJSON(event.body);
    if (data === Symbol.for("INVALID_JSON"))
      return res(400, { ok: false, error: "invalid_json" });

    const { name, email, role } = data || {};
    if (!name || !email)
      return res(400, { ok: false, error: "name_and_email_required" });

    const now = new Date().toISOString();
    const newObj = {
      id: randomUUID(),
      name,
      email,
      role: role || "member",
      createdAt: now,
      updatedAt: now,
    };
    DB.accounts.set(newObj.id, newObj);
    return res(201, newObj);
  }

  // PATCH /accounts/:id (부분 수정)
  if (id && method === "PATCH") {
    const data = parseJSON(event.body);
    if (data === Symbol.for("INVALID_JSON"))
      return res(400, { ok: false, error: "invalid_json" });

    const cur = DB.accounts.get(id);
    if (!cur) return res(404, { ok: false, error: "not_found" });

    const next = {
      ...cur,
      ...["name", "email", "role"].reduce((acc, k) => {
        if (k in (data || {})) acc[k] = data[k];
        return acc;
      }, {}),
      updatedAt: new Date().toISOString(),
    };
    DB.accounts.set(id, next);
    return res(200, next);
  }

  // DELETE /accounts/:id (삭제)
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

  // 1) 헬스
  const health = await handleHealth(event, route);
  if (health) return health;

  // 2) 계정 CRUD
  const accounts = await handleAccounts(event, route);
  if (accounts) return accounts;

  // 3) 404
  return res(404, { ok: false, error: "route_not_found", route, path: event.path });
}
