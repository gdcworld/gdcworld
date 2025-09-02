// assets/accounts.js
(() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const nowIso = () => new Date().toISOString();
  const humanDate = (iso) => {
    try { const d = new Date(iso);
      const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
      return `${y}.${m}.${da}`;
    } catch { return "-"; }
  };
  const escapeHtml = (s="") => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = (msg) => { const el=$("#toast"); if(!el) return; el.textContent=msg; el.classList.remove("hidden"); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hidden"),1600); };

  // ---- API helper: /api 우선 호출, 실패 시 /.netlify/functions 로 재시도
  async function apiFetch(path, opts = {}) {
    const token = (window.Auth?.currentToken && Auth.currentToken()) || null;
    const baseHeaders = {
      'Content-Type': 'application/json',
      ...(opts.headers||{}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) // ★ 토큰 첨부
    };
    const req = { ...opts, headers: baseHeaders };

    let r = await fetch(`/api${path}`, req);
    if (!r.ok) r = await fetch(`/.netlify/functions/api${path}`, req);

    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || j?.ok === false) {
      const msg = j?.message || j?.error || `request_failed (${path})`;
      throw new Error(msg);
    }
    return j;
  }

  // ---- 서버 API (계정)
  const API = {
    async list() {
      const j = await apiFetch('/accounts', { method: 'GET' });
      return j.items || j;
    },
    async create(p) {
      const payload = {
        name: (p.name||'').trim(),
        email: String(p.email||'').trim().toLowerCase(),
        password: String(p.password||''),
        role: String(p.role||'').trim().toLowerCase(),
        phone: p.phone || '',
        status: p.status || 'active',
        hospital: p.hospital || '',
        workStatus: p.workStatus || '',
        adminType: p.adminType || '',
        ward: p.ward || '',
        license: p.license || '',
        branch: p.branch || '',
        area: p.area || '',
        position: p.position || ''
      };
      if (!payload.name || payload.name.length < 2) throw new Error('이름 최소 2자');
      if (!payload.password || payload.password.length < 8) throw new Error('비밀번호 최소 8자');
      if (!payload.email || !payload.role) throw new Error('이메일/역할 필수');
      const j = await apiFetch('/accounts', { method:'POST', body: JSON.stringify(payload) });
      return j.item || j;
    },
    async update(id, p) {
      const j = await apiFetch('/accounts', { method:'PATCH', body: JSON.stringify({ id, ...p }) });
      return j.item || j;
    },
    async remove(id) {
      await apiFetch('/accounts', { method:'DELETE', body: JSON.stringify({ id }) });
      return true;
    }
  };

  // ---- 역할별 컬럼/필드
  const roleColumns = {
    physio:    [{ key:"hospital",   label:"병원" }, { key:"workStatus", label:"근무여부" }],
    ptadmin:   [{ key:"hospital",   label:"병원" }, { key:"adminType",  label:"관리 구분" }],
    nurse:     [{ key:"ward",       label:"소속 병동" }, { key:"license", label:"면허번호" }],
    frontdesk: [{ key:"branch",     label:"근무지점" }, { key:"area",     label:"담당 구역" }],
    radiology: [{ key:"license",    label:"자격번호" }, { key:"workStatus", label:"근무여부" }],
    vice:      [{ key:"hospital",   label:"병원" }, { key:"position",   label:"직위" }],
  };
  const roleTitle = (role)=>({physio:"물리치료사",ptadmin:"PT관리자",nurse:"간호사",frontdesk:"원무",radiology:"방사선사",vice:"부원장"}[role]||role);

  // ---- [수정] 역할 목록 로더(서버 /api/roles, 토큰 포함)
  let __rolesCache = null;
  async function loadRoles() {
    if (__rolesCache) return __rolesCache;
    try {
      const j = await apiFetch('/roles', { method:'GET' });
      __rolesCache = Array.isArray(j.items) ? j.items : [];
    } catch {
      __rolesCache = [];
    }
    return __rolesCache;
  }

  // ---- 이하 UI 로직(디자인 변경 없음)
  function renderModule(container){
    const role = container.dataset.role;
    container.innerHTML = `
      <div class="card" style="padding:16px; border-radius:16px; background:var(--card);">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center;">
          <h3 class="h1" style="margin:0">${roleTitle(role)}</h3>
          <div style="display:flex; gap:8px; align-items:center;">
            <input class="acc-search" type="search" placeholder="Search"
                   style="padding:10px 12px; border-radius:10px; border:1px solid #444; background:#1f2025; color:#fff; min-width:220px">
            <button class="btn primary acc-create">계정 생성</button>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:12px; overflow:auto;">
          <table class="acc-table" style="width:100%; border-collapse:collapse;">
            <thead></thead><tbody id="accounts-tbody"></tbody>
          </table>
        </div>
        <div class="row" style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
          <div class="acc-count" style="font-size:12px; opacity:.8"></div>
          <div class="acc-pager" style="display:flex; gap:8px; align-items:center;">
            <button class="btn ghost acc-prev">이전</button>
            <span class="acc-page" style="min-width:64px; text-align:center; line-height:36px"></span>
            <button class="btn ghost acc-next">다음</button>
          </div>
        </div>
      </div>
    `;

    const state = { role, list: [], q:"", page:1, perPage:10 };

    const $thead = $("thead", container);
    const $tbody = $("#accounts-tbody", container);
    const $search= $(".acc-search", container);
    const $create= $(".acc-create", container);
    const $count = $(".acc-count", container);
    const $prev  = $(".acc-prev", container);
    const $next  = $(".acc-next", container);
    const $page  = $(".acc-page", container);

    $thead.innerHTML = `
      <tr style="text-align:left; border-bottom:1px solid #555;">
        <th style="padding:10px">번호</th>
        ${ (roleColumns[role]||[]).map(c=>`<th style="padding:10px">${c.label}</th>`).join("") }
        <th style="padding:10px">아이디</th>
        <th style="padding:10px">이름</th>
        <th style="padding:10px">등록일</th>
        <th style="padding:10px; width:140px">작업</th>
      </tr>
    `;

    $search.addEventListener("input", ()=>{ state.q=$search.value.trim().toLowerCase(); state.page=1; draw(); });
    $create.addEventListener("click", ()=> openModalForCreate(state, reload));
    $prev.addEventListener("click", ()=>{ if(state.page>1){state.page--; draw();} });
    $next.addEventListener("click", ()=>{ const {totalPages}=getPaged(state); if(state.page<totalPages){state.page++; draw();} });

    $tbody.addEventListener("click", async (e)=>{
      const btn = e.target.closest("button[data-act]"); if(!btn) return;
      const id  = btn.dataset.id;
      if(btn.dataset.act==="edit"){
        const item = state.list.find(x=>x.id===id);
        if (item) openModalForEdit(state, item, reload);
      }
      if(btn.dataset.act==="del"){
        if(!confirm("정말 삭제할까요?")) return;
        try { await API.remove(id); toast("삭제되었습니다."); await reload(); } catch(err){ toast("삭제 실패: "+err.message); }
      }
    });

    async function reload(){
      const all = await API.list();
      state.list = (Array.isArray(all)?all:all.items||[])
        .filter(a => (a.role||"") === role)
        .sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
      draw();
    }

    function getFiltered(list){
      const q = state.q; if(!q) return list;
      return list.filter(item=>{
        const hay = [
          item.email, item.name,
          item.hospital, item.workStatus, item.adminType,
          item.ward, item.license, item.branch, item.area, item.position
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    function getPaged(st){
      const filtered = getFiltered(st.list); const total=filtered.length;
      const totalPages = Math.max(1, Math.ceil(total/st.perPage));
      const start=(st.page-1)*st.perPage; const rows=filtered.slice(start,start+st.perPage);
      return { rows, total, totalPages };
    }
    function draw(){
      const { rows, total, totalPages } = getPaged(state);
      $tbody.innerHTML = rows.map((item, idx)=>`
        <tr style="border-bottom:1px solid #333">
          <td style="padding:10px">${(state.page-1)*state.perPage+idx+1}</td>
          ${ (roleColumns[role]||[]).map(c=>`<td style="padding:10px">${escapeHtml(item[c.key]||"-")}</td>`).join("") }
          <td style="padding:10px">${escapeHtml(item.email||"-")}</td>
          <td style="padding:10px">${escapeHtml(item.name||"-")}</td>
          <td style="padding:10px">${humanDate(item.createdAt||item.updatedAt||item.created_at||nowIso())}</td>
          <td style="padding:10px">
            <button class="btn" data-act="edit" data-id="${item.id}">수정</button>
            <button class="btn ghost" data-act="del" data-id="${item.id}">삭제</button>
          </td>
        </tr>
      `).join("");
      $count.textContent = `총 ${total}건`;
      $page.textContent  = `${state.page} / ${totalPages}`;
    }

    reload();
  }

  const collectForm = (form)=>{ const fd=new FormData(form); const o={}; for(const [k,v] of fd.entries()) o[k]=v; return o; };

  // === 생성 모달 (역할 옵션을 /api/roles 기준으로 주입)
  async function openModalForCreate(state, onSaved){
    const modal=$("#account-modal"), form=$("#account-form"), title=$("#account-modal-title"),
          cancel=$("#account-cancel"), extras=$("#extra-fields");
    title.textContent = `[${state.role}] 계정 생성`; form.reset(); form.dataset.role=state.role;

    // [NEW] 역할 옵션 로딩
    const roles = await loadRoles();
    if (form.role && roles.length) {
      form.role.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join('');
    }

    if (form.role) form.role.value = state.role;

    const currentRole = form.role?.value || state.role;
    mountExtraFields(currentRole, extras);

    form.role?.addEventListener('change', () => {
      mountExtraFields(form.role.value, extras);
    });

    const close=()=>modal.classList.add("hidden"); 
    cancel.onclick=close;

    form.onsubmit = async (e)=>{
      e.preventDefault();
      const data = collectForm(form);
      if(!data.name || !data.email){ toast("이름/이메일은 필수입니다."); return; }
      if(!data.password || !data.password2){ toast("비밀번호를 입력해주세요."); return; }
      if(data.password !== data.password2){ toast("비밀번호가 일치하지 않습니다."); return; }

      const roleToUse = (data.role || state.role).trim().toLowerCase();

      try{
        await API.create({
          name: data.name.trim(),
          email: data.email.trim(),
          password: data.password,
          role: roleToUse,
          phone: data.phone || "", status: data.status || "active",
          hospital: data.hospital||"", workStatus:data.workStatus||"",
          adminType:data.adminType||"", ward:data.ward||"", license:data.license||"",
          branch:data.branch||"", area:data.area||"", position:data.position||""
        });
        toast("생성되었습니다.");
        if(form.password) form.password.value="";
        if(form.password2) form.password2.value="";
        close(); onSaved?.();
      } catch(err){ toast("생성 실패: "+err.message); }
    };

    modal.classList.remove("hidden");
  }

  // === 수정 모달 (역할 옵션을 /api/roles 기준으로 주입)
  async function openModalForEdit(state, item, onSaved){
    const modal=$("#account-modal"), form=$("#account-form"), title=$("#account-modal-title"),
          cancel=$("#account-cancel"), extras=$("#extra-fields");
    title.textContent = `[${state.role}] 계정 수정`; form.reset(); form.dataset.role=state.role;

    form.name.value   = item.name   || "";
    form.email.value  = item.email  || "";
    form.phone.value  = item.phone  || "";
    form.status.value = item.status || "active";

    const roles = await loadRoles();
    if (form.role && roles.length) {
      form.role.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join('');
    }
    if (form.role) form.role.value = item.role || state.role;

    const currentRole = form.role?.value || state.role;
    mountExtraFields(currentRole, extras, item);
    form.role?.addEventListener('change', () => {
      mountExtraFields(form.role.value, extras, item);
    });

    const close=()=>modal.classList.add("hidden"); 
    cancel.onclick=close;

    form.onsubmit = async (e)=>{
      e.preventDefault();
      const data = collectForm(form);
      if(!data.name){ toast("이름은 필수입니다."); return; }

      const patch = {
        name: (data.name||"").trim(),
        email: (data.email||"").trim(),
        phone: data.phone ?? "",
        status: data.status ?? "",
        ...(data.role && data.role.trim() ? { role: data.role.trim().toLowerCase() } : {}),
        ...(data.password && data.password.trim() ? (() => {
          if (!data.password2 || data.password !== data.password2){
            toast("비밀번호가 일치하지 않습니다."); 
            throw new Error("password_mismatch");
          }
          return { password: data.password };
        })() : {}),
        hospital:  data.hospital  ?? "",
        workStatus:data.workStatus?? "",
        adminType: data.adminType ?? "",
        ward:      data.ward      ?? "",
        license:   data.license   ?? "",
        branch:    data.branch    ?? "",
        area:      data.area      ?? "",
        position:  data.position  ?? ""
      };

      try{
        await API.update(item.id, patch);
        toast("수정되었습니다.");
        if(form.password) form.password.value="";
        if(form.password2) form.password2.value="";
        close(); onSaved?.();
      } catch(err){
        if (err.message !== "password_mismatch") toast("수정 실패: "+err.message);
      }
    };

    modal.classList.remove("hidden");
  }

  function mountExtraFields(role, target, values={}) {
    const defs = {
      physio:    [{name:"hospital",label:"병원",type:"text"},{name:"workStatus",label:"근무여부",type:"text"}],
      ptadmin:   [{name:"hospital",label:"병원",type:"text"},{name:"adminType",label:"관리 구분",type:"text"}],
      nurse:     [{name:"ward",label:"소속 병동",type:"text"},{name:"license",label:"면허번호",type:"text"}],
      frontdesk: [{name:"branch",label:"근무지점",type:"text"},{name:"area",label:"담당 구역",type:"text"}],
      radiology: [{name:"license",label:"자격번호",type:"text"},{name:"workStatus",label:"근무여부",type:"text"}],
      vice:      [{name:"hospital",label:"병원",type:"text"},{name:"position",label:"직위",type:"text"}],
    }[role] || [];
    target.innerHTML = defs.map(f=>{
      const val = values[f.name] ?? "";
      return `<label>${f.label}<input name="${f.name}" type="${f.type}" placeholder="${f.label}" value="${escapeHtml(val)}" /></label>`;
    }).join("");
  }

  function boot(root=document){ $$(".account-module", root).forEach(mod=>{ if(mod._inited) return; mod._inited=true; renderModule(mod); }); }
  window.__bootAccountsModules = boot;
  document.addEventListener("DOMContentLoaded", ()=> boot());
})();
