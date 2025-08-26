// /assets/accounts.js  (Server REST API 연결판)
// - role별 테이블/모달/검색/페이지네이션은 기존 UI 유지
// - 목록: GET /api/accounts → role로 필터링
// - 생성: POST /api/accounts  { name, email, password, role, ...extras(무시됨) }
// - 수정: PATCH /api/accounts/:id  { name?, email?, role?, password? }
// - 삭제: DELETE /api/accounts/:id

(() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const nowIso = () => new Date().toISOString();
  const humanDate = (iso) => { try {
    const d = new Date(iso); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0'); return `${y}.${m}.${da}`;
  } catch { return "-"; } };
  const escapeHtml = (s="") => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = (msg) => { const el=$("#toast"); if(!el) return; el.textContent=msg; el.classList.remove("hidden"); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hidden"),1600); };

  // ===== 서버 API 래퍼 =====
  const API = {
    async list()   { const r = await fetch('/api/accounts'); const j = await r.json(); return j.items || j; },
    async create(p){ const r = await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}); const j=await r.json(); if(!r.ok) throw new Error(j.error||'create_failed'); return j; },
    async get(id)  { const r = await fetch(`/api/accounts/${id}`); const j=await r.json(); if(!r.ok) throw new Error(j.error||'get_failed'); return j; },
    async update(id,p){ const r = await fetch(`/api/accounts/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}); const j=await r.json(); if(!r.ok) throw new Error(j.error||'update_failed'); return j; },
    async remove(id){ const r = await fetch(`/api/accounts/${id}`,{method:'DELETE'}); const j=await r.json(); if(!r.ok) throw new Error(j.error||'delete_failed'); return j; },
  };

  // 역할별 컬럼(디자인 유지)
  const roleColumns = {
    physio:    [{ key:"hospital",   label:"병원" }, { key:"workStatus", label:"근무여부" }],
    ptadmin:   [{ key:"hospital",   label:"병원" }, { key:"adminType",  label:"관리 구분" }],
    nurse:     [{ key:"ward",       label:"소속 병동" }, { key:"license", label:"면허번호" }],
    frontdesk: [{ key:"branch",     label:"근무지점" }, { key:"area",     label:"담당 구역" }],
    radiology: [{ key:"license",    label:"자격번호" }, { key:"workStatus", label:"근무여부" }],
    vice:      [{ key:"hospital",   label:"병원" }, { key:"position",   label:"직위" }],
  };

  // 모달에 붙일 역할별 입력필드(표시는 그대로, 서버는 추가필드 무시해도 OK)
  const roleExtraFields = {
    physio:    [{name:"hospital",label:"병원",type:"text"},{name:"workStatus",label:"근무여부",type:"text"}],
    ptadmin:   [{name:"hospital",label:"병원",type:"text"},{name:"adminType",label:"관리 구분",type:"text"}],
    nurse:     [{name:"ward",label:"소속 병동",type:"text"},{name:"license",label:"면허번호",type:"text"}],
    frontdesk: [{name:"branch",label:"근무지점",type:"text"},{name:"area",label:"담당 구역",type:"text"}],
    radiology: [{name:"license",label:"자격번호",type:"text"},{name:"workStatus",label:"근무여부",type:"text"}],
    vice:      [{name:"hospital",label:"병원",type:"text"},{name:"position",label:"직위",type:"text"}],
  };

  function roleTitle(role){ return ({physio:"물리치료사",ptadmin:"PT관리자",nurse:"간호사",frontdesk:"원무",radiology:"방사선사",vice:"부원장"}[role]||role); }

  // ===== 모듈 렌더링 (한 역할 섹션) =====
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
            <thead></thead><tbody></tbody>
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
    const $tbody = $("tbody", container);
    const $search= $(".acc-search", container);
    const $create= $(".acc-create", container);
    const $count = $(".acc-count", container);
    const $prev  = $(".acc-prev", container);
    const $next  = $(".acc-next", container);
    const $page  = $(".acc-page", container);

    // 헤더(디자인 유지) — 아이디 열은 이메일을 표시
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

    // 이벤트
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

    // 서버 목록 로드
    async function reload(){
      const all = await API.list();
      // 백엔드에서 role이 저장되도록 POST할 때 role을 함께 보냄.
      state.list = (Array.isArray(all)?all:all.items||[]).filter(a => (a.role||"") === role);
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
          <td style="padding:10px">${humanDate(item.createdAt||item.updatedAt||nowIso())}</td>
          <td style="padding:10px">
            <button class="btn" data-act="edit" data-id="${item.id}">수정</button>
            <button class="btn ghost" data-act="del" data-id="${item.id}">삭제</button>
          </td>
        </tr>
      `).join("");
      $count.textContent = `총 ${total}건`;
      $page.textContent  = `${state.page} / ${totalPages}`;
    }

    // 최초 로드
    reload();
  }

  // ===== 모달: 생성/수정 =====
  function mountExtraFields(role, target, values={}){
    target.innerHTML = (roleExtraFields[role]||[]).map(f=>{
      const val = values[f.name] ?? "";
      return `<label>${f.label}<input name="${f.name}" type="${f.type}" placeholder="${f.label}" value="${escapeHtml(val)}" /></label>`;
    }).join("");
  }

  function collectForm(form){ const fd=new FormData(form); const o={}; for(const [k,v] of fd.entries()) o[k]=v; return o; }

  function openModalForCreate(state, onSaved){
    const modal=$("#account-modal"), form=$("#account-form"), title=$("#account-modal-title"), cancel=$("#account-cancel"), extras=$("#extra-fields");
    title.textContent = `[${state.role}] 계정 생성`; form.reset(); form.dataset.role=state.role;
    mountExtraFields(state.role, extras);
    const close=()=>modal.classList.add("hidden"); cancel.onclick=close;

    form.onsubmit = async (e)=>{
      e.preventDefault();
      const data = collectForm(form);
      if(!data.name || !data.email){ toast("이름/이메일은 필수입니다."); return; }
      if(!data.password || !data.password2){ toast("비밀번호를 입력해주세요."); return; }
      if(data.password !== data.password2){ toast("비밀번호가 일치하지 않습니다."); return; }

      // 서버 스키마: name, email, password, role (추가 필드는 현재 버전에서 무시됨)
      try{
        await API.create({
          name: data.name.trim(),
          email: data.email.trim(),
          password: data.password,
          role: state.role,
          // UI는 유지되지만 서버는 아래 필드를 아직 저장하지 않음(확장 예정)
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

  function openModalForEdit(state, item, onSaved){
    const modal=$("#account-modal"), form=$("#account-form"), title=$("#account-modal-title"), cancel=$("#account-cancel"), extras=$("#extra-fields");
    title.textContent = `[${state.role}] 계정 수정`; form.reset(); form.dataset.role=state.role;

    // 기본값 주입 (서버 항목: id, name, email, role, createdAt/updatedAt)
    form.name.value  = item.name || "";
    form.email.value = item.email || "";
    form.phone.value = item.phone || "";
    form.status.value= item.status || "active";
    mountExtraFields(state.role, extras, item);

    const close=()=>modal.classList.add("hidden"); cancel.onclick=close;

    form.onsubmit = async (e)=>{
      e.preventDefault();
      const data = collectForm(form);
      if(!data.name){ toast("이름은 필수입니다."); return; }

      const patch = {
        name: data.name.trim(),
        email: (data.email||"").trim(),
        role:  state.role
      };
      // 비밀번호를 입력했다면 변경
      if (data.password && data.password.trim()){
        if (!data.password2 || data.password !== data.password2){ toast("비밀번호가 일치하지 않습니다."); return; }
        patch.password = data.password;
      }

      try{
        await API.update(item.id, patch);
        toast("수정되었습니다.");
        if(form.password) form.password.value="";
        if(form.password2) form.password2.value="";
        close(); onSaved?.();
      } catch(err){ toast("수정 실패: "+err.message); }
    };

    modal.classList.remove("hidden");
  }

  // ===== 부팅 훅 =====
  function boot(root=document){ $$(".account-module", root).forEach(mod=>{ if(mod._inited) return; mod._inited=true; renderModule(mod); }); }
  window.__bootAccountsModules = boot;
  document.addEventListener("DOMContentLoaded", ()=> boot());
})();
