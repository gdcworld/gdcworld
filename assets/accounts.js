// assets/accounts.js

(function(){
  const qs  = (s, el=document) => el.querySelector(s);
  const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

  // 서버 API 호출 (폴백 포함)
  async function apiFetch(path, opts={}){
    const base = '/api';
    const url  = path.startsWith('/') ? base+path : base+'/'+path;
    let res = await fetch(url, { headers:{'Content-Type':'application/json'}, ...opts });
    if (!res.ok) throw new Error('API 실패: '+res.status);
    return await res.json();
  }

  // --- roles loader (server: /api/roles) ---
  let __rolesCache = null;
  async function loadRoles() {
    if (__rolesCache) return __rolesCache;
    try {
      const r = await fetch('/api/roles');
      const j = await r.json();
      __rolesCache = Array.isArray(j.items) ? j.items : [];
    } catch {
      __rolesCache = [];
    }
    return __rolesCache;
  }

  // 계정 목록 로딩
  async function loadAccounts(panel){
    const box = panel.querySelector('.accountsBox');
    try{
      const j = await apiFetch('/accounts');
      const items = j.items || [];
      const rows = items.map(acc => `
        <tr>
          <td>${acc.email}</td>
          <td>${acc.role}</td>
          <td>${acc.name||''}</td>
          <td>
            <button data-act="edit" data-id="${acc.id}">수정</button>
            <button data-act="del" data-id="${acc.id}">삭제</button>
          </td>
        </tr>
      `).join('');
      box.innerHTML = `
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Name</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }catch(e){
      box.innerHTML = `<div class="err">불러오기 실패</div>`;
      console.error(e);
    }
  }

  // 모달 열기(생성)
  async function openModalForCreate(state){
    const tpl = qs('#accountModalTpl');
    const frag = tpl.content.cloneNode(true);
    const modal = frag.querySelector('.modal');
    document.body.appendChild(frag);

    const form = modal.querySelector('form');

    // ✅ 역할 목록 동기화
    const roles = await loadRoles();
    if (form.role && roles.length) {
      form.role.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join('');
    }
    if (form.role) form.role.value = state.role;

    form.addEventListener('submit', async e=>{
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      try{
        const res = await apiFetch('/accounts',{method:'POST', body:JSON.stringify(body)});
        if(res.ok){
          modal.remove();
          loadAccounts(state.panel);
        }else{
          alert(res.message||'생성 실패');
        }
      }catch(err){ console.error(err); alert('생성 실패'); }
    });

    modal.querySelector('[data-close]').addEventListener('click',()=>modal.remove());
  }

  // 모달 열기(수정)
  async function openModalForEdit(state,id){
    const tpl = qs('#accountModalTpl');
    const frag = tpl.content.cloneNode(true);
    const modal = frag.querySelector('.modal');
    document.body.appendChild(frag);

    const form = modal.querySelector('form');

    // 현재 계정 데이터 불러오기
    const j = await apiFetch('/accounts');
    const item = (j.items||[]).find(x=>x.id===id);

    // ✅ 역할 목록 동기화
    const roles = await loadRoles();
    if (form.role && roles.length) {
      form.role.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join('');
    }
    if (form.role) form.role.value = item.role || state.role;

    // 기존 값 채우기
    form.email.value = item.email;
    if(form.name) form.name.value = item.name||'';

    form.addEventListener('submit', async e=>{
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      body.id = id;
      try{
        const res = await apiFetch('/accounts',{method:'PATCH', body:JSON.stringify(body)});
        if(res.ok){
          modal.remove();
          loadAccounts(state.panel);
        }else{
          alert(res.message||'수정 실패');
        }
      }catch(err){ console.error(err); alert('수정 실패'); }
    });

    modal.querySelector('[data-close]').addEventListener('click',()=>modal.remove());
  }

  // 이벤트 바인딩
  function bindEvents(panel){
    const box = panel.querySelector('.accountsBox');
    box.addEventListener('click', e=>{
      const btn = e.target.closest('button[data-act]');
      if(!btn) return;
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      if(act==='edit') openModalForEdit({panel}, id);
      if(act==='del'){
        if(!confirm('삭제할까요?')) return;
        apiFetch('/accounts',{method:'DELETE',body:JSON.stringify({id})})
          .then(()=>loadAccounts(panel))
          .catch(err=>console.error(err));
      }
    });

    const addBtn = panel.querySelector('[data-act="add"]');
    if(addBtn){
      addBtn.addEventListener('click',()=>openModalForCreate({panel,role:'staff'}));
    }
  }

  // 초기화
  window.__bootAccountsModules = function(panel){
    loadAccounts(panel);
    bindEvents(panel);
  };

})();
