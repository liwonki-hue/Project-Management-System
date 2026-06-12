// PMS Dashboard — main frontend logic
let allActivities = [];
let allProgress   = [];
let progressMap   = {};

let searchText       = '';
let selectedUnit     = '';
let selectedActivity = '';
let selectedDate     = '';

const PAGE_SIZE = 20;
let currentPage = 1;

const UNIT_LABEL = { '0CF': 'B0', '1CF': 'B1', '2CF': 'B2' };
function fmtBlock(unit_no) { return UNIT_LABEL[unit_no] || unit_no || '-'; }

// ── Data Load ───────────────────────────────────────────────
async function loadData() {
  const loading  = document.getElementById('loading');
  const tableWrap = document.getElementById('table-wrap');
  loading.style.display  = 'block';
  tableWrap.style.display = 'none';

  try {
    const [actRes, progRes] = await Promise.all([
      fetch('/api/activities'),
      fetch('/api/progress'),
    ]);
    if (!actRes.ok || !progRes.ok) throw new Error('API 응답 오류');
    allActivities = await actRes.json();
    allProgress   = await progRes.json();
  } catch (err) {
    loading.textContent = '데이터 로드 실패. 페이지를 새로고침해 주세요.';
    console.error('loadData 실패:', err);
    return;
  }

  buildProgressMap();
  populateDropdowns();

  loading.style.display   = 'none';
  tableWrap.style.display = 'block';

  const dates = [...new Set(allProgress.map(p => p.report_date).filter(Boolean))].sort();
  if (dates.length) {
    document.getElementById('last-updated').textContent =
      `Report Date: ${dates[dates.length - 1]} | ${allActivities.length} Activities`;
  }

  render();
}

// ── Progress Map ─────────────────────────────────────────────
function buildProgressMap() {
  progressMap = {};
  for (const p of allProgress) {
    if (selectedDate && p.report_date !== selectedDate) continue;
    const id = p.activity_id;
    if (!progressMap[id] || p.report_date > progressMap[id].report_date) {
      progressMap[id] = p;
    }
  }
}

// ── Populate Dropdowns ───────────────────────────────────────
function populateDropdowns() {
  // Block dropdown (unit_no, displayed as B0/B1/B2)
  const blockSel = document.getElementById('unit-filter');
  const units = [...new Set(allActivities.map(a => a.unit_no).filter(Boolean))].sort();
  blockSel.innerHTML = '<option value="">All</option>';
  units.forEach(u => {
    const o = document.createElement('option');
    o.value = u;
    o.textContent = fmtBlock(u);
    blockSel.appendChild(o);
  });

  // Activity ID dropdown
  const actSel = document.getElementById('activity-id-filter');
  actSel.innerHTML = '<option value="">All</option>';
  allActivities.forEach(act => {
    const o = document.createElement('option');
    o.value = act.activity_id;
    o.textContent = act.activity_id;
    actSel.appendChild(o);
  });

  // Date dropdown
  const dates = [...new Set(allProgress.map(p => p.report_date).filter(Boolean))].sort().reverse();
  const dateSel = document.getElementById('date-filter');
  dateSel.innerHTML = '<option value="">All Dates</option>';
  dates.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    dateSel.appendChild(o);
  });
}

// ── Filter ──────────────────────────────────────────────────
function getFiltered() {
  return allActivities.filter(act => {
    if (selectedUnit && act.unit_no !== selectedUnit) return false;
    if (selectedActivity && act.activity_id !== selectedActivity) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const inId   = (act.activity_id   || '').toLowerCase().includes(q);
      const inName = (act.activity_name || '').toLowerCase().includes(q);
      if (!inId && !inName) return false;
    }
    return true;
  });
}

// ── Render ──────────────────────────────────────────────────
function render() {
  const data       = getFiltered();
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;
  const pageData   = data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  renderKPIs(data);
  renderTable(pageData);
  renderPagination(data.length, totalPages);
}

// ── Pagination ───────────────────────────────────────────────
function renderPagination(total, totalPages) {
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);

  let html = `<span class="pag-info">${start}–${end} / ${total} rows</span>`;

  // prev
  html += `<button class="pag-btn pag-arrow" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;

  // page numbers
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="pag-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
  }

  // next
  html += `<button class="pag-btn pag-arrow" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;

  pag.innerHTML = html;
}

// ── KPIs ────────────────────────────────────────────────────
function renderKPIs(data) {
  document.getElementById('kpi-total').textContent = data.length.toLocaleString();

  let completed = 0, inProgress = 0, notStarted = 0, thisWeek = 0;
  for (const act of data) {
    const p     = progressMap[act.activity_id];
    const total = p && p.actual_total_qty != null ? parseFloat(p.actual_total_qty) : null;
    const budg  = act.budgeted_units != null ? parseFloat(act.budgeted_units) : null;
    const twk   = p && p.this_week_qty != null ? parseFloat(p.this_week_qty) : 0;

    if (twk > 0) thisWeek++;

    if (!total || total === 0) {
      notStarted++;
    } else if (budg && total >= budg) {
      completed++;
    } else {
      inProgress++;
    }
  }

  const remaining = data.length - completed;

  document.getElementById('kpi-in-progress').textContent = inProgress.toLocaleString();
  document.getElementById('kpi-complete').textContent    = completed.toLocaleString();
  document.getElementById('kpi-remaining').textContent   = remaining.toLocaleString();
  document.getElementById('kpi-this-week').textContent   = thisWeek.toLocaleString();
  document.getElementById('kpi-not-started').textContent = notStarted.toLocaleString();
}

