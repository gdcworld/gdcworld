// assets/auth.js
// 로그인/세션/권한 가드 (모든 역할 로그인 후 admin.html로 이동)

(() => {
  const LS_KEY = 'gdc.session';
  const LEGACY_KEY = 'gdc_user'; // 레거시 지원

  // 레거시 -> 신규 세션 마이그레이션
  (function migrateLegacy(){
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) return; // 이미 신규 세션 있음
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return;
      const j = JSON.parse(legacy);
      if (j?.email && j?.role) {
        const session = { user: { email: j.email, role: j.role }, ts: Date.now(), ttlHours: 8 };
        localStorage.setItem(LS_KEY, JSON.stringify(session));
      }
    } catch {}
  })();

  function saveSession(user){
    const session = { user, ts: Date.now(), ttlHours: 8 };
    localStorage.setItem(LS_KEY, JSON.stringify(session));
  }
  function loadSession(){
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  function isExpired(sess){
    if (!sess?.ts || !sess?.ttlHours) return false;
    const ageMs = Date.now() - Number(sess.ts);
    return ageMs > sess.ttlHours * 3600 * 1000;
  }

  async function apiLogin(email, password){
    // /api 우선, 실패 시 Functions 경로로 폴백
    const body = JSON.stringify({ email, password });
    let r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body });
    if (!r.ok) r = await fetch('/.netlify/functions/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body });
    const j = await r.json().catch(()=>({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.message || '로그인 실패');
    return j.user; // { id, email, role }
  }

  const Auth = {
    async login(email, password){
      if (!email || !password) throw new Error('이메일/비밀번호를 입력하세요.');
      const user = await apiLogin(String(email).toLowerCase(), password);
      saveSession(user);
      // ★ 모든 역할을 admin.html로 보냄 (역할별 메뉴는 app.js가 제어)
      location.replace('admin.html');
    },

    logout(){
      localStorage.removeItem(LS_KEY);
      location.replace('login.html');
    },

    requireRole(allowed){
      const sess = loadSession();
      if (!sess || isExpired(sess)) {
        localStorage.removeItem(LS_KEY);
        location.replace('login.html');
        return;
      }
      const role = sess.user?.role || '';
      if (Array.isArray(allowed) && allowed.length && !allowed.includes(role)) {
        // 허용되지 않은 역할이면 로그인 페이지로
        location.replace('login.html');
      }
    },

    currentRole(){
      const s = loadSession();
      return s?.user?.role || null;
    },

    currentUserEmail(){
      const s = loadSession();
      return s?.user?.email || null;
    }
  };

  window.Auth = Auth;
})();
