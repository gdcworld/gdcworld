// assets/auth.js
(function () {
  const KEY = 'gdc.session';
  const now = () => Date.now();

  function getSession() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.exp || now() > s.exp) {
        localStorage.removeItem(KEY);
        return null;
      }
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(s) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function clearSession() {
    localStorage.removeItem(KEY);
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
      location.replace('login.html');   // ✅ index.html → login.html
      return;
    }
    if (roles && !roles.includes(s.role)) {
      alert('권한이 없습니다.');
      location.replace('login.html');   // ✅ index.html → login.html
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