// ── Table ───────────────────────────────────────────────────
const PROG_DASH = '<span class="prog-dash">-</span>';

function renderTable(data) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  for (const act of data) {
    const p = progressMap[act.activity_id] || {};

    const prevWk    = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : null;
    const thisWk    = p.this_week_qty != null ? parseFloat(p.this_week_qty) : null;
    const completed = (prevWk != null || thisWk != null) ? (prevWk || 0) + (thisWk || 0) : null;
    const remaining  = null;   // Total Q'ty는 사용자 직접 입력 — 초기 계산 불가

    const blockLabel = fmtBlock(act.unit_no);
    const cls = `unit-${act.unit_no}`;
    const ut = act.unit_type || '';
    const unitOpts = ['DI', '%'].map(v =>
      `<option value="${v}"${ut === v ? ' selected' : ''}>${v}</option>`
    ).join('');

    const startVal  = toISODate(p.actual_start);
    const finishVal = toISODate(p.actual_finish);

    const tr = document.createElement('tr');
    tr.dataset.id = act.activity_id;
    tr.innerHTML = `
      <td><span class="unit-badge ${cls}">${blockLabel}</span></td>
      <td class="td-id">${act.activity_id || '-'}</td>
      <td class="td-name">${act.activity_name || '-'}</td>
      <td><input type="date" class="date-input${startVal ? ' has-val' : ''}"
            data-id="${act.activity_id}" data-field="actual_start" value="${startVal}"></td>
      <td><input type="date" class="date-input${finishVal ? ' has-val' : ''}"
            data-id="${act.activity_id}" data-field="actual_finish" value="${finishVal}"></td>
      <td><select class="unit-select" data-id="${act.activity_id}"><option value=""></option>${unitOpts}</select></td>
      <td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="budgeted_units" data-table="activities" value=""></td>
      <td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="prev_week_qty"  data-table="progress"    value="${prevWk  ?? ''}"></td>
      <td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="this_week_qty"  data-table="progress"    value="${thisWk  ?? ''}"></td>
      <td class="completed-cell">${fmtNum(completed, 1)}</td>
      <td class="remaining-cell">${fmtNum(remaining, 1)}</td>
      <td class="progress-cell">${PROG_DASH}</td>
      <td><input type="text" class="remark-input" data-id="${act.activity_id}" placeholder=""></td>
      <td><input type="text" class="qty-input" data-id="${act.activity_id}" data-field="local_staff"  data-table="progress" value="${p.local_staff  ?? ''}"></td>
      <td><input type="text" class="qty-input" data-id="${act.activity_id}" data-field="korean_staff" data-table="progress" value="${p.korean_staff ?? ''}"></td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Auto-recalc row ──────────────────────────────────────────
function recalcRow(tr) {
  const totalQty  = parseFloat(tr.querySelector('[data-field="budgeted_units"]')?.value) || null;
  const prev      = parseFloat(tr.querySelector('[data-field="prev_week_qty"]')?.value)  || null;
  const thisWk    = parseFloat(tr.querySelector('[data-field="this_week_qty"]')?.value)  || null;

  const completed = (prev != null || thisWk != null) ? (prev || 0) + (thisWk || 0) : null;
  const remaining = (totalQty != null && completed != null) ? totalQty - completed : null;
  const pct       = (totalQty && totalQty > 0 && completed != null)
    ? Math.min(100, (completed / totalQty) * 100) : null;

  const fmt = v => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-';
  tr.querySelector('.completed-cell').textContent = fmt(completed);
  tr.querySelector('.remaining-cell').textContent = fmt(remaining);
  tr.querySelector('.progress-cell').innerHTML = pct != null
    ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div><span class="progress-text">${pct.toFixed(1)}%</span>`
    : '<span class="prog-dash">-</span>';
}

// ── Util ────────────────────────────────────────────────────
function toISODate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function fmtNum(val, decimals = 1) {
  if (val == null || val === '') return '-';
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals === 0 ? 0 : undefined,
    maximumFractionDigits: decimals
  });
}

// ── Events ──────────────────────────────────────────────────
function doSearch() {
  searchText = document.getElementById('search').value.trim();
  currentPage = 1;
  render();
}
document.getElementById('search-btn').addEventListener('click', doSearch);
document.getElementById('search').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});
document.getElementById('unit-filter').addEventListener('change', e => {
  selectedUnit = e.target.value; currentPage = 1; render();
});
document.getElementById('activity-id-filter').addEventListener('change', e => {
  selectedActivity = e.target.value; currentPage = 1; render();
});
document.getElementById('date-filter').addEventListener('change', e => {
  selectedDate = e.target.value; currentPage = 1; buildProgressMap(); render();
});

