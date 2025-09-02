// assets/app.js (Cleaned: 네비/파트너 병원만, 계정 CRUD/부트 중복 제거)

(function () {
  /* ============ 공통 유틸 ============ */
  const qs  = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  /* ============ 네비 전환 ============ */
  function activate(viewId) {
    qsa('.nav button').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.view === viewId)
    );
    qsa('[data-panel]').forEach(p =>
      p.classList.toggle('hidden', p.dataset.panel !== viewId)
    );
  }

  /* ============ 파트너 병원 ============ */
  async function renderPartners() {
    const box = qs('#partnersBox');
    if (!box) return;
    try {
      // 실제 파일 경로로 정렬 (기존: assets/data/hospitals.json)
      const res = await fetch('assets/data/hospitals.json?v=' + Date.now());
      const data = await res.json();
      const sel = qs('#hospitalSelect');
      sel.innerHTML = (data.hospitals || [])
        .map(h => `<option value="${h.id}">${h.name}</option>`)
        .join('');
      sel.addEventListener('change', () => fillHospital(sel.value, data));
      const first = sel.value || data.hospitals?.[0]?.id;
      fillHospital(first, data);
    } catch (e) {
      box.innerHTML = `<div class="panel">불러오기 실패</div>`;
      console.error(e);
    }
  }

  function fillHospital(id, data) {
    const h = (data.hospitals || []).find(x => x.id === id);
    if (!h) return;
    qs('#hospitalMeta').textContent = `계약일:${h.contract_since} 상태:${h.status}`;
    qs('#hospitalTable tbody').innerHTML = (h.monthly || [])
      .map(m => `
        <tr>
          <td>${m.month}</td>
          <td>${m.revenue}</td>
          <td>${m.claims}</td>
          <td>${m.notes || ''}</td>
        </tr>
      `)
      .join('');
  }

  /* ============ Admin 초기화 ============ */
  window.AdminUI = {
    init() {
      // 네비 버튼 클릭 -> 패널 전환
      qsa('.nav button').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = btn.dataset.view;
          activate(v);

          // 파트너 병원 패널이면 데이터 렌더
          if (v === 'partners') renderPartners();

          // 계정관리 패널이면 accounts.js의 부트 함수만 호출 (정의는 accounts.js가 소유)
          const panel = qs(`[data-panel="${v}"]`);
          if (panel && panel.querySelector('.account-module')) {
            if (window.__bootAccountsModules) {
              window.__bootAccountsModules(panel);
            } else {
              console.warn('__bootAccountsModules가 로드되지 않았습니다.');
            }
          }
        });
      });

      // 초기 화면: 파트너
      activate('partners');
      renderPartners();
    }
  };
})();
