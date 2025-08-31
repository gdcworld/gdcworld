// assets/accounts.js (원본 디자인 유지 + role 드롭다운 추가)
(() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const escapeHtml = (s="") => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const humanDate = (iso) => {
    try { const d=new Date(iso);
      return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
    } catch { return "-"; }
  };

  // ---- API helper
  async function apiFetch(path, opts = {}) {
    const baseHeaders = { "Content-Type": "application/json", ...(opts.headers||{}) };
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

  const API = {
    async list() {
      const j = await apiFetch("/accounts", { method:"GET" });
      return j.items || j;
    },
    async create(p) {
      const payload = {
        name: (p.name||"").trim(),
        email: String(p.email||"").trim().toLowerCase(),
        password: String(p.password||""),
        role: String(p.role||"").trim(),
      };
      if (!payload.email || !payload.role) throw new Error("이메일/역할 필수");
      if (!payload.password || payload.password.length < 8) throw new Error("비밀번호 최소 8자");
      const j = await apiFetch("/accounts", { method:"POST", body: JSON.stringify(payload) });
      return j.item || j;
    },
    async update(id, p) {
      const j = await apiFetch("/accounts", { method:"PATCH", body: JSON.stringify({ id, ...p }) });
      return j.item || j;
    },
    async remove(id) {
      await apiFetch("/accounts", { method:"DELETE", body: JSON.stringify({ id }) });
      return true;
    }
  };

  // ---- boot
  function renderModule(container){
    container.innerHTML = `
      <div class="account-header">
        <button class="btn primary acc-create">계정 생성</button>
      </div>
      <table class="account-table">
        <thead>
          <tr><th>아이디</th><th>이름</th><th>역할</th><th>생성일</th><th>작업</th></tr>
        </thead>
        <tbody id="accounts-tbody"></tbody>
      </table>
      <div class="acc-count"></div>

      <div id="account-modal" class="hidden modal">
        <form id="account-form" class="modal-content">
          <h3 id="account-modal-title">계정</h3>
          <label>이름 <input name="name" required></label>
          <label>이메일 <input name="email" type="email" required></label>
          <label>역할
            <select name="role" required>
              <option value="admin">관리자</option>
              <option value="nurse">간호사</option>
              <option value="staff">스태프</option>
              <option value="frontdesk">원무</option>
              <option value="physio">물리치료사</option>
              <option value="ptadmin">PT관리자</option>
              <option value="radiology">방사선사</option>
              <option value="vice">부원장</option>
            </select>
          </label>
          <label>비밀번호 <input name="password" type="password"></label>
          <label>비밀번호 확인 <input name="password2" type="password"></label>
          <div class="actions">
            <button type="submit" class="btn primary">저장</button>
            <button type="button" id="account-cancel" class="btn ghost">취소</button>
          </div>
        </form>
      </div>
    `;

    const state = { list: [] };
    const $tbody=$("#accounts-tbody",container), $count=$(".acc-count",container);
    const $create=$(".acc-create",container), $modal=$("#account-modal",container);
    const $form=$("#account-form",container), $title=$("#account-modal-title",container);
    const $cancel=$("#account-cancel",container);

    async function reload(){
      state.list=await API.list();
      state.list=state.list.sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
      draw();
    }
    function draw(){
      $tbody.innerHTML=state.list.map(item=>`
        <tr>
          <td>${escapeHtml(item.email||"-")}</td>
          <td>${escapeHtml(item.name||"-")}</td>
          <td>${escapeHtml(item.role||"-")}</td>
          <td>${humanDate(item.created_at)}</td>
          <td>
            <button data-act="edit" data-id="${item.id}">수정</button>
            <button data-act="del" data-id="${item.id}">삭제</button>
          </td>
        </tr>
      `).join("");
      $count.textContent=`총 ${state.list.length}건`;
    }

    function openModal(mode,item){
      $form.reset(); $form.dataset.mode=mode; $form.dataset.id=item?.id||"";
      $title.textContent=mode==="create"?"계정 생성":"계정 수정";
      if(mode==="edit"&&item){
        $form.name.value=item.name||""; $form.email.value=item.email||"";
        $form.role.value=item.role||"";
      }
      $modal.classList.remove("hidden");
    }
    function closeModal(){ $modal.classList.add("hidden"); }

    $create.addEventListener("click",()=>openModal("create"));
    $cancel.addEventListener("click",closeModal);

    $tbody.addEventListener("click",async e=>{
      const btn=e.target.closest("button[data-act]"); if(!btn) return;
      const id=btn.dataset.id, item=state.list.find(x=>x.id===id);
      if(btn.dataset.act==="edit") openModal("edit",item);
      if(btn.dataset.act==="del"){
        if(!confirm("정말 삭제할까요?")) return;
        try{ await API.remove(id); reload(); }catch(err){ alert("삭제 실패:"+err.message); }
      }
    });

    $form.onsubmit=async e=>{
      e.preventDefault();
      const data=Object.fromEntries(new FormData($form).entries());
      if(data.password && data.password!==data.password2){ alert("비밀번호가 일치하지 않습니다."); return; }
      try{
        if($form.dataset.mode==="create"){
          await API.create(data);
        }else{
          const patch={ name:data.name, email:data.email, role:data.role };
          if(data.password) patch.password=data.password;
          await API.update($form.dataset.id,patch);
        }
        closeModal(); reload();
      }catch(err){ alert(err.message); }
    };

    reload();
  }

  function boot(root=document){ $$(".account-module",root).forEach(mod=>{ if(!mod._inited){ mod._inited=true; renderModule(mod);} }); }
  window.__bootAccountsModules=boot;
  document.addEventListener("DOMContentLoaded",()=>boot());
})();