document.getElementById('pagination').addEventListener('click', e => {
  const btn = e.target.closest('.pag-btn');
  if (!btn || btn.disabled) return;
  currentPage = parseInt(btn.dataset.page);
  render();
  document.getElementById('table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('table-body').addEventListener('change', async e => {
  // ── date input save ───────────────────────────────────────
  if (e.target.classList.contains('date-input')) {
    const input      = e.target;
    const activityId = input.dataset.id;
    const field      = input.dataset.field;
    const value      = input.value || null;
    // toggle has-val class
    input.classList.toggle('has-val', !!value);
    // update local progressMap
    if (progressMap[activityId]) progressMap[activityId][field] = value;
    try {
      await fetch(`/api/progress/${encodeURIComponent(activityId)}/dates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      input.classList.add('saved');
      setTimeout(() => input.classList.remove('saved'), 1200);
    } catch (err) {
      console.error('날짜 저장 실패:', err);
    }
    return;
  }
  // ── qty input: auto-recalc ───────────────────────────────
  if (e.target.classList.contains('qty-input')) {
    recalcRow(e.target.closest('tr'));
    return;
  }
  // ── unit-select save ──────────────────────────────────────
  if (!e.target.classList.contains('unit-select')) return;
  const sel = e.target;
  const activityId = sel.dataset.id;
  const unitType   = sel.value;
  // Update local cache
  const act = allActivities.find(a => a.activity_id === activityId);
  if (act) act.unit_type = unitType;
  // Persist to DB
  try {
    await fetch(`/api/activities/${encodeURIComponent(activityId)}/unit_type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_type: unitType }),
    });
    sel.classList.add('saved');
    setTimeout(() => sel.classList.remove('saved'), 1200);
  } catch (err) {
    console.error('unit_type 저장 실패:', err);
  }
});

// ── Save (batch) ────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-btn');
  btn.textContent = '저장 중...'; btn.disabled = true;

  const rows = document.querySelectorAll('#table-body tr');
  const actMap = {}, progMap = {};

  rows.forEach(tr => {
    const id = tr.dataset.id;
    if (!id) return;

    // unit_type
    const unitSel = tr.querySelector('.unit-select');
    if (!actMap[id]) actMap[id] = { activity_id: id };
    if (unitSel) actMap[id].unit_type = unitSel.value || null;

    // dates
    const startInp  = tr.querySelector('[data-field="actual_start"]');
    const finishInp = tr.querySelector('[data-field="actual_finish"]');
    if (!progMap[id]) progMap[id] = { activity_id: id };
    progMap[id].actual_start  = startInp?.value  || null;
    progMap[id].actual_finish = finishInp?.value || null;

    // qty inputs
    tr.querySelectorAll('.qty-input').forEach(inp => {
      const field = inp.dataset.field;
      const val   = inp.type === 'number'
        ? (inp.value !== '' ? parseFloat(inp.value) : null)
        : (inp.value || null);
      if (inp.dataset.table === 'activities') actMap[id][field] = val;
      else progMap[id][field] = val;
    });
  });

  const actUpdates  = Object.values(actMap);
  const progUpdates = Object.values(progMap);

  try {
    await fetch('/api/save_batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: actUpdates, progress: progUpdates }),
    });
    btn.textContent = '✔ Saved';
    setTimeout(() => { btn.textContent = '💾 Save'; btn.disabled = false; }, 1500);
  } catch (err) {
    console.error('저장 실패:', err);
    btn.textContent = '💾 Save'; btn.disabled = false;
  }
});

// ── Export to Excel ──────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const btn = document.getElementById('export-btn');

  if (typeof XLSX === 'undefined') {
    alert('Excel 라이브러리가 아직 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  try {
    btn.textContent = '⏳ ...'; btn.disabled = true;

    const headers = [...document.querySelectorAll('#activity-table th')]
      .map(th => th.innerText.replace(/\n/g, ' ').trim());

    const rows = [...document.querySelectorAll('#table-body tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => {
        const sel = td.querySelector('select');
        const inp = td.querySelector('input');
        const spn = td.querySelector('.unit-badge');
        if (sel) return sel.value;
        if (inp) return inp.value;
        if (spn) return spn.textContent.trim();
        return td.innerText.trim();
      })
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 2 ? 42 : 16 }));

    // Header row style (bold)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true } };
    }

    XLSX.utils.book_append_sheet(wb, ws, 'PMS Schedule');
    const filename = `PMS_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);

    btn.textContent = '✔ Done';
    setTimeout(() => { btn.textContent = '📊 Excel'; btn.disabled = false; }, 1500);
  } catch (err) {
    console.error('Excel 내보내기 실패:', err);
    alert('Excel 내보내기 중 오류가 발생했습니다: ' + err.message);
    btn.textContent = '📊 Excel'; btn.disabled = false;
  }
});

// ── Print ────────────────────────────────────────────────────
document.getElementById('print-btn').addEventListener('click', () => {
  // Give table time to render before printing
  setTimeout(() => window.print(), 100);
});

// ── Init ────────────────────────────────────────────────────
loadData();
