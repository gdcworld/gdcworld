// assets/app.js (GDC World Admin)
// 역할별 계정 관리 + 파트너 병원 + 카테고리

(function(){
  /* ============ 공통 유틸 ============ */
  function qs(s, el=document){ return el.querySelector(s); }
  function qsa(s, el=document){ return Array.from(el.querySelectorAll(s)); }

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

  /* ============ 네비 전환 ============ */
  function activate(viewId){
    qsa('.nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.view===viewId));
    qsa('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel!==viewId));
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
      qsa('.nav button').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const v=btn.dataset.view;
          activate(v);
          if(v==='partners') renderPartners();
          // accounts-xxx 패널이면 부트 실행
          const panel=qs(`[data-panel="${v}"]`);
          if(panel && panel.querySelector('.account-module')){
            window.__bootAccountsModules(panel);
          }
        });
      });
      // 첫 화면은 파트너
      activate('partners'); renderPartners();
    }
  };
})();
