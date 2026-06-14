// PMS Dashboard — main frontend logic
let allActivities = [];
let allProgress   = [];
let progressMap   = {};

let searchText         = '';
let selectedUnit       = '';
let selectedDiscipline = '';
let selectedActivity   = '';
let selectedStatus     = '';   // '' | 'not-start' | 'ongoing' | 'completed'
let selectedKpiAct     = '';   // '' | 'prev' | 'this' | 'new'

const PAGE_SIZE = 20;
let currentPage = 1;

const UNIT_LABEL = { '0CF': 'B0', '1CF': 'B1', '2CF': 'B2' };
function fmtBlock(unit_no) { return UNIT_LABEL[unit_no] || unit_no || '-'; }

function getStatus(act) {
  const p      = progressMap[act.activity_id] || {};
  const totalQ = act.budgeted_units != null ? parseFloat(act.budgeted_units) : null;
  const prevWk = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : 0;
  const thisWk = p.this_week_qty != null ? parseFloat(p.this_week_qty) : 0;
  const compQ  = prevWk + thisWk;
  if (compQ <= 0) return 'not-start';
  if (totalQ && totalQ > 0 && compQ >= totalQ) return 'completed';
  return 'ongoing';
}

// ── Data Load ───────────────────────────────────────────────
async function loadData() {
  const loading   = document.getElementById('loading');
  const tableWrap = document.getElementById('table-wrap');
  loading.style.display   = 'block';
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
    const id = p.activity_id;
    if (!progressMap[id] || p.report_date > progressMap[id].report_date) {
      progressMap[id] = p;
    }
  }
}

// ── Populate Dropdowns ───────────────────────────────────────
function populateDropdowns() {
  const blockSel = document.getElementById('unit-filter');
  const units = [...new Set(allActivities.map(a => a.unit_no).filter(Boolean))].sort();
  blockSel.innerHTML = '<option value="">All</option>';
  units.forEach(u => {
    const o = document.createElement('option');
    o.value = u; o.textContent = fmtBlock(u);
    blockSel.appendChild(o);
  });

  const discSel = document.getElementById('discipline-filter');
  const discs = [...new Set(allActivities.map(a => a.department).filter(Boolean))].sort();
  discSel.innerHTML = '<option value="">All</option>';
  discs.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    discSel.appendChild(o);
  });

  updateActivityIdDropdown(allActivities);
}

function updateActivityIdDropdown(activities) {
  const actSel = document.getElementById('activity-id-filter');
  const prev   = actSel.value;
  actSel.innerHTML = '<option value="">All</option>';
  activities.forEach(act => {
    const o = document.createElement('option');
    o.value = act.activity_id; o.textContent = act.activity_id;
    actSel.appendChild(o);
  });
  actSel.value = activities.some(a => a.activity_id === prev) ? prev : '';
  if (actSel.value !== prev) { selectedActivity = ''; }
}

