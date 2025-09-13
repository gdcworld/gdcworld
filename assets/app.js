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

let __navBound = false; // ← 파일 상단 IIFE 내부에 선언

window.AdminUI = {
  init() {
    if (!__navBound) {
      qsa('.nav button').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = btn.dataset.view;
          activate(v);

         if (v === 'partners') renderPartners();
if (v === 'expenses') renderExpenses();
if (v === 'noncovered-dosu') {
  renderDosu();
  window.bootDosuAddUI && window.bootDosuAddUI();
}

          const panel = qs(`[data-panel="${v}"]`);
          if (panel && panel.querySelector('.account-module')) {
            if (window.__bootAccountsModules) {
              window.__bootAccountsModules(panel);
            } else {
              console.warn('__bootAccountsModules가 로드되지 않았습니다.');
            }
          }
        }, { passive:true });
      });
      __navBound = true; // ← 중복 방지
    }

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

// 작은 디바운스 유틸
const debounce = (fn, ms=120) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

// DOM 행 생성 (프래그먼트용)
const buildRow = (it) => {
  const tr = document.createElement('tr');
  tr.setAttribute('data-id', it.id);

  const tdDate = document.createElement('td');
  tdDate.textContent = it.pay_date || '';

  const tdAmt = document.createElement('td');
  tdAmt.style.textAlign = 'right';
  tdAmt.textContent = Number(it.amount||0).toLocaleString();

  const tdMerchant = document.createElement('td');
  tdMerchant.textContent = escapeHtml(it.merchant||'');

  const tdPurpose = document.createElement('td');
  tdPurpose.textContent = escapeHtml(it.purpose||'');

  const tdOps = document.createElement('td');
  const btnEdit = document.createElement('button');
  btnEdit.className = 'btn ghost exp-edit';
  btnEdit.type = 'button';
  btnEdit.dataset.id = it.id;
  btnEdit.textContent = '수정';
  const btnDel = document.createElement('button');
  btnDel.className = 'btn ghost exp-del';
  btnDel.type = 'button';
  btnDel.dataset.id = it.id;
  btnDel.textContent = '삭제';
  tdOps.append(btnEdit, btnDel);

  tr.append(tdDate, tdAmt, tdMerchant, tdPurpose, tdOps);
  return tr;
};

 // ── 목록 불러오기 ──
const load = async () => {
  const m = monthInput.value;
  if (!m) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:18px;">불러오는 중…</td></tr>`;
  try {
    const j = await apiRequest(`/expenses?month=${encodeURIComponent(m)}&method=hospital_card`);
    lastItems = j.items || [];

    if (lastItems.length) {
      const frag = document.createDocumentFragment();
      for (const it of lastItems) frag.appendChild(buildRow(it));
      tbody.replaceChildren(frag);
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:18px;">내역 없음</td></tr>`;
    }
    totalEl.textContent = Number(j.total||0).toLocaleString();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#f99; padding:18px;">불러오기 실패</td></tr>`;
    console.warn('expenses load error:', err);
  }
};

// ▼ 월 이동/새로고침
const shiftMonth = (delta) => {
  const base = monthInput.value || new Date().toISOString().slice(0,7);
  const d = new Date(base + '-01');
  d.setMonth(d.getMonth()+delta);
  monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  load();
};
const loadDebounced = debounce(load, 120);

prevBtn?.addEventListener('click', ()=> shiftMonth(-1), { passive:true });
nextBtn?.addEventListener('click', ()=> shiftMonth(1),  { passive:true });
reloadBtn?.addEventListener('click', loadDebounced);
monthInput.addEventListener('change', loadDebounced);

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
exportBtn?.addEventListener('click', () => {
  if (!lastItems.length) { alert('내보낼 내역이 없습니다. 먼저 불러오기를 눌러주세요.'); return; }
  setTimeout(() => {
    const m = monthInput.value || 'unknown-month';
    const esc = (s='') => `"${String(s).replaceAll('"','""').replace(/\r?\n/g,' ')}"`;
    const header = ['날짜','금액(원)','상호명','용도','결제수단','비고'];
    const lines = [header.join(',')];

    for (const r of lastItems) {
      lines.push([
        r.pay_date || '',
        Number(r.amount || 0),
        esc(r.merchant || ''),
        esc(r.purpose  || ''),
        esc(r.method   || ''),
        esc(r.note     || '')
      ].join(','));
    }
    const total = lastItems.reduce((s,r)=> s + (Number(r.amount||0)||0), 0);
    lines.push(['합계', total, '', '', '', ''].join(','));

    const csv = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-${m}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, 0);
});

// 최초 로드
load();
} 

