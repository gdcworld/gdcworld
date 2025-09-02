// assets/auth.js
(function () {
  const KEY = 'gdc.session';
  const now = () => Date.now();

  // ───────── Legacy 지원: gdc_user → gdc.session 자동 마이그레이션 ─────────
  function readLegacyUser() {
    try {
      const raw = localStorage.getItem('gdc_user');
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (!u || !u.email || !u.role) return null;
      return {
        email: String(u.email).toLowerCase(),
        role: u.role,
        iat: now(),
        exp: now() + 1000 * 60 * 60 * 8, // 8h
      };
    } catch {
      return null;
    }
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (!s || !s.exp || now() > s.exp) {
          localStorage.removeItem(KEY);
        } else {
          return s;
        }
      }
      const legacy = readLegacyUser();
      if (legacy) {
        localStorage.setItem(KEY, JSON.stringify(legacy));
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  }

  function setSession(s) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function clearSession() {
    localStorage.removeItem(KEY);
    localStorage.removeItem('gdc_user'); // 레거시도 정리
  }

  // ───────── 로그인 (서버 토큰 포함) ─────────
  async function login(email, password) {
    const payload = JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      password: String(password || '')
    });

    // 1차: /api/login
    let r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });

    // 2차: 함수 직접 경로로 재시도
    if (!r.ok) {
      r = await fetch('/.netlify/functions/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    }

    let j = null;
    try { j = await r.json(); } catch {}

    if (!r.ok || j?.ok === false) {
      const msg = (j && (j.message || j.error)) || 'login_failed';
      const err = new Error('로그인 실패: ' + msg);
      err.code = 'LOGIN_FAILED';
      throw err;
    }

    // 서버가 내려준 사용자 + token 저장
    const user = j.user || {};
    const session = {
      email: user.email,
      role: user.role,
      token: j.token || null,           // ★ 추가
      iat: now(),
      exp: now() + 1000 * 60 * 60 * 8   // 8h
    };
    setSession(session);
    return session;
  }

  function logout() {
    clearSession();
  }

  // 페이지 접근 보호
  function requireRole(roles) {
    const s = getSession();
    if (!s) {
      alert('로그인이 필요합니다.');
      location.replace('login.html');
      return;
    }
    if (roles && !roles.includes(s.role)) {
      alert('권한이 없습니다.');
      location.replace('login.html');
      return;
    }
  }

  function currentRole() {
    return getSession()?.role ?? null;
  }
  function currentUserEmail() {
    return getSession()?.email ?? null;
  }
  function currentToken() {
    return getSession()?.token ?? null;
  }

  // 전역 노출
  window.Auth = {
    getSession,
    setSession,
    login,
    logout,
    requireRole,
    currentRole,
    currentUserEmail,
    currentToken       // ★ 추가
  };
})();
