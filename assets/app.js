// assets/app.js (GDC World Admin)
// 역할별 계정 관리 + 파트너 병원 + 카테고리
// ✅ 변경사항 요약:
// 1) ROLE_ALLOWED_VIEWS: 역할별 허용 패널 정의 (nurse/physio/frontdesk/admin)
// 2) applyRoleVisibilityAndDefault(): 허용되지 않은 메뉴 숨기고, 첫 허용 패널 자동 진입
// 3) activate(): 허용되지 않은 패널로 이동 시 첫 허용 패널로 보정(가드)
// ※ HTML/CSS는 변경 없음

(function(){
  /* ============ 공통 유틸 ============ */
  function qs(s, el=document){ return el.querySelector(s); }
  function qsa(s, el=document){ return Array.from(el.querySelectorAll(s)); }

  /* ============ 역할별 허용 패널 정의 ============ */
  // admin: 빈 배열 = 모두 허용
  const ROLE_ALLOWED_VIEWS = {
    nurse:     ['consumables-main', 'drugs-main'],   // 간호사 → 소모품, 의약품
    physio:    ['noncovered-dosu', 'revisit'],       // 물리치료사 → 비급여치료(도수), 재진율
    frontdesk: ['closing'],                           // 원무 → 마감일지
    admin:     []                                     // 관리자 → 전체 허용
  };

  function currentRole(){
    return (window.Auth?.currentRole?.()) || 'member';
  }
  function isAllowedView(viewId){
    const role = currentRole();
    const allow = ROLE_ALLOWED_VIEWS[role] || [];
    return (allow.length === 0) || allow.includes(viewId);
  }
  function firstAllowedView(){
    // 현재 DOM에서 표시 상태가 '숨김이 아닌' 것들 중 첫 번째
    const btn =
      document.querySelector('.subitem[data-view]:not([style*="display: none"])') ||
      document.querySelector('.nav > button[data-view]:not([style*="display: none"])');
    return btn?.getAttribute('data-view') || null;
  }

  // 허용되지 않은 메뉴/패널을 숨기고, 첫 허용 패널을 자동으로 오픈
  function applyRoleVisibilityAndDefault(){
    const role = currentRole();
    const allow = ROLE_ALLOWED_VIEWS[role] || [];
    const allowAll = (allow.length === 0);
    const allowSet = new Set(allow);

    // 서브메뉴 숨김
    document.querySelectorAll('.subitem[data-view]').forEach(btn => {
      const id = btn.getAttribute('data-view');
      const ok = allowAll || allowSet.has(id);
      btn.style.display = ok ? '' : 'none';
    });

    // 하위가 모두 숨김이면 nav-group 자체 숨김
    document.querySelectorAll('.nav-group').forEach(group => {
      const anyVisible = Array.from(group.querySelectorAll('.subitem[data-view]'))
        .some(b => b.style.display !== 'none');
      group.style.display = anyVisible ? '' : 'none';
    });

    // 단일 상위 버튼도 동일 처리
    document.querySelectorAll('.nav > button[data-view]').forEach(btn => {
      const id = btn.getAttribute('data-view');
      const ok = allowAll || allowSet.has(id);
      btn.style.display = ok ? '' : 'none';
    });

    // 패널들 미리 가려놓기(안전)
    document.querySelectorAll('[data-panel]').forEach(p => {
      const id = p.getAttribute('data-panel');
      const ok = allowAll || allowSet.has(id);
      if (!ok) p.classList.add('hidden');
    });

    // 첫 허용 패널 자동 진입
    const first = firstAllowedView();
    if (first) activate(first);
  }

  /* ============ API 어댑터 (REST /accounts) ============ */
  const API_BASE = '/.netlify/functions/api';
  const API = {
    async listAccountsAll() {
      const res = await fetch(`${API_BASE}/accounts`, { method:'GET' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message||'목록 실패');
      return json.items||[];
    },
    async createAccount(payload){
      const res = await fetch(`${API_BASE}/accounts`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok||!json.ok) throw new Error(json.message||'생성 실패');
      return json.item;
    },
    async updateAccount(id, payload){
      const res = await fetch(`${API_BASE}/accounts`, {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id, ...payload })
      });
      const json = await res.json();
      if (!res.ok||!json.ok) throw new Error(json.message||'수정 실패');
      return json.item;
    },
    async deleteAccount(id){
      const res = await fetch(`${API_BASE}/accounts`, {
        method:'DELETE',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id })
      });
      const json = await res.json();
      if (!res.ok||!json.ok) throw new Error(json.message||'삭제 실패');
      return true;
    }
  };

  /* ============ 네비 전환 (역할 가드 포함) ============ */
  function activate(viewId){
    // 허용되지 않은 패널이면 첫 허용 패널로 보정
    if (!isAllowedView(viewId)) {
      const fallback = firstAllowedView();
      if (fallback) viewId = fallback;
    }
    qsa('.nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.view===viewId));
    qsa('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel!==viewId));
    // 계정 모듈 패널이면 부트
    const panel=qs(`[data-panel="${viewId}"]`);
    if(panel && panel.querySelector('.account-module')){
      window.__bootAccountsModules(panel);
    }
    // 파트너 패널이면 렌더
    if (viewId==='partners') renderPartners();
  }

  /* ============ 파트너 병원 (원래 있던 기능) ============ */
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

  /* ============ 계정 모듈 부트 (역할별 탭) ============ */
  window.__bootAccountsModules = function(panelEl){
    if (!panelEl) return;
    const module = panelEl.querySelector('.account-module');
    if (!module) return;
    const role = module.dataset.role;
    if (module.dataset.bound) return;
    module.dataset.bound='1';

    module.innerHTML = `
      <div class="tools">
        <input type="text" class="search" placeholder="검색…">
        <button class="btn create">계정 생성</button>
      </div>
      <table class="table"><thead><tr>
        <th>#</th><th>이메일</th><th>이름</th><th>생성일</th><th>액션</th>
      </tr></thead><tbody><tr><td colspan="5">로딩 중…</td></tr></tbody></table>
      <div class="pager">
        <button class="btn prev">이전</button>
        <span class="count"></span>
        <span class="page"></span>
        <button class="btn next">다음</button>
      </div>
    `;

    const searchEl=module.querySelector('.search');
    const tbody=module.querySelector('tbody');
    const countEl=module.querySelector('.count');
    const pageEl=module.querySelector('.page');
    let state={q:'',page:1,pageSize:10,items:[]};

    async function load(){
      try{
        const all=await API.listAccountsAll();
        state.items=all.filter(r=>r.role===role);
        state.page=1; render();
      }catch(e){ tbody.innerHTML='<tr><td colspan="5">불러오기 실패</td></tr>'; }
    }
    function render(){
      let rows=state.items;
      if (state.q){
        const q=state.q.toLowerCase();
        rows=rows.filter(r=>(r.email||'').toLowerCase().includes(q)||(r.name||'').toLowerCase().includes(q));
      }
      const start=(state.page-1)*state.pageSize;
      const pageRows=rows.slice(start,start+state.pageSize);
      tbody.innerHTML=pageRows.length?pageRows.map((r,i)=>{
        const no=start+i+1;
        const d=r.created_at?new Date(r.created_at).toISOString().slice(0,10):'-';
        return `<tr>
          <td>${no}</td><td>${r.email}</td><td>${r.name||'-'}</td><td>${d}</td>
          <td>
            <button class="btn small edit" data-id="${r.id}">수정</button>
            <button class="btn small del" data-id="${r.id}">삭제</button>
          </td>
        </tr>`;
      }).join(''):`<tr><td colspan="5">데이터 없음</td></tr>`;
      countEl.textContent=`총 ${rows.length}건`;
      const last=Math.max(1,Math.ceil(rows.length/state.pageSize));
      pageEl.textContent=`${state.page}/${last}`;
    }

    // 이벤트
    searchEl.addEventListener('input',e=>{state.q=e.target.value.trim();state.page=1;render();});
    module.querySelector('.prev').addEventListener('click',()=>{if(state.page>1){state.page--;render();}});
    module.querySelector('.next').addEventListener('click',()=>{const last=Math.ceil(state.items.length/state.pageSize);if(state.page<last){state.page++;render();}});
    module.querySelector('.create').addEventListener('click',async()=>{
      const email=prompt('이메일:')?.trim().toLowerCase();
      const name=prompt('이름(2자 이상):')?.trim();
      const pwd=prompt('비밀번호(8자 이상)')||'';
      if(!email||!name||name.length<2||pwd.length<8) return alert('입력값 확인');
      await API.createAccount({email,password:pwd,role,name});await load();
    });
    tbody.addEventListener('click',async e=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.dataset.id;
      if(btn.classList.contains('del')){ if(!confirm('삭제?'))return; await API.deleteAccount(id); await load(); }
      if(btn.classList.contains('edit')){
        const email=prompt('새 이메일')?.trim();
        const name=prompt('새 이름')?.trim();
        const pwd=prompt('새 비번');
        const payload={};
        if(email) payload.email=email;
        if(name) payload.name=name;
        if(pwd) payload.password=pwd;
        if(Object.keys(payload).length){ await API.updateAccount(id,payload); await load(); }
      }
    });
    load();
  };

  /* ============ Admin 초기화 ============ */
  window.AdminUI={
    init(){
      // 역할별 표시/숨김 먼저 적용 + 첫 허용 패널 자동 진입
      applyRoleVisibilityAndDefault();

      // 클릭 시 패널 전환(허용 가드 포함)
      qsa('.nav button').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const v=btn.dataset.view;
          activate(v);
        });
      });
    }
  };
})();
