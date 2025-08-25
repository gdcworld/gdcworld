// netlify/functions/api.mjs
export async function handler(event) {
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

  // CORS
  if (event.httpMethod === "OPTIONS") return res(204);

  // ✅ 둘 다 허용: /.netlify/functions/api/*  또는  /api/*
  const fullPath = event.path || "";
  const route =
    fullPath.replace(/^\/(?:\.netlify\/functions\/api|api)/, "") || "/";

  // 헬스체크
  if ((route === "/" || route === "/health") && event.httpMethod === "GET") {
    return res(200, {
      ok: true,
      message: "Netlify function is alive",
      path: fullPath,
      hint: "Try GET /api/accounts or POST /api/accounts",
      time: new Date().toISOString(),
    });
  }

  // 프론트 연동 점검용
  if (route === "/accounts" && event.httpMethod === "GET") {
    return res(200, { items: [] });
  }

  return res(404, { error: "route not found", route, path: fullPath });
}
