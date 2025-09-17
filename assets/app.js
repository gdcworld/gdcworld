// assets/app.js (Cleaned: 네비/파트너 병원만, 계정 CRUD/부트 중복 제거)

(function () {

  const qs  = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  function activate(viewId) {
    qsa('.nav button').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.view === viewId)
    );
    qsa('[data-panel]').forEach(p =>
      p.classList.toggle('hidden', p.dataset.panel !== viewId)
    );
  }

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

function syncDosuKpisFromSummary(){
  const txt = (id)=> (document.getElementById(id)?.textContent || '').trim();

  // '0명' → 숫자, '0원' → 숫자
  const toNum = (s) => Number(String(s).replace(/[^\d.-]/g,'') || 0);

  const curTotal   = toNum(txt('dsumCurTotal'));     // 예: "1명"
  const prevTotal  = toNum(txt('dsumPrevTotal'));
  const revisitPct = txt('dsumCurRate') || '0%';     // 예: "0%"
  const revenue    = toNum(txt('dsumCurRevenue'));   // 예: "30,000원"

  const el = (id)=> document.getElementById(id);
  if (el('dosuKpiCur'))      el('dosuKpiCur').textContent      = `${curTotal}명`;
  if (el('dosuKpiPrev'))     el('dosuKpiPrev').textContent     = `${prevTotal}명`;
  if (el('dosuKpiRevisit'))  el('dosuKpiRevisit').textContent  = revisitPct;
  if (el('dosuKpiRevenue'))  el('dosuKpiRevenue').textContent  = revenue.toLocaleString();
}