// 도수 치료 패널 렌더러
window.renderDosu = async function renderDosu(){
  const startEl = document.getElementById('dosuRangeStart');
  const endEl   = document.getElementById('dosuRangeEnd');
  const docSel  = document.getElementById('dosuDoctor');
  const tbThera = document.querySelector('#dosuByTherapist tbody');
  const tbNew   = document.querySelector('#dosuNewDist tbody');
  const tbRe    = document.querySelector('#dosuRevisit tbody');
  const tbDaily = document.querySelector('#dosuDaily tbody');

  const kpiCur = document.getElementById('dosuKpiCur');
  const kpiPrev= document.getElementById('dosuKpiPrev');
  const kpiRe  = document.getElementById('dosuKpiRevisit');
  const kpiRev = document.getElementById('dosuKpiRevenue');

  const sumVisit = document.getElementById('dosuSumVisit');
  const sumNew   = document.getElementById('dosuSumNew');
  const sumRe    = document.getElementById('dosuSumRe');
  const sumRate  = document.getElementById('dosuSumRate');
  const sumRev   = document.getElementById('dosuSumRevenue');

  const today = new Date().toISOString().slice(0,10);
  if (!startEl.value) startEl.value = today;
  if (!endEl.value)   endEl.value   = today;

  const num = (v)=> Number(v||0);
  const fmt = (n)=> num(n).toLocaleString();
  const clear = el => el && (el.innerHTML='');

  // 치료사 목록(필요시 API 교체)
  try{
    const j = await apiRequest('/accounts?role=physio');
    docSel.innerHTML = ['<option value="">치료사 전체</option>']
      .concat((j.items||[]).map(u=>`<option value="${u.id}">${u.name||'치료사'}</option>`)).join('');
  }catch{}

  const qs = ()=> new URLSearchParams({
    start:startEl.value, end:endEl.value, physioId: docSel.value||''
  }).toString();

  async function load(){
    // ⚠️ 백엔드 준비되면 엔드포인트만 맞춰주면 됩니다.
    const a = await apiRequest(`/dosu/summary?${qs()}`); // {kpi, therapists, newDist, revisit}
    const b = await apiRequest(`/dosu/daily?${qs()}`);   // {items}

    // KPI
    kpiCur.textContent   = (a.kpi?.current||0) + '명';
    kpiPrev.textContent  = (a.kpi?.previous||0) + '명';
    kpiRe.textContent    = (a.kpi?.revisitRate||0) + '%';
    kpiRev.textContent   = fmt(a.kpi?.revenue||0);
    
   // ▶ 기간 텍스트
{
  const start = document.getElementById('dosuRangeStart').value;
  const end   = document.getElementById('dosuRangeEnd').value;
  const el = document.getElementById('dosuPeriodText');
  if (el) el.textContent = `${start} ~ ${end}`;
}

// ▶ 우측 요약 테이블 (기간 내 / 한달전 / 전월 / 대비)
{
  const N = x => Number(x||0);
  const put = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

  // 기간 내
  put('dsumCurNew',      `${N(a.kpi?.new)||0}명`);
  put('dsumCurRe',       `${N(a.kpi?.revisit)||0}명`);
  put('dsumCurTotal',    `${N(a.kpi?.current)||0}명`);
  put('dsumCurRate',     `${N(a.kpi?.revisitRate)||0}%`);
  put('dsumCurRevenue',  `${N(a.kpi?.revenue)||0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')+'원');

  // 한달전 동일기간 (a.prev 가 없으면 0으로 표기)
  put('dsumPrevNew',     `${N(a.prev?.new)||0}명`);
  put('dsumPrevRe',      `${N(a.prev?.revisit)||0}명`);
  put('dsumPrevTotal',   `${N(a.prev?.current)||0}명`);
  put('dsumPrevRate',    `${N(a.prev?.revisitRate)||0}%`);
  put('dsumPrevRevenue', `${N(a.prev?.revenue)||0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')+'원');

  // 전월 총 현황 (a.prevMonth 가 없으면 0)
  put('dsumPrevMonthNew',     `${N(a.prevMonth?.new)||0}명`);
  put('dsumPrevMonthRe',      `${N(a.prevMonth?.revisit)||0}명`);
  put('dsumPrevMonthTotal',   `${N(a.prevMonth?.current)||0}명`);
  put('dsumPrevMonthRate',    `${N(a.prevMonth?.revisitRate)||0}%`);
  put('dsumPrevMonthRevenue', `${N(a.prevMonth?.revenue)||0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')+'원');

  // 한달전 기간내 대비 (단순 차이)
  const dNew  = N(a.kpi?.new)        - N(a.prev?.new);
  const dRe   = N(a.kpi?.revisit)    - N(a.prev?.revisit);
  const dTot  = N(a.kpi?.current)    - N(a.prev?.current);
  const dRate = N(a.kpi?.revisitRate)- N(a.prev?.revisitRate);
  const dRev  = N(a.kpi?.revenue)    - N(a.prev?.revenue);

  const arrow = v => (v>0?'▲':'') + v;
  put('dsumDeltaNew',     `${arrow(dNew)}명`);
  put('dsumDeltaRe',      `${arrow(dRe)}명`);
  put('dsumDeltaTotal',   `${arrow(dTot)}명`);
  put('dsumDeltaRate',    `${arrow(dRate)}%`);
  put('dsumDeltaRevenue', `${arrow(dRev)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')+'원');
}

    // 치료사별
    clear(tbThera);
    let sVisit=0, sNew=0, sRevTot=0, sRevenue=0;
    const f1 = document.createDocumentFragment();
    (a.therapists||[]).forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.name||''}</td>
        <td style="text-align:right">${fmt(r.visits)}</td>
        <td style="text-align:right">${fmt(r.new)}</td>
        <td style="text-align:right">${fmt(r.revisit)}</td>
        <td style="text-align:right">${(r.rate||0)}%</td>f
        <td style="text-align:right">${fmt(r.revenue)}</td>`;
      f1.appendChild(tr);
      sVisit+=num(r.visits); sNew+=num(r.new); sRevTot+=num(r.revisit); sRevenue+=num(r.revenue);
    });
    tbThera.appendChild(f1);
    sumVisit.textContent = fmt(sVisit);
    sumNew.textContent   = fmt(sNew);
    sumRe.textContent    = fmt(sRevTot);
    sumRate.textContent  = (sVisit? Math.round(sRevTot*1000/sVisit)/10 : 0) + '%';
    sumRev.textContent   = fmt(sRevenue);

    // 신환 분배
    clear(tbNew);
    const f2 = document.createDocumentFragment();
    (a.newDist||[]).forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.name||''}</td>
        <td style="text-align:right">${fmt(r.p10)}</td>
        <td style="text-align:right">${fmt(r.p15)}</td>
        <td style="text-align:right">${fmt(r.p25)}</td>
        <td style="text-align:right">${fmt(num(r.p10)+num(r.p15)+num(r.p25))}</td>`;
      f2.appendChild(tr);
    });
    tbNew.appendChild(f2);

    // 총 재진
    clear(tbRe);
    const f3 = document.createDocumentFragment();
    (a.revisit||[]).forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.name||''}</td>
        <td style="text-align:right">${fmt(r.p10)}</td>
        <td style="text-align:right">${fmt(r.p15)}</td>
        <td style="text-align:right">${fmt(r.p25)}</td>
        <td style="text-align:right">${fmt(num(r.p10)+num(r.p15)+num(r.p25))}</td>`;
      f3.appendChild(tr);
    });
    tbRe.appendChild(f3);

    // 일자별
    clear(tbDaily);
    const f4 = document.createDocumentFragment();
    (b.items||[]).forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.date||''}</td>
        <td style="text-align:right">${fmt(r.visits)}</td>
        <td style="text-align:right">${fmt(r.new)}</td>
        <td style="text-align:right">${fmt(r.revisit)}</td>
        <td style="text-align:right">${(r.rate||0)}%</td>
        <td style="text-align:right">${fmt(r.revenue)}</td>`;
      f4.appendChild(tr);
    });
    tbDaily.appendChild(f4);
  }

 document.getElementById('dosuReload')?.addEventListener('click', load);