// ── Filter ──────────────────────────────────────────────────
function getFiltered() {
  return allActivities.filter(act => {
    if (selectedUnit       && act.unit_no    !== selectedUnit)       return false;
    if (selectedDiscipline && act.department !== selectedDiscipline) return false;
    if (selectedActivity   && act.activity_id !== selectedActivity)  return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const inId   = (act.activity_id   || '').toLowerCase().includes(q);
      const inName = (act.activity_name || '').toLowerCase().includes(q);
      if (!inId && !inName) return false;
    }
    if (selectedStatus && getStatus(act) !== selectedStatus) return false;
    if (selectedKpiAct) {
      const p    = progressMap[act.activity_id] || {};
      const prev = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : 0;
      const this_ = p.this_week_qty != null ? parseFloat(p.this_week_qty) : 0;
      if (selectedKpiAct === 'prev' && !(prev  > 0))                return false;
      if (selectedKpiAct === 'this' && !(this_ > 0))                return false;
      if (selectedKpiAct === 'new'  && !(this_ > 0 && prev === 0))  return false;
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

  renderKPIs(allActivities);
  renderTable(pageData, (currentPage - 1) * PAGE_SIZE);
  renderPagination(data.length, totalPages);
}

// ── Pagination ───────────────────────────────────────────────
function renderPagination(total, totalPages) {
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);

  let html = `<span class="pag-info">${start}–${end} / ${total} rows</span>`;
  html += `<button class="pag-btn pag-arrow" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="pag-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
  }
  html += `<button class="pag-btn pag-arrow" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
  pag.innerHTML = html;
}

// ── KPIs ────────────────────────────────────────────────────
function renderKPIs(data) {
  let weightSum    = 0;
  let progressPct  = 0;
  let prevWeekPct  = 0;
  let thisWeekPct  = 0;
  let actPrevCount = 0;
  let actThisCount = 0;
  let actNewCount  = 0;

  for (const act of data) {
    const p       = progressMap[act.activity_id] || {};
    const wf     = act.weight_factor != null ? parseFloat(act.weight_factor) : 0;
    // budgeted_units 미입력 시 100(%)으로 간주하여 다른 activity와 동일하게 KPI 산출
    const totalQ = (act.budgeted_units != null && parseFloat(act.budgeted_units) > 0)
      ? parseFloat(act.budgeted_units) : 100;
    const prevWk = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : 0;
    const thisWk = p.this_week_qty != null ? parseFloat(p.this_week_qty) : 0;

    weightSum += wf;
    if (prevWk > 0) actPrevCount++;
    if (thisWk > 0) actThisCount++;
    if (thisWk > 0 && prevWk === 0) actNewCount++;

    if (wf > 0) {
      const compQ = prevWk + thisWk;
      progressPct += wf * Math.min(1, compQ  / totalQ) * 100;
      prevWeekPct += wf * Math.min(1, prevWk / totalQ) * 100;
      thisWeekPct += wf * Math.min(1, thisWk / totalQ) * 100;
    }
  }

  const fmt2 = v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = v => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const weightPct  = weightSum * 100;
  const prevWeekWF = weightPct * prevWeekPct / 100;
  const thisWeekWF = weightPct * thisWeekPct / 100;

  document.getElementById('kpi-weight').textContent    = fmt2(weightPct) + '%';
  document.getElementById('kpi-pw-wf').textContent     = fmt2(prevWeekWF) + '%';
  document.getElementById('kpi-tw-wf').textContent     = fmt2(thisWeekWF) + '%';
  document.getElementById('kpi-progress').textContent  = fmt1(progressPct) + '%';
  document.getElementById('kpi-prev-week').textContent = fmt1(prevWeekPct) + '%';
  document.getElementById('kpi-this-week').textContent = fmt1(thisWeekPct) + '%';
  document.getElementById('kpi-act-prev').textContent = actPrevCount.toLocaleString();
  document.getElementById('kpi-act-this').textContent = actThisCount.toLocaleString();
  document.getElementById('kpi-act-new').textContent  = actNewCount.toLocaleString();
}

// ── Table ───────────────────────────────────────────────────
const PROG_DASH = '<span class="prog-dash">-</span>';

function renderTable(data, startIndex = 0) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  let seqNo = startIndex;
  for (const act of data) {
    seqNo++;
    const p = progressMap[act.activity_id] || {};

    const prevWk    = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : null;
    const thisWk    = p.this_week_qty != null ? parseFloat(p.this_week_qty) : null;
    const completed = (prevWk != null || thisWk != null) ? (prevWk || 0) + (thisWk || 0) : null;

    const blockLabel = fmtBlock(act.unit_no);
    const cls        = `unit-${act.unit_no}`;
    const ut         = act.unit_type || '';
    const unitOpts   = ['DI', '%'].map(v =>
      `<option value="${v}"${ut === v ? ' selected' : ''}>${v}</option>`
    ).join('');

    const startVal  = toISODate(p.actual_start);
    const finishVal = toISODate(p.actual_finish);
    const wf        = act.weight_factor != null
      ? (parseFloat(act.weight_factor) * 100).toFixed(4)
      : '-';
    const level = act.wbs_level ?? 9;

    const tr = document.createElement('tr');
    tr.dataset.id = act.activity_id;
    tr.innerHTML = `
      <td class="td-seq">${seqNo}</td>
      <td>${level}</td>
      <td><span class="unit-badge ${cls}">${blockLabel}</span></td>
      <td>${act.department || '-'}</td>
      <td class="td-id">${act.activity_id || '-'}</td>
      <td class="td-name">${act.activity_name || '-'}</td>
      <td class="td-weight">${wf}</td>
      <td><input type="date" class="date-input${startVal ? ' has-val' : ''}"
            data-id="${act.activity_id}" data-field="actual_start" value="${startVal}"></td>
      <td><input type="date" class="date-input${finishVal ? ' has-val' : ''}"
            data-id="${act.activity_id}" data-field="actual_finish" value="${finishVal}"></td>
      <td><select class="unit-select" data-id="${act.activity_id}"><option value=""></option>${unitOpts}</select></td>
      <td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="budgeted_units" data-table="activities" value="${act.budgeted_units ?? ''}"></td>
      <td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="prev_week_qty"  data-table="progress"    value="${prevWk  ?? ''}"></td>
      <td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="this_week_qty"  data-table="progress"    value="${thisWk  ?? ''}"></td>
      <td class="completed-cell">${fmtNum(completed, 1)}</td>
      <td class="remaining-cell">-</td>
      <td class="progress-cell">${PROG_DASH}</td>
      <td class="status-cell"></td>
      <td><input type="text" class="remark-input" data-id="${act.activity_id}" placeholder=""></td>
    `;
    tbody.appendChild(tr);
    recalcRow(tr);
  }
}

