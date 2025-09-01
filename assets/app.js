// assets/app.js (role-based visibility, robust role detection)
// 디자인/마크업 변경 없음

(function(){
  /* ---------- utils ---------- */
  const qs  = (s, r=document)=>r.querySelector(s);
  const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));

  /* ---------- role detection (강화) ---------- */
  function readRoleFromStorage(){
    try {
      const s = localStorage.getItem('gdc.session');
      if (s) { const j = JSON.parse(s); if (j?.user?.role) return String(j.user.role); }
    } catch {}
    try {
      const s2 = localStorage.getItem('gdc_user'); // 레거시
      if (s2) { const j2 = JSON.parse(s2); if (j2?.role) return String(j2.role); }
    } catch {}
    return null;
  }
  function currentRole(){
    // 1) auth.js가 제공하면 우선 사용
    if (window.Auth?.currentRole) {
      try { const r = window.Auth.currentRole(); if (r) return String(r); } catch {}
    }
    // 2) 스토리지 폴백
    return readRoleFromStorage() || 'member';
  }

  /* ---------- 허용 목록 ---------- */
  // admin: 빈 배열 = 모두 허용
  const ROLE_ALLOWED_VIEWS = {
    nurse:     ['consumables-main', 'drugs-main'],   // 간호사
    physio:    ['noncovered-dosu', 'revisit'],       // 물리치료사
    frontdesk: ['closing'],                           // 원무
    admin:     []                                     // 관리자 (모두 허용)
  };

  function isAllowedView(viewId){
    const role = currentRole();
    const allow = ROLE_ALLOWED_VIEWS[role] || [];
    return (allow.length === 0) || allow.includes(viewId);
  }
  function firstAllowedViewInDOM(){
    // 현재 DOM에서 display != none 인 첫 메뉴
    const btn =
      document.querySelector('.subitem[data-view]:not([style*="display: none"])') ||
      document.querySelector('.nav > button[data-view]:not([style*="display: none"])');
    return btn?.getAttribute('data-view') || null;
  }

  /* ---------- 가드 포함 패널 전환 ---------- */
  function showPanelGuarded(id){
    if (!isAllowedView(id)) {
      const fb = firstAllowedViewInDOM();
      if (fb) id = fb;
    }
    // 실제 전환(기존 showPanel과 동일 동작)
    qsa('[data-panel]').forEach(p=>{
      p.classList.toggle('hidden', p.getAttribute('data-panel') !== id);
    });

    // 제목 업데이트 (admin.html에 있는 titleMap 사용)
    try {
      const h = document.getElementById('pageTitle');
      if (h && window.titleMap) h.textContent = window.titleMap[id] || h.textContent;
    } catch {}

    // 서브메뉴 active
    qsa('.subitem').forEach(b=>{
      b.classList.toggle('active', b.dataset.view === id);
    });

    // 계정 모듈 있으면 부팅
    if (window.__bootAccountsModules) {
      const panelEl = document.querySelector(`[data-panel="${id}"]`);
      window.__bootAccountsModules(panelEl);
    }

    // 파트너 패널이면 렌더
    if (id === 'partners') renderPartners();
  }

  // 전역에서 기존 코드가 showPanel을 부를 수 있으니 덮어쓰기
  window.showPanel = showPanelGuarded;

  /* ---------- 역할별 메뉴 숨김 + 첫 진입 ---------- */
  function applyRoleVisibilityAndDefault(){
    const role = currentRole();
    const allow = ROLE_ALLOWED_VIEWS[role] || [];
    const allowAll = (allow.length === 0);
    const allowSet = new Set(allow);

    // 서브메뉴 숨김
    document.querySelectorAll('.subitem[data-view]').forEach(btn=>{
      const id = btn.getAttribute('data-view');
      btn.style.display = (allowAll || allowSet.has(id)) ? '' : 'none';
    });

    // 자식 전부 숨기면 그룹 숨김
    document.querySelectorAll('.nav-group').forEach(group=>{
      const anyVisible = Array.from(group.querySelectorAll('.subitem[data-view]'))
        .some(b => b.style.display !== 'none');
      group.style.display = anyVisible ? '' : 'none';
    });

    // 상위 단일 버튼 숨김
    document.querySelectorAll('.nav > button[data-view]').forEach(btn=>{
      const id = btn.getAttribute('data-view');
      btn.style.display = (allowAll || allowSet.has(id)) ? '' : 'none';
    });

    // 패널 안전 가리기
    document.querySelectorAll('[data-panel]').forEach(p=>{
      const id = p.getAttribute('data-panel');
      if (!(allowAll || allowSet.has(id))) p.classList.add('hidden');
    });

    // 첫 허용 패널 자동 진입
    const first = firstAllowedViewInDOM();
    if (first) showPanelGuarded(first);
  }

  /* ---------- 파트너 병원(기존 기능) ---------- */
  async function renderPartners(){
    const box = qs('#partnersBox'); if(!box) return;
    try{
      const res = await fetch('assets/data/hospitals.json?v='+Date.now());
      const data = await res.json();
      const sel = qs('#hospitalSelect');
      sel.innerHTML = data.hospitals.map(h=>`<option value="${h.id}">${h.name}</option>`).join('');
      sel.addEventListener('change',()=>fillHospital(sel.value,data));
      fillHospital(sel.value||data.hospitals[0]?.id,data);
    }catch(e){
      box.innerHTML=`<div class="panel">불러오기 실패</div>`;
    }
  }
  function fillHospital(id,data){
    const h=data.hospitals.find(x=>x.id===id); if(!h) return;
    qs('#hospitalMeta').textContent=`계약일:${h.contract_since} 상태:${h.status}`;
    qs('#hospitalTable tbody').innerHTML=h.monthly.map(m=>`
      <tr><td>${m.month}</td><td>${m.revenue}</td><td>${m.claims}</td><td>${m.notes||''}</td></tr>
    `).join('');
  }

  /* ---------- 초기화 ---------- */
  window.AdminUI = {
    init(){
      // 역할별 표시/숨김 적용 + 첫 패널 자동
      applyRoleVisibilityAndDefault();

      // 네비 클릭 가드
      qsa('.nav button').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const id = btn.dataset.view;
          if (id) showPanelGuarded(id);
        });
      });
    }
  };

  // 혹시 AdminUI.init 보다 먼저 로드되어도 DOM 준비되면 한 번 보정
  document.addEventListener('DOMContentLoaded', ()=>{
    try {
      if (window.AdminUI?.init) {
        // admin.html 쪽에서 이미 init을 부르면 중복 실행되어도 안전
      } else {
        applyRoleVisibilityAndDefault();
      }
    } catch {}
  });
})();
