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
          if (v === 'expenses') renderExpenses();

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


// ---- 공용 API 헬퍼 (모든 엔드포인트용) ----
async function apiRequest(path, opts = {}) {
  const token = window.Auth?.currentToken?.();
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !opts._rawBody) {
    body = JSON.stringify(body);
  }
  const baseOpts = { method: 'GET', ...opts, headers, body };

  // 1차: /api
  const try1 = await fetch(`/api${path}`, baseOpts).catch(() => null);
  if (try1 && try1.ok) return try1.json();

  // 2차: /.netlify/functions/api
  const try2 = await fetch(`/.netlify/functions/api${path}`, baseOpts).catch(() => null);
  if (try2 && try2.ok) return try2.json();

  const j1 = try1 ? await try1.json().catch(()=>null) : null;
  const j2 = try2 ? await try2.json().catch(()=>null) : null;
  const msg = (j1 && j1.message) || (j2 && j2.message) || 'request_failed';
  throw new Error(msg);
}



// 지출(병원카드) 월간 보드 렌더러 [apiRequest 버전]
async function renderExpenses() {
  const monthInput = document.getElementById('expMonth');
  const prevBtn    = document.getElementById('expPrev');
  const nextBtn    = document.getElementById('expNext');
  const reloadBtn  = document.getElementById('expReload');
  const totalEl    = document.getElementById('expTotal');
  const form       = document.getElementById('expForm');
  const table      = document.getElementById('expTable');
  const tbody      = table ? table.querySelector('tbody') : null;
 
 const exportBtn  = document.getElementById('expExport');  
  let   lastItems  = [];

  if (!monthInput || !tbody) return;

  if (!monthInput.value) {
    const d = new Date();
    monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  const escapeHtml = (s='') =>
    String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

 // ── 목록 불러오기 ──
const load = async () => {
  const m = monthInput.value;
  if (!m) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:18px;">불러오는 중…</td></tr>`;
  try {
    const j = await apiRequest(`/expenses?month=${encodeURIComponent(m)}&method=hospital_card`);
    lastItems = j.items || [];
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

// ▼ 월 이동/새로고침
prevBtn?.addEventListener('click', ()=>{
  const d = new Date(monthInput.value+'-01');
  d.setMonth(d.getMonth()-1);
  monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  load();
});
nextBtn?.addEventListener('click', ()=>{
  const d = new Date(monthInput.value+'-01');
  d.setMonth(d.getMonth()+1);
  monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  load();
});
reloadBtn?.addEventListener('click', load);
monthInput.addEventListener('change', load);

// ▼ 추가(POST)
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(form);
  const payload = {
    payDate:  fd.get('payDate'),
    amount:   Number(fd.get('amount')||0),
    merchant: String(fd.get('merchant')||'').trim(),
    purpose:  String(fd.get('purpose')||'').trim(),
    method:   'hospital_card',
  };
  if (!payload.payDate || !payload.amount || !payload.merchant || !payload.purpose) return;
  try {
    await apiRequest('/expenses', { method:'POST', body: payload });
    form.reset();
    load();
  } catch (err) {
    alert('등록 실패: ' + (err?.message || err));
  }
});

// ▼ 수정/삭제
table?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return;
  const id = btn.dataset.id; if (!id) return;

  if (btn.classList.contains('exp-del')) {
    if (!confirm('삭제할까요?')) return;
    try {
      await apiRequest('/expenses', { method:'DELETE', body:{ id } });
      load();
    } catch (err) {
      alert('삭제 실패: ' + (err?.message || err));
    }
    return;
  }

  if (btn.classList.contains('exp-edit')) {
    const tr = btn.closest('tr');
    const cur = {
      date:     tr.children[0].textContent.trim(),
      amount:   tr.children[1].textContent.replace(/[^0-9]/g,''),
      merchant: tr.children[2].textContent.trim(),
      purpose:  tr.children[3].textContent.trim(),
    };
    const date = prompt('날짜(YYYY-MM-DD)', cur.date); if (!date) return;
    const amount = Number(prompt('금액(원)', cur.amount)||0); if (!amount) return;
    const merchant = prompt('상호명', cur.merchant)||''; if (!merchant.trim()) return;
    const purpose  = prompt('용도', cur.purpose)||'';   if (!purpose.trim()) return;
    try {
      await apiRequest('/expenses', { method:'PATCH', body:{ id, payDate:date, amount, merchant, purpose } });
      load();
    } catch (err) {
      alert('수정 실패: ' + (err?.message || err));
    }
  }
});

// ▼ CSV 다운로드 (이 핸들러에는 CSV 로직만!)
exportBtn?.addEventListener('click', ()=>{
  const m = monthInput.value || 'unknown-month';
  const rows = Array.isArray(lastItems) ? lastItems : [];
  if (!rows.length) {
    alert('내보낼 내역이 없습니다. 먼저 불러오기를 눌러주세요.');
    return;
  }
  const esc = (s='') => `"${String(s).replaceAll('"','""').replace(/\r?\n/g,' ')}"`;
  const header = ['날짜','금액(원)','상호명','용도','결제수단','비고'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.pay_date || '',
      Number(r.amount || 0),
      esc(r.merchant || ''),
      esc(r.purpose  || ''),
      esc(r.method   || ''),
      esc(r.note     || ''),
    ].join(','));
  }
  const total = rows.reduce((s, r)=> s + (Number(r.amount||0) || 0), 0);
  lines.push(['합계', total, '', '', '', ''].join(','));

  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `expenses-${m}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// 최초 로드
load();
} 