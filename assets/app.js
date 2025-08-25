// assets/app.js
(function(){
  function qs(s, el=document){ return el.querySelector(s); }
  function qsa(s, el=document){ return Array.from(el.querySelectorAll(s)); }
  const fmt = new Intl.NumberFormat('ko-KR');

  /* ------------------- 공통: 네비 전환 ------------------- */
  function activate(viewId){
    qsa('.nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewId));
    qsa('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== viewId));
    const titleMap = {
      partners: '계약 병원(파트너) 매출',
      noncovered: '비급여치료', consumables:'소모품', drugs:'의약품',
      income:'수입/지출', nhis:'공단 수령 현황', revisit:'재진율',
      claims:'진료비 청구 내역', closing:'마감일지', categories:'카테고리 관리', accounts:'계정관리'
    };
    const h = qs('#pageTitle'); if (h) h.textContent = titleMap[viewId] || '관리자 대시보드';
  }

  /* ------------------- 파트너 병원 ------------------- */
  async function renderPartners(){
    const box = qs('#partnersBox'); if(!box) return;
    try{
      const res = await fetch('assets/data/hospitals.json?v=' + Date.now());
      const data = await res.json();

      const sel = qs('#hospitalSelect');
      sel.innerHTML = data.hospitals.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
      sel.addEventListener('change', () => fillHospital(sel.value, data));
      fillHospital(sel.value || data.hospitals[0]?.id, data);

      qs('#exportCsv').addEventListener('click', () => exportCsv(sel.value, data));
    }catch(e){
      console.error(e);
      box.innerHTML = `<div class="panel">데이터를 불러오지 못했습니다.</div>`;
    }
  }
  function fillHospital(hid, data){
    const h = data.hospitals.find(x => x.id === hid);
    if(!h) return;
    qs('#hospitalMeta').innerHTML = `<span class="badge">${h.status}</span> 계약일: ${h.contract_since} · ID: ${h.id}`;
    const rows = h.monthly
      .slice().sort((a,b)=>a.month<b.month?-1:1)
      .map(m => `<tr>
        <td>${m.month}</td>
        <td>${fmt.format(m.revenue)}원</td>
        <td>${fmt.format(m.claims)}건</td>
        <td>${m.notes||''}</td>
      </tr>`).join('');
    qs('#hospitalTable tbody').innerHTML = rows || `<tr><td colspan="4">데이터 없음</td></tr>`;
  }
  function exportCsv(hid, data){
    const h = data.hospitals.find(x => x.id === hid);
    if(!h) return;
    const lines = ['month,revenue,claims,notes', ...h.monthly.map(m => `${m.month},${m.revenue},${m.claims},"${(m.notes||'').replace(/"/g,'""')}"`)];
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${h.id}_monthly.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ------------------- 카테고리 관리 ------------------- */
  const CAT_KEY = 'gdc.categories';
  let catCache = null;

  async function loadCategories() {
    if (catCache) return catCache;
    // 1) 로컬스토리지 우선
    try {
      const raw = localStorage.getItem(CAT_KEY);
      if (raw) {
        catCache = JSON.parse(raw);
        return catCache;
      }
    } catch(e){ /* noop */ }

    // 2) 초기값: 파일에서 1회 로드
    try {
      const res = await fetch('assets/data/categories.json?v=' + Date.now());
      const json = await res.json();
      catCache = json;
      saveCategories(json);
      return json;
    } catch(e) {
      // 최소 스켈레톤
      catCache = {
        noncovered:[], consumables:[], drugs:[], income:[], nhis:[],
        revisit:[], claims:[], closing:[], categories:[], accounts:[], partners:[]
      };
      return catCache;
    }
  }
  function saveCategories(obj){
    catCache = obj;
    localStorage.setItem(CAT_KEY, JSON.stringify(obj));
  }

  function listCats(module){ return (catCache?.[module] || []).slice(); }
  function addCat(module, name){
    const set = new Set(listCats(module));
    if (!name || set.has(name)) return false;
    set.add(name);
    catCache[module] = Array.from(set);
    saveCategories(catCache);
    return true;
  }
  function renameCat(module, oldName, newName){
    if (!newName) return false;
    const list = listCats(module);
    const i = list.indexOf(oldName);
    if (i < 0) return false;
    if (list.includes(newName)) return false;
    list[i] = newName;
    catCache[module] = list;
    saveCategories(catCache);
    return true;
  }
  function deleteCat(module, name){
    const list = listCats(module).filter(x => x !== name);
    catCache[module] = list;
    saveCategories(catCache);
    return true;
  }
  function exportCat(){
    const blob = new Blob([JSON.stringify(catCache, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'categories_export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importCat(file, onDone){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const obj = JSON.parse(reader.result);
        saveCategories(obj);
        onDone?.(true);
      }catch(e){
        onDone?.(false);
      }
    };
    reader.readAsText(file);
  }

  function renderCatTable(module){
    const tbody = qs('#categoryTable tbody');
    const items = listCats(module);
    if (!items.length){
      tbody.innerHTML = `<tr><td colspan="2">카테고리가 없습니다. 입력 후 [추가]를 눌러주세요.</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((name,idx)=>`
      <tr data-name="${name}">
        <td>${idx+1}</td>
        <td>${name}</td>
      </tr>`).join('');

    // 행 클릭 → 입력창에 이름 채우기(변경/삭제 편의)
    qsa('#categoryTable tbody tr').forEach(tr=>{
      tr.addEventListener('click', ()=>{
        const n = tr.getAttribute('data-name');
        const input = qs('#catNameInput');
        if (input) input.value = n;
        qsa('#categoryTable tbody tr').forEach(x=>x.classList.remove('active'));
        tr.classList.add('active');
      });
    });
  }

  async function initCategoriesUI(){
    const box = qs('#categoriesBox'); if(!box) return;

    await loadCategories();
    const moduleSel = qs('#categoryModuleSelect');
    const input = qs('#catNameInput');
    const addBtn = qs('#addCatBtn');
    const renBtn = qs('#renameCatBtn');
    const delBtn = qs('#deleteCatBtn');
    const expBtn = qs('#exportCatBtn');
    const impInput = qs('#importCatInput');

    function refresh(){ renderCatTable(moduleSel.value); }
    moduleSel.addEventListener('change', refresh);
    refresh();

    addBtn.addEventListener('click', ()=>{
      const name = input.value.trim();
      if (!name) return alert('이름을 입력하세요.');
      if (!addCat(moduleSel.value, name)) return alert('이미 존재하거나 잘못된 이름입니다.');
      input.value = '';
      refresh();
    });

    renBtn.addEventListener('click', ()=>{
      const oldName = qs('#categoryTable tbody tr.active')?.getAttribute('data-name') || null;
      const newName = input.value.trim();
      if (!oldName) return alert('변경할 항목을 표에서 선택하세요.');
      if (!newName) return alert('새 이름을 입력하세요.');
      if (!renameCat(moduleSel.value, oldName, newName)) return alert('이름 변경 실패(중복 또는 잘못된 값).');
      input.value = '';
      refresh();
    });

    delBtn.addEventListener('click', ()=>{
      const name = qs('#categoryTable tbody tr.active')?.getAttribute('data-name') || input.value.trim();
      if (!name) return alert('삭제할 항목을 선택하거나 이름을 입력하세요.');
      if (!confirm(`정말 삭제할까요? [${name}]`)) return;
      deleteCat(moduleSel.value, name);
      input.value = '';
      refresh();
    });

    expBtn.addEventListener('click', exportCat);

    impInput.addEventListener('change', (e)=>{
      const file = e.target.files?.[0];
      if (!file) return;
      importCat(file, (ok)=>{
        if (!ok) return alert('가져오기 실패: JSON 형식 확인');
        // 모듈 선택 바 다시 채울 필요는 없음 (키 유지 가정)
        refresh();
        alert('가져오기 완료!');
        impInput.value = ''; // 같은 파일 재가져오기 대비 초기화
      });
    });
  }

  /* ------------------- 외부 초기화 ------------------- */
  window.AdminUI = {
    init(){
      // 메뉴 전환
      qsa('.nav button').forEach(btn => {
        btn.addEventListener('click', ()=>{
          activate(btn.dataset.view);
          if (btn.dataset.view === 'partners') renderPartners();
          if (btn.dataset.view === 'categories') initCategoriesUI();
        });
      });
      // 기본 탭
      activate('partners');
      renderPartners();
      // 카테고리 UI도 미리 준비 가능 (원하면 주석 해제)
      // initCategoriesUI();
    }
  };
})();