document.getElementById('dosuSearch')?.addEventListener('click', load); // ▶ 검색 버튼
startEl.addEventListener('change', load);
endEl.addEventListener('change', load);
document.getElementById('dosuDoctor')?.addEventListener('change', load);


// ✅ 도수 치료 정보 추가: 모달 부트 함수
window.bootDosuAddUI = function bootDosuAddUI () {
  const openBtn = document.getElementById('dosuAdd');
  const modal   = document.getElementById('dosuModal');
  const form    = document.getElementById('dosuForm');
  if (!openBtn || !modal || !form) return;

  // 오늘 날짜 기본값
  const dateInput = form.querySelector('input[name="writtenAt"]');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0,10);

  // 치료사 목록 불러오기 (physio 계정만)
  const physioSel = document.getElementById('dosuPhysioSelect');
  (async () => {
    try {
      const j = await apiRequest('/accounts?role=physio'); // admin 권한 필요
      const items = j.items || [];
      physioSel.innerHTML = ['<option value="">치료사를 선택해주세요</option>']
        .concat(items.map(u => `<option value="${u.id}">${u.name || u.email || '치료사'}</option>`))
        .join('');
    } catch (e) { console.warn('physio load failed', e); }
  })();

  const show = () => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false'); };
  const hide = () => { modal.classList.add('hidden');    modal.setAttribute('aria-hidden','true'); };

  openBtn.onclick = show;
  modal.addEventListener('click', (e) => { if (e.target.dataset.close) hide(); });

  // 저장
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      writtenAt : fd.get('writtenAt') || new Date().toISOString().slice(0,10),
      hospital  : (fd.get('hospital') || '').trim(),
      physioId  : fd.get('physioId') || '',
      patient   : (fd.get('patient') || '').trim(),
      room      : fd.get('room') || '',
      incentive : fd.get('incentive') || '',
      visitType : fd.get('visitType') || '',
      amount    : Number(fd.get('amount') || 0) || 0,
      treat     : {
        only : !!fd.get('treat_only'),
        inj  : !!fd.get('treat_inj'),
        eswt : !!fd.get('treat_eswt')
      },
      reservation: fd.get('reservation') || 'none'
    };

    if (!payload.physioId) { alert('치료사를 선택해주세요.'); return; }
    if (!payload.patient)  { alert('환자명을 입력해주세요.'); return; }

    try {
      await apiRequest('/dosu/records', { method:'POST', body: payload });
      alert('저장되었습니다.');
      hide();
      if (window.renderDosu) window.renderDosu();
    } catch (err) {
      console.error(err);
      alert('저장 실패: ' + (err?.message || err));
    }
  };
};



  document.getElementById('dosuExport')?.addEventListener('click', () => {
  const header = ['일자','내원수','신환','재진','재진율','수익(원)'].join(',');
  const rows = [...document.querySelectorAll('#dosuDaily tbody tr')].map(tr =>
    [...tr.children].map(td => td.textContent.trim()).join(',')
  );
  const csv  = '\uFEFF' + [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dosu-daily.csv';
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
});

  document.getElementById('dosuPrint')?.addEventListener('click', ()=>{
    const p = document.querySelector('[data-panel="noncovered-dosu"]');
    const win = window.open('', '_blank');
    win.document.write('<meta charset="utf-8"><title>도수 치료 현황</title>');
    win.document.write('<style>body{font-family:sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}h2{margin:0 0 8px}</style>');
    win.document.write('<h2>도수 치료 현황</h2>');
    win.document.write(p.querySelector('.kpi-wrap').outerHTML);
    win.document.write(p.querySelector('#dosuByTherapist').outerHTML);
    win.document.write(p.querySelector('#dosuNewDist').outerHTML);
    win.document.write(p.querySelector('#dosuRevisit').outerHTML);
    win.document.write(p.querySelector('#dosuDaily').outerHTML);
    win.document.close(); win.focus(); win.print(); win.close();
  });

  // 최초 로드
  load();
};