// ── Auto-recalc row ──────────────────────────────────────────
function recalcRow(tr) {
  const totalQty = parseFloat(tr.querySelector('[data-field="budgeted_units"]')?.value) || null;
  const prev     = parseFloat(tr.querySelector('[data-field="prev_week_qty"]')?.value)  || null;
  const thisWk   = parseFloat(tr.querySelector('[data-field="this_week_qty"]')?.value)  || null;

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

  const statusCell = tr.querySelector('.status-cell');
  if (statusCell) {
    let statusKey, statusLabel;
    if (completed == null || completed <= 0) {
      statusKey = 'not-start'; statusLabel = 'Not Start';
    } else if (totalQty && totalQty > 0 && completed >= totalQty) {
      statusKey = 'completed'; statusLabel = 'Completed';
    } else {
      statusKey = 'ongoing'; statusLabel = 'Ongoing';
    }
    statusCell.innerHTML = `<span class="status-badge status-${statusKey}">${statusLabel}</span>`;
  }
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
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
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
  selectedUnit = e.target.value;
  currentPage = 1;
  const filtered = allActivities.filter(a =>
    (!selectedUnit       || a.unit_no    === selectedUnit) &&
    (!selectedDiscipline || a.department === selectedDiscipline)
  );
  updateActivityIdDropdown(filtered);
  render();
});
document.getElementById('discipline-filter').addEventListener('change', e => {
  selectedDiscipline = e.target.value;
  currentPage = 1;
  const filtered = allActivities.filter(a =>
    (!selectedUnit       || a.unit_no    === selectedUnit) &&
    (!selectedDiscipline || a.department === selectedDiscipline)
  );
  updateActivityIdDropdown(filtered);
  render();
});
document.getElementById('activity-id-filter').addEventListener('change', e => {
  selectedActivity = e.target.value; currentPage = 1; render();
});
document.getElementById('status-filter').addEventListener('change', e => {
  selectedStatus = e.target.value; currentPage = 1; render();
});

document.getElementById('pagination').addEventListener('click', e => {
  const btn = e.target.closest('.pag-btn');
  if (!btn || btn.disabled) return;
  currentPage = parseInt(btn.dataset.page);
  render();
  document.getElementById('table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('table-body').addEventListener('change', async e => {
  if (e.target.classList.contains('date-input')) {
    const input      = e.target;
    const activityId = input.dataset.id;
    const field      = input.dataset.field;
    const value      = input.value || null;
    input.classList.toggle('has-val', !!value);
    if (progressMap[activityId]) progressMap[activityId][field] = value;
    try {
      await fetch(`/api/progress/${encodeURIComponent(activityId)}/dates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      input.classList.add('saved');
      setTimeout(() => input.classList.remove('saved'), 1200);
    } catch (err) { console.error('날짜 저장 실패:', err); }
    return;
  }
  if (e.target.classList.contains('qty-input')) {
    recalcRow(e.target.closest('tr'));
    return;
  }
  if (!e.target.classList.contains('unit-select')) return;
  const sel        = e.target;
  const tr         = sel.closest('tr');
  const activityId = sel.dataset.id;
  const unitType   = sel.value;
  const act = allActivities.find(a => a.activity_id === activityId);
  if (act) act.unit_type = unitType;

  if (unitType === '%') {
    const totalQtyInp = tr.querySelector('[data-field="budgeted_units"]');
    if (totalQtyInp && !totalQtyInp.value) {
      totalQtyInp.value = 100;
      if (act) act.budgeted_units = 100;
      recalcRow(tr);
    }
  }

  try {
    const saves = [
      fetch(`/api/activities/${encodeURIComponent(activityId)}/unit_type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_type: unitType }),
      }),
    ];
    if (unitType === '%') {
      saves.push(fetch('/api/save_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities: [{ activity_id: activityId, budgeted_units: 100 }], progress: [] }),
      }));
    }
    await Promise.all(saves);
    sel.classList.add('saved');
    setTimeout(() => sel.classList.remove('saved'), 1200);
  } catch (err) { console.error('unit_type 저장 실패:', err); }
});

