// assets/accounts.js
(() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const nowIso = () => new Date().toISOString();
  const humanDate = (iso) => {
    try { const d = new Date(iso);
      return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    } catch { return "-"; }
  };
  const escapeHtml = (s="") => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = (msg) => { const el=$("#toast"); if(!el) return; el.textContent=msg; el.classList.remove("hidden"); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hidden"),1600); };

  // ---- API helper
  async function apiFetch(path, opts = {}) {
    const baseHeaders = { 'Content-Type': 'application/json', ...(opts.headers||{}) };
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
        role: String(p.role||'').trim(),
      };
      if (!payload.name) throw new Error('이름 필수');
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

  const roleOptions = [
    {value:'admin', label:'관리자'},
    {value:'staff', label:'스태프'},
    {value:'member', label:'멤버'},
    {value:'physio', label:'물리치료사'},
    {value:'ptadmin', label:'PT관리자'},
    {value:'nurse', label:'간호사'},
    {value:'frontdesk', label:'원무'},
    {value:'radiology', label:'방사선사'},
    {value:'vice', label:'부원장'},
  ];

  function roleSelectHtml(selected) {
    return `
      <label>역할
        <select name="role" required>
          ${roleOptions.map(o=>`<option value="${o.value}" ${o.value===selected?'selected':''}>${o.label}</option>`).join('')}
        </select>
      </label>
    `;
  }

  // ---- 섹션 렌더
  function renderModule(container){
    container.innerHTML = `
      <div class="card" style="padding:16px; border-radius:16px; background:var(--card);">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center;">
          <h3 class="h1" style="margin:0">계정관리</h3>
          <button class="btn primary acc-create">계정 생성</button>
        </div>
        <div class="table-wrap" style="margin-top:12px; overflow:auto;">
          <table class="acc-table" style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid #555;">
                <th style="padding:10px">아이디</th>
                <th style="padding:10px">이름</th>
                <th style="padding:10px">역할</th>
                <th style="padding:10px">생성일</th>
                <th style="padding:10px">작업</th>
              </tr>
            </thead>
            <tbody id="accounts-tbody"></tbody>
          </table>
        </div>
        <div class="acc-count" style="font-size:12px; opacity:.8; margin-top:10px"></div>
      </div>

      <!-- 모달 -->
      <div id="account-modal" class="hidden modal">
        <form id="account-form" class="modal-content">
          <h3 id="account-modal-title">계정</h3>
          <label>이름 <input name="name" required></label>
          <label>이메일 <input name="email" type="email" required></label>
          ${roleSelectHtml()}
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
    const $tbody = $("#accounts-tbody", container);
    const $count = $(".acc-count", container);
    const $create= $(".acc-create", container);
    const $modal = $("#account-modal", container);
    const $form  = $("#account-form", container);
    const $title = $("#account-modal-title", container);
    const $cancel= $("#account-cancel", container);

    async function reload() {
      const all = await API.list();
      state.list = all.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
      draw();
    }

    function draw() {
      $tbody.innerHTML = state.list.map(item=>`
        <tr>
          <td style="padding:10px">${escapeHtml(item.email||'-')}</td>
          <td style="padding:10px">${escapeHtml(item.name||'-')}</td>
          <td style="padding:10px">${escapeHtml(item.role||'-')}</td>
          <td style="padding:10px">${humanDate(item.created_at)}</td>
          <td style="padding:10px">
            <button class="btn" data-act="edit" data-id="${item.id}">수정</button>
            <button class="btn ghost" data-act="del" data-id="${item.id}">삭제</button>
          </td>
        </tr>
      `).join("");
      $count.textContent = `총 ${state.list.length}건`;
    }

    function openModal(mode, item) {
      $form.reset();
      $form.dataset.mode = mode;
      $form.dataset.id = item?.id || '';
      $title.textContent = mode === 'create' ? '계정 생성' : '계정 수정';

      // role select 값 세팅
      const roleEl = $form.querySelector('select[name=role]');
      if (item?.role) roleEl.value = item.role;

      if (mode==='edit' && item) {
        $form.name.value  = item.name||'';
        $form.email.value = item.email||'';
      }
      $modal.classList.remove("hidden");
    }
    function closeModal() { $modal.classList.add("hidden"); }

    $create.addEventListener('click', ()=> openModal('create'));
    $cancel.addEventListener('click', closeModal);

    $tbody.addEventListener("click", async (e)=>{
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id;
      const item = state.list.find(x=>x.id===id);
      if (btn.dataset.act==="edit") openModal('edit', item);
      if (btn.dataset.act==="del") {
        if(!confirm("정말 삭제할까요?")) return;
        try { await API.remove(id); toast("삭제됨"); reload(); } catch(err){ toast("삭제 실패: "+err.message); }
      }
    });

    $form.onsubmit = async (e)=>{
      e.preventDefault();
      const data = Object.fromEntries(new FormData($form).entries());
      if (data.password && data.password !== data.password2) {
        toast("비밀번호가 일치하지 않습니다."); return;
      }
      try {
        if ($form.dataset.mode==='create') {
          await API.create(data);
          toast("생성됨");
        } else {
          const patch = { name:data.name, email:data.email, role:data.role };
          if (data.password) patch.password=data.password;
          await API.update($form.dataset.id, patch);
          toast("수정됨");
        }
        closeModal(); reload();
      } catch(err) { toast(err.message); }
    };

    reload();
  }

  function boot(root=document){ $$(".account-module", root).forEach(mod=>{ if(!mod._inited){ mod._inited=true; renderModule(mod); } }); }
  window.__bootAccountsModules = boot;
  document.addEventListener("DOMContentLoaded", ()=> boot());
})();
