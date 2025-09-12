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

    if (v === 'partners') renderPartners();
    if (v === 'expenses') renderExpenses();   // ← 추가!

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


// 지출(병원카드) 월간 보드 렌더러  [교체본]
async function renderExpenses() {
  const monthInput = document.getElementById('expMonth');
  const prevBtn    = document.getElementById('expPrev');
  const nextBtn    = document.getElementById('expNext');
  const reloadBtn  = document.getElementById('expReload');
  const totalEl    = document.getElementById('expTotal');
  const form       = document.getElementById('expForm');
  const table      = document.getElementById('expTable');
  const tbody      = table ? table.querySelector('tbody') : null;

  if (!monthInput || !tbody) return;

  // 최초 진입 시 기본 월 = 오늘
  if (!monthInput.value) {
    const d = new Date();
    monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  const escapeHtml = (s='') =>
    String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  // ── 리스트 불러오기 ──
  const load = async () => {
    const m = monthInput.value;
    if (!m) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:18px;">불러오는 중…</td></tr>`;
    try {
      const j = await carmApi(`/expenses?month=${encodeURIComponent(m)}&method=hospital_card`);
      const rows = (j.items || []).map(it => `
        <tr data-id="${it.id}">
          <td>${it.pay_date}</td>
          <td style="text-align:right;">${Number(it.amount||0).toLocaleString()}</td>
          <td>${escapeHtml(it.merchant||'')}</td>
          <td>${escapeHtml(it.purpose||'')}</td>
          <td>
            <button class="btn ghost exp-edit" type="button" data-id="${it.id}">수정</button>
            <button class="btn ghost exp-del"  type="button" data-id="${it.id}">삭제</button>
          </td>
        </tr>
      `).join('');
      tbody.innerHTML = rows || `<tr><td colspan="5" style="text-align:center; padding:18px;">내역 없음</td></tr>`;
      totalEl.textContent = Number(j.total||0).toLocaleString();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#f99; padding:18px;">불러오기 실패</td></tr>`;
      console.warn('expenses load error:', err);
    }
  };

  // ── 이벤트 바인딩 (중복 방지) ──
  if (!monthInput.dataset.bound) {
    monthInput.dataset.bound = '1';
    monthInput.addEventListener('change', load);
  }
  if (prevBtn && !prevBtn.dataset.bound) {
    prevBtn.dataset.bound = '1';
    prevBtn.addEventListener('click', ()=>{
      const d = new Date(monthInput.value+'-01');
      d.setMonth(d.getMonth()-1);
      monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      load();
    });
  }
  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound = '1';
    nextBtn.addEventListener('click', ()=>{
      const d = new Date(monthInput.value+'-01');
      d.setMonth(d.getMonth()+1);
      monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      load();
    });
  }
  if (reloadBtn && !reloadBtn.dataset.bound) {
    reloadBtn.dataset.bound = '1';
    reloadBtn.addEventListener('click', load);
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        payDate:  fd.get('payDate'),
        amount:   Number(fd.get('amount')||0),
        merchant: String(fd.get('merchant')||'').trim(),
        purpose:  String(fd.get('purpose')||'').trim(),
        method:   'hospital_card'
      };
      if (!payload.payDate || !payload.amount || !payload.merchant || !payload.purpose) return;

      try {
        await carmApi('/expenses', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        form.reset();
        load();
      } catch (err) {
        alert('등록 실패: ' + (err?.message || err));
      }
    });
  }

  if (table && !table.dataset.bound) {
    table.dataset.bound = '1';
    table.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button'); if (!btn) return;
      const id = btn.dataset.id; if (!id) return;

      if (btn.classList.contains('exp-del')) {
        if (!confirm('삭제할까요?')) return;
        try {
          await carmApi('/expenses', {
            method: 'DELETE',
            body: JSON.stringify({ id })
          });
          load();
        } catch (err) {
          alert('삭제 실패: ' + (err?.message || err));
        }
        return;
      }

      if (btn.classList.contains('exp-edit')) {
        const tr = btn.closest('tr');
        const cur = {
          amount:   tr.children[1].textContent.replace(/[^0-9]/g,''),
          merchant: tr.children[2].textContent.trim(),
          purpose:  tr.children[3].textContent.trim()
        };
        const newAmount   = prompt('금액(원):', cur.amount);   if (newAmount===null) return;
        const newMerchant = prompt('상호명:',   cur.merchant); if (newMerchant===null) return;
        const newPurpose  = prompt('용도:',     cur.purpose);  if (newPurpose===null) return;

        try {
          await carmApi('/expenses', {
            method: 'PATCH',
            body: JSON.stringify({
              id,
              amount:   Number(newAmount||0),
              merchant: newMerchant,
              purpose:  newPurpose
            })
          });
          load();
        } catch (err) {
          alert('수정 실패: ' + (err?.message || err));
        }
      }
    });
  }

  // ── 최초 로드 ──
  load();
}