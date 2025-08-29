// assets/auth.js
(function () {
  const KEY = 'gdc.session';
  const now = () => Date.now();

  // ── Legacy 지원: gdc_user → gdc.session 자동 마이그레이션 ──
  function readLegacyUser() {
    try {
      const raw = localStorage.getItem('gdc_user');
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (!u || !u.email || !u.role) return null;
      // 세션 형태로 변환
      return {
        email: u.email,
        role: u.role,
        iat: now(),
        exp: now() + 1000 * 60 * 60 * 8, // 8시간
      };
    } catch (e) {
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
      // 여기까지 오면 세션이 없거나 만료됨 → 레거시 키 시도
      const legacy = readLegacyUser();
      if (legacy) {
        // 자동 마이그레이션: legacy → session
        localStorage.setItem(KEY, JSON.stringify(legacy));
        // 원래 키는 정리(선택)
        // localStorage.removeItem('gdc_user');
        return legacy;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function setSession(s) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function clearSession() {
    localStorage.removeItem(KEY);
    // 레거시 키도 함께 정리
    localStorage.removeItem('gdc_user');
  }

  // ⚠️ 데모용 하드코딩 계정 — 운영 전 교체 필수
  const DB = {
    'admin@gdcworld.co.kr': { password: 'admin123', role: 'admin' },
    'staff@gdcworld.co.kr': { password: 'staff123', role: 'staff' },
  };

  function login(email, password) {
    const user = DB[email?.toLowerCase?.()];
    if (!user || user.password !== password) {
      const err = new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
      err.code = 'BAD_CREDENTIALS';
      throw err;
    }
    const session = {
      email,
      role: user.role,
      iat: now(),
      exp: now() + 1000 * 60 * 60 * 8, // 8시간
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
      location.replace('login.html');   // 로그인 화면으로
      return;
    }
    if (roles && !roles.includes(s.role)) {
      alert('권한이 없습니다.');
      location.replace('login.html');   // 권한 없으면 로그인으로
      return;
    }
  }

  function currentRole() {
    const s = getSession();
    return s?.role ?? null;
  }

  function currentUserEmail() {
    const s = getSession();
    return s?.email ?? null;
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
  };
})();
