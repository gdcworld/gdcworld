// assets/accounts.js  (role별 맞춤 컬럼 + CRUD + 모달 동적필드 + 비밀번호 해시)

(() => {
  // ===== 공통 유틸 =====
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const STORAGE_PREFIX = "accounts:";
  const nowIso = () => new Date().toISOString();
  const humanDate = (iso) => {
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}.${m}.${day}`;
    } catch { return "-"; }
  };
  const toast = (msg) => {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 1600);
  };
  const escapeHtml = (s = "") =>
    s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

  const keyFor = (role) => `${STORAGE_PREFIX}${role}`;
  const loadList = (role) => {
    try { return JSON.parse(localStorage.getItem(keyFor(role)) || "[]"); }
    catch { return []; }
  };
  const saveList = (role, list) => {
    localStorage.setItem(keyFor(role), JSON.stringify(list));
  };
  const newUid = () => "uid_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  // ===== 비밀번호 해시 유틸 =====
  function genSalt(len = 16) {
    try {
      const arr = new Uint8Array(len);
      crypto.getRandomValues(arr);
      return btoa(String.fromCharCode(...arr));
    } catch {
      // 최소한의 폴백
      return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }
  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + password);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ===== 역할별 컬럼 정의 =====
  // 화면 순서: [번호] + (roleColumns) + 아이디 + 이름 + 등록일 + 작업
  const roleColumns = {
    physio: [
      { key: "hospital",   label: "병원" },
      { key: "workStatus", label: "근무여부" },
    ],
    ptadmin: [
      { key: "hospital", label: "병원" },
      { key: "adminType", label: "관리 구분" },
    ],
    nurse: [
      { key: "ward",    label: "소속 병동" },
      { key: "license", label: "면허번호" },
    ],
    frontdesk: [
      { key: "branch", label: "근무지점" },
      { key: "area",   label: "담당 구역" },
    ],
    radiology: [
      { key: "license",   label: "자격번호" },
      { key: "workStatus", label: "근무여부" },
    ],
    vice: [
      { key: "hospital", label: "병원" },
      { key: "position", label: "직위" },
    ],
  };

  // 모달에 표시할 역할별 추가 입력 필드 정의
  // 기본 입력: loginId, name, email, phone, status 는 공통
  const roleExtraFields = {
    physio: [
      { name: "hospital",   label: "병원",      type: "text",  placeholder: "구로디지털정형외과" },
      { name: "workStatus", label: "근무여부",  type: "text",  placeholder: "근무/휴무" },
    ],
    ptadmin: [
      { name: "hospital", label: "병원",     type: "text",  placeholder: "…" },
      { name: "adminType", label: "관리 구분", type: "text",  placeholder: "총괄/파트" },
    ],
    nurse: [
      { name: "ward",    label: "소속 병동", type: "text",  placeholder: "2병동" },
      { name: "license", label: "면허번호",   type: "text",  placeholder: "RN-XXXX" },
    ],
    frontdesk: [
      { name: "branch", label: "근무지점", type: "text",  placeholder: "강남점" },
      { name: "area",   label: "담당 구역", type: "text",  placeholder: "접수/수납" },
    ],
    radiology: [
      { name: "license",   label: "자격번호", type: "text",  placeholder: "RT-XXXX" },
      { name: "workStatus", label: "근무여부", type: "text",  placeholder: "근무/휴무" },
    ],
    vice: [
      { name: "hospital", label: "병원",  type: "text",  placeholder: "…" },
      { name: "position", label: "직위",  type: "text",  placeholder: "부원장" },
    ],
  };

  // ===== 렌더링 =====
  function renderModule(container) {
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
            <thead></thead>
            <tbody></tbody>
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
        <p class="muted" style="margin-top:10px; font-size:12px; opacity:.7;">저장 위치: 로컬스토리지 (<code>${keyFor(role)}</code>)</p>
      </div>
    `;

    // 상태
    const state = {
      role,
      list: migrateSchema(loadList(role)), // 기존 데이터도 스키마 보정
      q: "",
      page: 1,
      perPage: 10,
    };

    // 노드
    const $thead = $("thead", container);
    const $tbody = $("tbody", container);
    const $search = $(".acc-search", container);
    const $create = $(".acc-create", container);
    const $count = $(".acc-count", container);
    const $prev = $(".acc-prev", container);
    const $next = $(".acc-next", container);
    const $page = $(".acc-page", container);

    // 헤더
    $thead.innerHTML = `
      <tr style="text-align:left; border-bottom:1px solid #555;">
        <th style="padding:10px">번호</th>
        ${ (roleColumns[role] || []).map(c => `<th style="padding:10px">${c.label}</th>`).join("") }
        <th style="padding:10px">아이디</th>
        <th style="padding:10px">이름</th>
        <th style="padding:10px">등록일</th>
        <th style="padding:10px; width:140px">작업</th>
      </tr>
    `;

    // 이벤트
    $search.addEventListener("input", () => {
      state.q = $search.value.trim().toLowerCase();
      state.page = 1;
      draw();
    });
    $create.addEventListener("click", () => openModalForCreate(state, draw));
    $prev.addEventListener("click", () => { if (state.page > 1) { state.page--; draw(); } });
    $next.addEventListener("click", () => {
      const { totalPages } = getPaged(state);
      if (state.page < totalPages) { state.page++; draw(); }
    });
    $tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const uid = btn.dataset.uid;
      if (act === "edit") {
        const item = state.list.find(x => x.uid === uid);
        if (item) openModalForEdit(state, item, draw);
      }
      if (act === "del") {
        const ok = confirm("정말 삭제할까요?");
        if (!ok) return;
        state.list = state.list.filter(x => x.uid !== uid);
        saveList(state.role, state.list);
        toast("삭제되었습니다.");
        const { totalPages } = getPaged(state);
        if (state.page > totalPages) state.page = Math.max(1, totalPages);
        draw();
      }
    });

    // 초기 그리기
    draw();

    // 내부 함수들
    function getFiltered(list) {
      const q = state.q;
      if (!q) return list;
      return list.filter(item => {
        const hay = [
          item.loginId, item.name, item.email, item.phone,
          item.hospital, item.workStatus, item.adminType,
          item.ward, item.license, item.branch, item.area, item.position
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    function getPaged(st) {
      const filtered = getFiltered(st.list);
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / st.perPage));
      const start = (st.page - 1) * st.perPage;
      const rows = filtered.slice(start, start + st.perPage);
      return { rows, total, totalPages };
    }
    function draw() {
      const { rows, total, totalPages } = getPaged(state);
      $tbody.innerHTML = rows.map((item, idx) => `
        <tr style="border-bottom:1px solid #333">
          <td style="padding:10px">${(state.page - 1) * state.perPage + idx + 1}</td>
          ${ (roleColumns[role] || []).map(c => `<td style="padding:10px">${escapeHtml(item[c.key] || "-")}</td>`).join("") }
          <td style="padding:10px">${escapeHtml(item.loginId || "-")}</td>
          <td style="padding:10px">${escapeHtml(item.name || "-")}</td>
          <td style="padding:10px">${humanDate(item.createdAt)}</td>
          <td style="padding:10px">
            <button class="btn" data-act="edit" data-uid="${item.uid}">수정</button>
            <button class="btn ghost" data-act="del" data-uid="${item.uid}">삭제</button>
          </td>
        </tr>
      `).join("");
      $count.textContent = `총 ${total}건`;
      $page.textContent = `${state.page} / ${totalPages}`;
    }
  }

  // ===== 모달: 생성/수정 =====
  function mountExtraFields(role, target, values = {}) {
    target.innerHTML = (roleExtraFields[role] || []).map(f => {
      const val = values[f.name] ?? "";
      return `
        <label>${f.label}
          <input name="${f.name}" type="${f.type}" placeholder="${f.placeholder || f.label}" value="${escapeHtml(val)}" />
        </label>
      `;
    }).join("");
  }

  function openModalForCreate(state, onSaved) {
    const modal  = $("#account-modal");
    const form   = $("#account-form");
    const title  = $("#account-modal-title");
    const cancel = $("#account-cancel");
    const extras = $("#extra-fields");

    title.textContent = `[${state.role}] 계정 생성`;
    form.reset();
    form.dataset.role = state.role;
    form.querySelector('input[name="uid"]')?.remove(); // 안전

    // 역할별 추가필드
    mountExtraFields(state.role, extras);

    const close = () => modal.classList.add("hidden");
    cancel.onclick = close;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = collectForm(form);
      if (!data.loginId || !data.name) {
        toast("로그인ID/이름은 필수입니다."); return;
      }
      // 생성 시: 비밀번호/확인 필수
      if (!data.password || !data.password2) {
        toast("비밀번호를 입력해주세요."); return;
      }
      if (data.password !== data.password2) {
        toast("비밀번호가 일치하지 않습니다."); return;
      }

      const list = state.list;
      if (list.some(x => x.loginId === data.loginId)) {
        toast("이미 존재하는 로그인ID입니다."); return;
      }

      // 비밀번호 해시/솔트
      const salt = genSalt();
      const passwordHash = await hashPassword(data.password, salt);

      const item = {
        uid: newUid(),
        role: state.role,
        loginId: data.loginId.trim(),
        name: data.name.trim(),
        email: (data.email || "").trim(),
        phone: (data.phone || "").trim(),
        status: data.status || "active",
        // role extras:
        hospital:  data.hospital || "",
        workStatus:data.workStatus || "",
        adminType: data.adminType || "",
        ward:      data.ward || "",
        license:   data.license || "",
        branch:    data.branch || "",
        area:      data.area || "",
        position:  data.position || "",
        // password
        salt,
        passwordHash,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      list.unshift(item);
      saveList(state.role, list);
      toast("생성되었습니다.");
      // 민감 입력칸 비우기
      if (form.password) form.password.value = "";
      if (form.password2) form.password2.value = "";
      close();
      onSaved?.();
    };

    modal.classList.remove("hidden");
  }

  function openModalForEdit(state, item, onSaved) {
    const modal  = $("#account-modal");
    const form   = $("#account-form");
    const title  = $("#account-modal-title");
    const cancel = $("#account-cancel");
    const extras = $("#extra-fields");

    title.textContent = `[${state.role}] 계정 수정`;
    form.reset();
    form.dataset.role = state.role;

    // 기본값 주입
    form.loginId.value = item.loginId || "";
    form.name.value    = item.name    || "";
    form.email.value   = item.email   || "";
    form.phone.value   = item.phone   || "";
    form.status.value  = item.status  || "active";

    // 역할별 추가필드
    mountExtraFields(state.role, extras, item);

    const close = () => modal.classList.add("hidden");
    cancel.onclick = close;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = collectForm(form);
      if (!data.loginId || !data.name) {
        toast("로그인ID/이름은 필수입니다."); return;
      }
      // 로그인ID 중복 체크 (본인 제외)
      if (state.list.some(x => x.loginId === data.loginId && x.uid !== item.uid)) {
        toast("이미 존재하는 로그인ID입니다."); return;
      }

      // 비밀번호 변경 의사 확인
      let salt = item.salt || "";
      let passwordHash = item.passwordHash || "";
      const wantsPwChange = (data.password && data.password.trim()) || (data.password2 && data.password2.trim());
      if (wantsPwChange) {
        if (!data.password || !data.password2) {
          toast("비밀번호와 확인을 모두 입력해주세요."); return;
        }
        if (data.password !== data.password2) {
          toast("비밀번호가 일치하지 않습니다."); return;
        }
        salt = genSalt();
        passwordHash = await hashPassword(data.password, salt);
      }

      const next = state.list.map(x => x.uid === item.uid ? ({
        ...x,
        loginId: data.loginId.trim(),
        name:    data.name.trim(),
        email:   (data.email || "").trim(),
        phone:   (data.phone || "").trim(),
        status:  data.status || "active",
        hospital:  data.hospital || "",
        workStatus:data.workStatus || "",
        adminType: data.adminType || "",
        ward:      data.ward || "",
        license:   data.license || "",
        branch:    data.branch || "",
        area:      data.area || "",
        position:  data.position || "",
        salt,
        passwordHash,
        updatedAt: nowIso(),
      }) : x);

      state.list = next;
      saveList(state.role, state.list);
      toast("수정되었습니다.");
      // 민감 입력칸 비우기
      if (form.password) form.password.value = "";
      if (form.password2) form.password2.value = "";
      close();
      onSaved?.();
    };

    modal.classList.remove("hidden");
  }

  function collectForm(form) {
    const fd = new FormData(form);
    const out = {};
    for (const [k, v] of fd.entries()) out[k] = v;
    return out;
  }

  // ===== 부팅 훅 =====
  function bootAccountsModules(root = document) {
    $$(".account-module", root).forEach(mod => {
      if (mod._inited) return;
      mod._inited = true;
      renderModule(mod);
    });
  }
  window.__bootAccountsModules = bootAccountsModules;

  // 첫 로드 시 한번 시도(열려있는 패널에 있을 수 있음)
  document.addEventListener("DOMContentLoaded", () => bootAccountsModules());

  // 제목용
  function roleTitle(role) {
    return ({
      physio: "물리치료사",
      ptadmin: "PT관리자",
      nurse: "간호사",
      frontdesk: "원무",
      radiology: "방사선사",
      vice: "부원장",
    }[role] || role);
  }

  // 스키마 마이그레이션(예전 데이터 보정)
  function migrateSchema(list) {
    return list.map(x => ({
      uid: x.uid || x.id || newUid(), // 과거 id → uid 승격
      role: x.role || "",
      loginId: x.loginId || x.email || x.name || "",
      name: x.name || "",
      email: x.email || "",
      phone: x.phone || "",
      status: x.status || "active",
      hospital: x.hospital || "",
      workStatus: x.workStatus || "",
      adminType: x.adminType || "",
      ward: x.ward || "",
      license: x.license || "",
      branch: x.branch || "",
      area: x.area || "",
      position: x.position || "",
      // 비밀번호 필드 (없으면 기본값)
      salt: x.salt || "",
      passwordHash: x.passwordHash || "",
      createdAt: x.createdAt || nowIso(),
      updatedAt: x.updatedAt || x.createdAt || nowIso(),
    }));
  }
})();