// ② renderDosu() 맨 끝에 호출


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
window.renderDosu = async function renderDosu(opts = {}){
  const startEl = document.getElementById('dosuRangeStart');
  const endEl   = document.getElementById('dosuRangeEnd');
  const docSel  = document.getElementById('dosuDoctor');
    let lastQueryKey = '';
    const start = opts.start || startEl.value;
  const end   = opts.end   || endEl.value;
  const physioId = opts.physioId || docSel.value || '';

  const qs = ()=> new URLSearchParams({ start, end, physioId }).toString();

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
  const prev = physioId || docSel.value;   // ✅ 현재/요청된 선택 보관
  const j = await apiRequest('/accounts?role=physio');
const items = (j.items || []).filter(u => (u.role || '') === 'physio'); // 안전망
physioSel.innerHTML = ['<option value="">치료사를 선택해주세요</option>']
  .concat(items.map(u => `<option value="${u.id}">${u.name || '치료사'}</option>`))
  .join('');

  if (prev !== undefined) docSel.value = String(prev);  // ✅ 선택 복원
}catch{}


  async function load(){
  // ✅ 현재 요청 키
 const qkey = `${startEl.value}|${endEl.value}|${docSel.value||''}`;
  lastQueryKey = qkey;

  const a = await apiRequest(`/dosu/summary?${qs()}`);
  const b = await apiRequest(`/dosu/daily?${qs()}`);

  // ✅ 최신 요청이 아니면 무시
  if (lastQueryKey !== qkey) return;

    // KPI
    kpiCur.textContent   = (a.kpi?.current||0) + '명';
    kpiPrev.textContent  = (a.kpi?.previous||0) + '명';
    kpiRe.textContent    = (a.kpi?.revisitRate||0) + '%';
    kpiRev.textContent   = fmt(a.kpi?.revenue||0);
    
(function(){
  const N   = (x)=> Number(x||0);
  const fmt = (n)=> N(n).toLocaleString();

  // 요약 데이터
  const cur     = N(a.kpi?.current);      // 기간 내 내원수
  const revenue = N(a.kpi?.revenue);      // 기간 내 매출
  const newCnt  = N(a.kpi?.new);          // 신환 수
  const reCnt   = N(a.kpi?.revisit);      // 재진 수

  // 1) 1인당 평균 금액
  const avg = cur ? Math.round(revenue / cur) : 0;
  const avgEl  = document.getElementById('kpiAvg');
  const avgBox = document.getElementById('kpiAvgCard');
  if (avgEl && avgBox) {
    if (avg > 0) { avgEl.textContent = fmt(avg) + '원'; avgBox.style.display = ''; }
    else { avgBox.style.display = 'none'; }
  }

  // 2) 신환 수
  const newEl  = document.getElementById('kpiNewCnt');
  const newBox = document.getElementById('kpiNewCntCard');
  if (newEl && newBox) {
    if (newCnt >= 0) { newEl.textContent = fmt(newCnt) + '명'; newBox.style.display = ''; }
    else { newBox.style.display = 'none'; }
  }

  // 3) 재진 수
  const reEl  = document.getElementById('kpiReCnt');
  const reBox = document.getElementById('kpiReCntCard');
  if (reEl && reBox) {
    if (reCnt >= 0) { reEl.textContent = fmt(reCnt) + '명'; reBox.style.display = ''; }
    else { reBox.style.display = 'none'; }
  }

  // 4) TOP 치료사(내원수 기준)
  const top = (a.therapists||[]).slice().sort((x,y)=> N(y.visits)-N(x.visits))[0];
  const topEl  = document.getElementById('kpiTopThera');
  const topBox = document.getElementById('kpiTopTheraCard');
  if (topEl && topBox) {
    if (top && (N(top.visits) > 0)) {
      topEl.textContent = `${top.name||'치료사'} · ${fmt(top.visits)}명`;
      topBox.style.display = '';
    } else {
      topBox.style.display = 'none';
    }
  }
})();

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
        <td style="text-align:right">${(r.rate||0)}%</td>
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
    <td>${r.date||''}</td>                       <!-- 일자 -->
    <td style="text-align:left">${fmt(r.visits)}</td>   <!-- 내원수 -->
    <td style="text-align:left">${fmt(r.new)}</td>      <!-- 신환 -->
    <td style="text-align:left">${fmt(r.revisit)}</td>  <!-- 재진 -->
    <td style="text-align:left">${(r.rate||0)}%</td>    <!-- 재진율 -->
    <td style="text-align:left">${fmt(r.revenue)}</td>`;<!-- 수익 -->
  f4.appendChild(tr);
});
tbDaily.appendChild(f4);
  }

 document.getElementById('dosuReload')?.addEventListener('click', load);
document.getElementById('dosuSearch')?.addEventListener('click', load); // ▶ 검색 버튼
const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const loadDebounced = debounce(load, 150);

startEl.addEventListener('change', loadDebounced);
endEl.addEventListener('change', loadDebounced);
document.getElementById('dosuDoctor')?.addEventListener('change', loadDebounced);

// ✅ 도수 치료 정보 추가: 모달 부트 함수
window.bootDosuAddUI = (function(){
  let retryTimer = null;

  function initOnce(){
    const panel  = document.querySelector('[data-panel="noncovered-dosu"]');
    const openBtn= document.getElementById('dosuAdd');
    const modal  = document.getElementById('dosuModal');
    const form   = document.getElementById('dosuForm');

    // 패널/버튼/모달이 아직 안 만들어졌으면 잠깐 뒤에 다시 시도
    if (!panel || !openBtn || !modal || !form) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(initOnce, 120);
      return;
    }

    // 오늘 날짜 기본값
    const dateInput = form.querySelector('input[name="writtenAt"]');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0,10);
    }

    // 치료사 목록 주입(physio)
    const physioSel = document.getElementById('dosuPhysioSelect');
    if (physioSel && !physioSel.dataset.loaded) {
      (async () => {
        try {
          const j = await apiRequest('/accounts?role=physio'); // admin 권한 필요
          const items = j.items || [];
          physioSel.innerHTML = ['<option value="">치료사를 선택해주세요</option>']
            .concat(items.map(u => `<option value="${u.id}">${u.name || u.email || '치료사'}</option>`))
            .join('');
          physioSel.dataset.loaded = '1';
        } catch(e) { console.warn('physio load failed', e); }
      })();
    }

    const show = () => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false'); };
    const hide = () => { modal.classList.add('hidden');    modal.setAttribute('aria-hidden','true'); };

    // 중복 바인딩 방지
    if (!openBtn.dataset.bound) {
      openBtn.dataset.bound = '1';
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        show();
      });
    }
    if (!modal.dataset.bound) {
      modal.dataset.bound = '1';
      modal.addEventListener('click', (e) => {
        if (e.target?.dataset?.close) hide();
      });
    }

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
        treat     : { only:!!fd.get('treat_only'), inj:!!fd.get('treat_inj'), eswt:!!fd.get('treat_eswt') },
        reservation: fd.get('reservation') || 'none'
      };
      if (!payload.physioId) { alert('치료사를 선택해주세요.'); return; }
      if (!payload.patient)  { alert('환자명을 입력해주세요.'); return; }

      try{
        await apiRequest('/dosu/records', { method:'POST', body: payload });
        alert('저장되었습니다.');
        hide();
        if (window.renderDosu) window.renderDosu();
      }catch(err){
        console.error(err);
        alert('저장 실패: ' + (err?.message || err));
      }
    };
  }

  return function bootDosuAddUI(){
    clearTimeout(retryTimer);
    initOnce();
  };
})();

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

  load();
};

// === 도수치료 "정보 추가" 버튼 클릭 폴백 ===
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#dosuAdd');
  if (!btn) return;

  // 초기화 루틴이 혹시 아직 안 돌았으면 한 번 더 호출
  if (window.bootDosuAddUI) window.bootDosuAddUI();

  const modal = document.getElementById('dosuModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}, { capture: true });

document.querySelectorAll('#dosuFrom, #dosuTo').forEach(el => el.style.zIndex = '5');

// ✅ 치료사 선택해도 날짜 입력 잠금 해제
(function fixDosuDateLock(){
  const doctor = document.getElementById('dosuDoctor');     // 치료사 셀렉트
  const fromEl = document.getElementById('dosuRangeStart'); // 시작일
  const toEl   = document.getElementById('dosuRangeEnd');   // 종료일
  if (!doctor || !fromEl || !toEl) return;

  const unlockDates = () => {
    fromEl.disabled = false;  toEl.disabled = false;
    fromEl.readOnly = false;  toEl.readOnly = false;
    [fromEl, toEl].forEach(el => {
      el.style.pointerEvents = 'auto';
      el.classList.remove('disabled');
    });
  };

  // 최초 1회
  unlockDates();
  // 치료사 변경 시마다 잠금 해제
  doctor.addEventListener('change', unlockDates);
})();


(function patchDosuSearch(){
  const $ = (sel) => document.querySelector(sel);
  const doctor = $('#dosuDoctor');

  const fromEl = $('#dosuRangeStart') || $('#dosuFrom');
  const toEl   = $('#dosuRangeEnd')   || $('#dosuTo');

  let searchBtn = $('#dosuSearch') || Array.from(document.querySelectorAll('button'))
    .find(b => /검색/.test(b.textContent||''));

  if (!fromEl || !toEl || !searchBtn) return; 

  const unlockDates = () => {
    [fromEl, toEl].forEach(el => {
      el.disabled = false;
      el.readOnly = false;
      el.style.pointerEvents = 'auto';
      el.classList && el.classList.remove('disabled');
    });
  };
  unlockDates();
  doctor && doctor.addEventListener('change', unlockDates);
 
  try { searchBtn.replaceWith(searchBtn.cloneNode(true)); searchBtn = ($('#dosuSearch') || Array.from(document.querySelectorAll('button')).find(b => /검색/.test(b.textContent||''))); } catch {}
  if (!searchBtn) return;

  searchBtn.addEventListener('click', (e) => {
    e.preventDefault();


    const start = (fromEl.value || '').trim();
    const end   = (toEl.value || '').trim();
    const physioId = doctor ? (doctor.value || '').trim() : '';


    const periodText = document.getElementById('dosuPeriodText');
    if (periodText && start && end) {
      periodText.textContent = `${start} ~ ${end}`;
    }


    if (window.renderDosu) {
      window.renderDosu({ start, end, physioId });
    } else if (window.loadDosuSummary) {
      window.loadDosuSummary({ start, end, physioId });
    } else {

      const qs = (o)=>Object.entries(o).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
      const q = qs({ start, end, physioId });
      Promise.all([
        fetch(`/api/dosu/summary?${q}`).then(r=>r.json()).catch(()=>({})),
        fetch(`/api/dosu/daily?${q}`).then(r=>r.json()).catch(()=>({}))
      ]).then(([s,d])=>{

        console.log('dosu summary', s, 'dosu daily', d);
        // TODO: 필요 시 DOM 반영
      });
    }
  });
})();