// ── Save (batch) ────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-btn');
  btn.textContent = '저장 중...'; btn.disabled = true;

  // 기존 최신 report_date 또는 오늘 날짜
  const reportDate = allProgress.reduce((max, p) =>
    (!max || p.report_date > max) ? p.report_date : max, null
  ) || new Date().toISOString().slice(0, 10);

  const rows = document.querySelectorAll('#table-body tr');
  const actMap = {}, progMap = {};

  rows.forEach(tr => {
    const id = tr.dataset.id;
    if (!id) return;

    const unitSel = tr.querySelector('.unit-select');
    if (!actMap[id]) actMap[id] = { activity_id: id };
    if (unitSel) actMap[id].unit_type = unitSel.value || null;

    const startInp  = tr.querySelector('[data-field="actual_start"]');
    const finishInp = tr.querySelector('[data-field="actual_finish"]');
    if (!progMap[id]) progMap[id] = { activity_id: id };
    progMap[id].report_date   = progressMap[id]?.report_date || reportDate;
    progMap[id].actual_start  = startInp?.value  || null;
    progMap[id].actual_finish = finishInp?.value || null;

    tr.querySelectorAll('.qty-input').forEach(inp => {
      const field = inp.dataset.field;
      const val   = inp.type === 'number'
        ? (inp.value !== '' ? parseFloat(inp.value) : null)
        : (inp.value || null);
      if (inp.dataset.table === 'activities') actMap[id][field] = val;
      else progMap[id][field] = val;
    });
  });

  // 실제 변경값이 있는 항목만 전송
  const actList  = Object.values(actMap).filter(a =>
    Object.entries(a).some(([k, v]) => k !== 'activity_id' && v !== null)
  );
  const progList = Object.values(progMap).filter(p =>
    p.prev_week_qty != null || p.this_week_qty != null ||
    p.actual_start  != null || p.actual_finish != null
  );

  try {
    await fetch('/api/save_batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: actList, progress: progList }),
    });

    // 메모리 내 progressMap·allActivities 즉시 갱신
    Object.values(progMap).forEach(p => {
      const id = p.activity_id;
      if (!progressMap[id]) progressMap[id] = { activity_id: id };
      Object.assign(progressMap[id], p);
    });
    Object.values(actMap).forEach(a => {
      const act = allActivities.find(x => x.activity_id === a.activity_id);
      if (act) Object.assign(act, a);
    });

    renderKPIs(allActivities);

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

    const data = getFiltered();
    const rows = data.map((act, idx) => {
      const p      = progressMap[act.activity_id] || {};
      const prevWk = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : null;
      const thisWk = p.this_week_qty != null ? parseFloat(p.this_week_qty) : null;
      const totalQ = (act.budgeted_units != null && parseFloat(act.budgeted_units) > 0)
        ? parseFloat(act.budgeted_units) : null;
      const compQ  = (prevWk != null || thisWk != null) ? (prevWk || 0) + (thisWk || 0) : null;
      const remQ   = (totalQ != null && compQ != null) ? totalQ - compQ : null;
      const pct    = (totalQ && totalQ > 0 && compQ != null)
        ? Math.min(100, (compQ / totalQ) * 100) : null;
      const wf     = act.weight_factor != null ? parseFloat(act.weight_factor) : null;

      let statusLabel = 'Not Start';
      if (compQ != null && compQ > 0) {
        statusLabel = (totalQ && compQ >= totalQ) ? 'Completed' : 'Ongoing';
      }

      return [
        idx + 1,
        act.wbs_level ?? 9,
        fmtBlock(act.unit_no),
        act.department || '',
        act.activity_id   || '',
        act.activity_name || '',
        wf != null ? (wf * 100).toFixed(4) : '',
        toISODate(p.actual_start)  || '',
        toISODate(p.actual_finish) || '',
        act.unit_type || '',
        totalQ != null ? totalQ : '',
        prevWk != null ? prevWk : '',
        thisWk != null ? thisWk : '',
        compQ  != null ? compQ  : '',
        remQ   != null ? remQ   : '',
        pct    != null ? pct.toFixed(1) + '%' : '',
        statusLabel,
        '',  // Remark
      ];
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 4 ? 42 : i === 5 ? 32 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, 'PMS Schedule');
    XLSX.writeFile(wb, `PMS_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);

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
  renderTable(getFiltered(), 0);
  setTimeout(() => {
    window.print();
    setTimeout(() => render(), 500);
  }, 150);
});

// ── Activity KPI 클릭 필터 ──────────────────────────────────
['act-prev', 'act-this', 'act-new'].forEach(key => {
  const card = document.getElementById(`kpi-card-${key}`);
  if (!card) return;
  card.addEventListener('click', () => {
    const type = key.replace('act-', '');
    selectedKpiAct = (selectedKpiAct === type) ? '' : type;
    ['act-prev', 'act-this', 'act-new'].forEach(k => {
      document.getElementById(`kpi-card-${k}`)
        ?.classList.toggle('kpi-active', k.replace('act-', '') === selectedKpiAct);
    });
    currentPage = 1;
    render();
  });
});

// ── Init ────────────────────────────────────────────────────
loadData();
