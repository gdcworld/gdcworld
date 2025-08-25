// netlify/functions/api.mjs
import { randomUUID } from "node:crypto";

// 간단 계정 CRUD (메모리 저장). 실제 운영은 DB + 비밀번호 해시 필수!
export async function handler(event) {
  const { httpMethod } = event;

  // CORS
  const baseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };
  const res = (status, data = "") => ({
    statusCode: status,
    headers: baseHeaders,
    body: typeof data === "string" ? data : JSON.stringify(data),
  });
  if (httpMethod === "OPTIONS") return res(204);

  // 인메모리 저장소 (콜드스타트 후 새로 고쳐질 수 있음)
  globalThis.__MEM__ ||= { accounts: [] };
  const store = globalThis.__MEM__.accounts;

  // ----- 경로 파싱 (리다이렉트 유무 모두 대응) -----
  let pathname = "";
  try {
    pathname = new URL(event.rawUrl).pathname;
  } catch {
    // 혹시 rawUrl이 없다면 fallback
    pathname = event.path || "";
  }

  // /api/...  또는 /.netlify/functions/api/...
  let subPath = "";
  if (pathname === "/api" || pathname === "/.netlify/functions/api") {
    subPath = ""; // 루트
  } else if (pathname.startsWith("/api/")) {
    subPath = pathname.slice("/api/".length); // accounts, accounts/uid ...
  } else if (pathname.startsWith("/.netlify/functions/api/")) {
    subPath = pathname.slice("/.netlify/functions/api/".length);
  }

  const [resource, uid] = subPath.split("/");

  // 유틸
  const nowIso = () => new Date().toISOString();
  const newUid = () =>
    `${(randomUUID?.() ?? "uid_" + Math.random().toString(36).slice(2))}_${Date.now()}`;

  // ---------- 루트 헬스체크 ----------
  if (!resource) {
    return res(200, {
      ok: true,
      message: "Netlify function is alive",
      path: pathname,
      hint: "Try GET /api/accounts or POST /api/accounts",
    });
  }

  // ---------- /api/accounts (GET 목록/검색/페이지, POST 생성) ----------
  if (resource === "accounts" && !uid) {
    if (httpMethod === "GET") {
      const qs = event.queryStringParameters || {};
      const role = (qs.role || "").trim();
      const q = (qs.q || "").trim().toLowerCase();
      const page = Math.max(1, parseInt(qs.page || "1", 10));
      const perPage = Math.max(1, parseInt(qs.perPage || "10", 10));

      let list = store;
      if (role) list = list.filter((a) => a.role === role);
      if (q) {
        list = list.filter((a) => {
          const hay = [
            a.loginId, a.name, a.email, a.phone,
            a.hospital, a.workStatus, a.adminType,
            a.ward, a.license, a.branch, a.area, a.position,
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        });
      }
      const total = list.length;
      const start = (page - 1) * perPage;
      const data = list.slice(start, start + perPage);
      return res(200, { data, total, page, perPage });
    }

    if (httpMethod === "POST") {
      let payload = {};
      try {
        payload = JSON.parse(event.body || "{}");
      } catch {
        return res(400, { error: "Invalid JSON" });
      }
      if (!payload.loginId || !payload.name || !payload.role) {
        return res(400, { error: "loginId, name, role 필수" });
      }
      if (store.some((a) => a.loginId === payload.loginId)) {
        return res(409, { error: "이미 존재하는 로그인ID" });
      }

      const now = nowIso();
      const item = {
        uid: payload.uid || newUid(),
        role: payload.role,
        loginId: payload.loginId,
        name: payload.name,
        email: payload.email || "",
        phone: payload.phone || "",
        status: payload.status || "active",
        // role extras
        hospital: payload.hospital || "",
        workStatus: payload.workStatus || "",
        adminType: payload.adminType || "",
        ward: payload.ward || "",
        license: payload.license || "",
        branch: payload.branch || "",
        area: payload.area || "",
        position: payload.position || "",
        // 데모: 절대 평문 저장하지 마세요(운영시 서버에서 해시)
        passwordHash: payload.password ? `PLAIN:${payload.password}` : "",
        createdAt: payload.createdAt || now,
        updatedAt: payload.updatedAt || now,
      };

      store.unshift(item);
      return res(201, item);
    }

    return res(405, { error: "Method Not Allowed" });
  }

  // ---------- /api/accounts/:uid (PATCH 수정, DELETE 삭제) ----------
  if (resource === "accounts" && uid) {
    const idx = store.findIndex((a) => a.uid === uid);
    if (idx === -1) return res(404, { error: "not found" });

    if (httpMethod === "PATCH") {
      let payload = {};
      try {
        payload = JSON.parse(event.body || "{}");
      } catch {
        return res(400, { error: "Invalid JSON" });
      }

      const prev = store[idx];
      // loginId 충돌 체크
      if (payload.loginId && store.some((a) => a.loginId === payload.loginId && a.uid !== uid)) {
        return res(409, { error: "이미 존재하는 로그인ID" });
      }

      const next = {
        ...prev,
        loginId: payload.loginId ?? prev.loginId,
        name: payload.name ?? prev.name,
        email: payload.email ?? prev.email,
        phone: payload.phone ?? prev.phone,
        status: payload.status ?? prev.status,
        hospital: payload.hospital ?? prev.hospital,
        workStatus: payload.workStatus ?? prev.workStatus,
        adminType: payload.adminType ?? prev.adminType,
        ward: payload.ward ?? prev.ward,
        license: payload.license ?? prev.license,
        branch: payload.branch ?? prev.branch,
        area: payload.area ?? prev.area,
        position: payload.position ?? prev.position,
        updatedAt: nowIso(),
      };

      if (typeof payload.password === "string" && payload.password.trim()) {
        next.passwordHash = `PLAIN:${payload.password}`; // 데모
      }

      store[idx] = next;
      return res(200, next);
    }

    if (httpMethod === "DELETE") {
      store.splice(idx, 1);
      return res(204, ""); // 204 본문 없음
    }

    return res(405, { error: "Method Not Allowed" });
  }

  // 라우팅 미스
  return res(404, { error: "route not found" });
}
