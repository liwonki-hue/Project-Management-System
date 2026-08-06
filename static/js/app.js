// PMS Dashboard — main frontend logic
let allActivities = [];
let allProgress   = [];
let progressMap   = {};
let kpiState      = {};

let searchText         = '';
let selectedUnit       = '';
let selectedArea       = '';
let selectedDiscipline = '';
let selectedActivity   = '';
let selectedStatus     = '';   // '' | 'not-start' | 'ongoing' | 'completed'
let selectedKpiAct     = '';   // '' | 'prev' | 'this' | 'new'

let activeTab  = 'overview';
let reportMode = false;
const DISC_TABS = { mech: 'MECH', piping: 'PIPING', hvac: 'HVAC', ff: 'FF' };

const PAGE_SIZE = 20;
let currentPage = 1;

const PROG_FIELDS = ['actual_start', 'actual_finish'];

// 목~수 주간에서 해당 주의 수요일(마감일) 반환 (YYYY-MM-DD, 로컬 날짜 기준)
function getWeekWednesday(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + (3 - d.getDay() + 7) % 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 해당 주의 목요일(시작일) 반환 (YYYY-MM-DD)
function getWeekThursday(wedDate) {
  const d = new Date(wedDate);
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

// 로컬 타임존 기준 오늘 날짜 (YYYY-MM-DD) — toISOString()은 UTC 변환으로 날짜가 밀릴 수 있어 사용 금지
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 이번 주(목~수) 7일의 ISO 날짜 배열 반환
function getCurrentWeekDates() {
  const wed = getWeekWednesday(new Date());
  const thu = getWeekThursday(wed);
  const dates = [];
  const d = new Date(thu + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// 날짜를 "MM/DD(요일)" 포맷으로 반환
function fmtWeekDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}(${days[d.getDay()]})`;
}

function updateWeekRangeLabel() {
  const wed = getWeekWednesday(new Date());
  const thu = getWeekThursday(wed);
  const label = `${fmtWeekDate(thu)} ~ ${fmtWeekDate(wed)}`;
  document.querySelectorAll('.kpi-week-range').forEach(el => { el.textContent = label; });
}

function valChanged(cur, orig) {
  const a = (cur == null || cur === '') ? null : String(cur);
  const b = (orig == null || orig === '') ? null : String(orig);
  return a !== b;
}

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
  loading.textContent     = 'JM 데이터 동기화 중...';
  tableWrap.style.display = 'none';

  try {
    await fetch('/api/sync_jm', { method: 'POST' });
  } catch (err) {
    console.error('JM 동기화 실패, 기존 데이터로 계속 진행:', err);
  }

  loading.textContent = 'Loading data...';

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
  renderOverview();
  updateWeekRangeLabel();

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

  updateAreaDropdown(allActivities);
  updateActivityIdDropdown(allActivities);
}

function updateAreaDropdown(activities) {
  const areaSel = document.getElementById('area-filter');
  const prev    = areaSel.value;
  const areas   = [...new Set(activities.map(a => a.area_system).filter(Boolean))].sort();
  areaSel.innerHTML = '<option value="">All</option>';
  areas.forEach(a => {
    const o = document.createElement('option');
    o.value = a; o.textContent = a.toUpperCase();
    areaSel.appendChild(o);
  });
  areaSel.value = areas.includes(prev) ? prev : '';
  if (areaSel.value !== prev) selectedArea = '';
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
    if (selectedUnit       && act.unit_no    !== selectedUnit)           return false;
    if (selectedArea       && (act.area_system || '') !== selectedArea)  return false;
    if (selectedDiscipline && act.department !== selectedDiscipline)     return false;
    if (selectedActivity   && act.activity_id !== selectedActivity)      return false;
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
  renderTable(pageData, (currentPage - 1) * PAGE_SIZE, reportMode);
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
    const compQ  = prevWk + thisWk;

    weightSum += wf;
    if (prevWk > 0) actPrevCount++;
    if (thisWk > 0) actThisCount++;
    if (thisWk > 0 && prevWk === 0) actNewCount++;

    if (wf > 0) {
      progressPct += wf * Math.min(1, compQ  / totalQ) * 100;
      prevWeekPct += wf * Math.min(1, prevWk / totalQ) * 100;
      thisWeekPct += wf * Math.min(1, thisWk / totalQ) * 100;
    }
  }

  const fmt2 = v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt3 = v => v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const weightPct = weightSum * 100;

  const progressRatePct = weightPct > 0 ? progressPct / weightPct * 100 : 0;
  const prevWeekRatePct = weightPct > 0 ? prevWeekPct / weightPct * 100 : 0;
  const thisWeekRatePct = weightPct > 0 ? thisWeekPct / weightPct * 100 : 0;

  kpiState = { weightPct, progressPct, prevWeekPct, thisWeekPct, progressRatePct, prevWeekRatePct, thisWeekRatePct };

  document.getElementById('kpi-weight-lbl').textContent   = fmt2(weightPct) + '%';
  document.getElementById('kpi-prog-lbl').textContent     = '100%';
  document.getElementById('kpi-act-lbl').textContent      = allActivities.length.toLocaleString();
  document.getElementById('kpi-pw-wf').textContent        = fmt3(prevWeekPct) + '%';
  document.getElementById('kpi-tw-wf').textContent        = fmt3(thisWeekPct) + '%';
  document.getElementById('kpi-wf-completed').textContent = fmt3(progressPct) + '%';
  document.getElementById('kpi-progress').textContent  = fmt3(progressRatePct) + '%';
  document.getElementById('kpi-prev-week').textContent = fmt3(prevWeekRatePct) + '%';
  document.getElementById('kpi-this-week').textContent = fmt3(thisWeekRatePct) + '%';
  document.getElementById('kpi-act-prev').textContent = actPrevCount.toLocaleString();
  document.getElementById('kpi-act-this').textContent = actThisCount.toLocaleString();
  document.getElementById('kpi-act-new').textContent  = actNewCount.toLocaleString();
}

// ── Table ───────────────────────────────────────────────────
const PROG_DASH = '<span class="prog-dash">-</span>';

function renderTable(data, startIndex = 0, readOnly = false) {
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
    const unitOpts   = ['DI', '%', 'EA'].map(v =>
      `<option value="${v}"${ut === v ? ' selected' : ''}>${v}</option>`
    ).join('');

    const startVal  = toISODate(p.actual_start);
    const finishVal = toISODate(p.actual_finish);
    const wf        = act.weight_factor != null
      ? (parseFloat(act.weight_factor) * 100).toFixed(4)
      : '-';
    const level = act.wbs_level ?? 9;
    const totalQ = act.budgeted_units != null ? parseFloat(act.budgeted_units) : null;
    const remaining = (totalQ != null && completed != null) ? totalQ - completed : null;
    const pct = (totalQ && totalQ > 0 && completed != null)
      ? Math.min(100, (completed / totalQ) * 100) : null;
    let initStatusKey = 'not-start', initStatusLabel = 'Not Start';
    if (completed != null && completed > 0) {
      if (totalQ && totalQ > 0 && completed >= totalQ) {
        initStatusKey = 'completed'; initStatusLabel = 'Completed';
      } else {
        initStatusKey = 'ongoing'; initStatusLabel = 'Ongoing';
      }
    }

    const areaVal  = act.area_system ? act.area_system.toUpperCase() : '-';
    const areaCell = `<td style="text-align:center">${areaVal}</td>`;
    const startCell = readOnly
      ? `<td>${startVal || '-'}</td>`
      : `<td><input type="date" class="date-input${startVal ? ' has-val' : ''}" data-id="${act.activity_id}" data-field="actual_start" value="${startVal}"></td>`;
    const finishCell = readOnly
      ? `<td>${finishVal || '-'}</td>`
      : `<td><input type="date" class="date-input${finishVal ? ' has-val' : ''}" data-id="${act.activity_id}" data-field="actual_finish" value="${finishVal}"></td>`;
    const unitCell = readOnly
      ? `<td>${ut || '-'}</td>`
      : `<td><select class="unit-select" data-id="${act.activity_id}"><option value=""></option>${unitOpts}</select></td>`;
    const totalCell = readOnly
      ? `<td>${act.budgeted_units != null ? Math.round(act.budgeted_units).toLocaleString() : '-'}</td>`
      : `<td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="budgeted_units" data-table="activities" value="${act.budgeted_units != null ? Math.round(act.budgeted_units) : ''}"></td>`;
    const prevCell = `<td class="prev-cell">${prevWk != null && prevWk > 0 ? Math.round(prevWk).toLocaleString() : '-'}</td>`;
    const thisCell = `<td class="this-cell">${thisWk != null && thisWk > 0 ? Math.round(thisWk).toLocaleString() : '-'}</td>`;

    const tr = document.createElement('tr');
    tr.dataset.id = act.activity_id;
    tr.innerHTML = `
      <td class="td-expand"><button type="button" class="expand-btn" data-id="${act.activity_id}">&#9656;</button></td>
      <td class="td-seq">${seqNo}</td>
      <td>${level}</td>
      <td><span class="unit-badge ${cls}">${blockLabel}</span></td>
      <td>${act.department || '-'}</td>
      ${areaCell}
      <td class="td-id">${act.activity_id || '-'}</td>
      <td class="td-name">${act.activity_name || '-'}</td>
      <td class="td-weight">${wf}</td>
      ${startCell}
      ${finishCell}
      ${unitCell}
      ${totalCell}
      ${prevCell}
      ${thisCell}
      <td class="completed-cell">${completed != null ? Math.round(completed).toLocaleString() : '-'}</td>
      <td class="remaining-cell">${remaining != null ? Math.round(remaining).toLocaleString() : '-'}</td>
      <td class="progress-cell">${pct != null ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div><span class="progress-text">${pct.toFixed(1)}%</span>` : PROG_DASH}</td>
      <td class="status-cell"><span class="status-badge status-${initStatusKey}">${initStatusLabel}</span></td>
    `;
    tbody.appendChild(tr);
    recalcRow(tr);
  }
}

// ── Auto-recalc row ──────────────────────────────────────────
function recalcRow(tr) {
  if (!tr.querySelector('[data-field="budgeted_units"]')) return;
  const id = tr.dataset.id;
  const p  = progressMap[id] || {};
  const totalQty = parseFloat(tr.querySelector('[data-field="budgeted_units"]')?.value) || null;
  const prev     = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : null;
  const thisWk   = p.this_week_qty != null ? parseFloat(p.this_week_qty) : null;

  const completed = (prev != null || thisWk != null) ? (prev || 0) + (thisWk || 0) : null;
  const remaining = (totalQty != null && completed != null) ? totalQty - completed : null;
  const pct       = (totalQty && totalQty > 0 && completed != null)
    ? Math.min(100, (completed / totalQty) * 100) : null;

  const fmt = v => v != null ? Math.round(v).toLocaleString() : '-';
  tr.querySelector('.prev-cell').textContent      = fmt(prev);
  tr.querySelector('.this-cell').textContent      = fmt(thisWk);
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

// ── Daily Breakdown ─────────────────────────────────────────
function buildDailyTableHtml(dates, breakdown, editableDate) {
  const headerCells = dates.map(d => `<th>${fmtWeekDate(d)}</th>`).join('');
  const bodyCells = dates.map(d => {
    const raw = breakdown[d];
    const val = raw != null ? Math.round(parseFloat(raw)) : '';
    if (d === editableDate) {
      return `<td><input type="number" class="daily-input" data-date="${d}" value="${val}"></td>`;
    }
    return `<td>${val !== '' ? val.toLocaleString() : '-'}</td>`;
  }).join('');
  return `<div class="daily-breakdown-wrap"><table class="daily-table">
    <thead><tr>${headerCells}</tr></thead>
    <tbody><tr>${bodyCells}</tr></tbody>
  </table></div>`;
}

function renderManualDailyDetail(activityId) {
  const dates      = getCurrentWeekDates();
  const reportDate = getWeekWednesday(new Date());
  const p          = progressMap[activityId];
  const isCurrentWeek = !!p && p.report_date === reportDate;
  const breakdown  = (isCurrentWeek && p.daily_breakdown) ? p.daily_breakdown : {};
  const todayStr   = todayISO();
  return buildDailyTableHtml(dates, breakdown, todayStr);
}

async function renderPipingDailyDetail(activityId) {
  const dates = getCurrentWeekDates();
  try {
    const res = await fetch(`/api/jm_daily/${encodeURIComponent(activityId)}`);
    const breakdown = res.ok ? await res.json() : {};
    return buildDailyTableHtml(dates, breakdown, null);
  } catch (err) {
    console.error('JM 일자별 조회 실패:', err);
    return buildDailyTableHtml(dates, {}, null);
  }
}

async function saveDailyEntry(activityId, qty) {
  const todayStr   = todayISO();
  const reportDate = getWeekWednesday(new Date());
  const existing   = progressMap[activityId];
  const isCurrentWeek = !!existing && existing.report_date === reportDate;

  const breakdown = isCurrentWeek ? { ...(existing.daily_breakdown || {}) } : {};
  breakdown[todayStr] = qty;
  const thisWeekQty = Object.values(breakdown).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

  const prevWeekQty = isCurrentWeek
    ? (existing.prev_week_qty != null ? parseFloat(existing.prev_week_qty) : 0)
    : ((existing?.prev_week_qty != null ? parseFloat(existing.prev_week_qty) : 0) +
       (existing?.this_week_qty != null ? parseFloat(existing.this_week_qty) : 0));

  const progRecord = {
    activity_id:     activityId,
    report_date:     reportDate,
    exists_in_db:    isCurrentWeek,
    prev_week_qty:   prevWeekQty,
    this_week_qty:   thisWeekQty,
    daily_breakdown: breakdown,
    ...(isCurrentWeek ? {} : {
      actual_start:  existing?.actual_start  ?? null,
      actual_finish: existing?.actual_finish ?? null,
    }),
  };

  const res = await fetch('/api/save_batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activities: [], progress: [progRecord] }),
  });
  if (!res.ok) throw new Error(`save_batch HTTP ${res.status}`);

  progressMap[activityId] = {
    ...(existing || {}),
    report_date:     reportDate,
    prev_week_qty:   prevWeekQty,
    this_week_qty:   thisWeekQty,
    daily_breakdown: breakdown,
    ...(isCurrentWeek ? {} : {
      actual_start:  existing?.actual_start  ?? null,
      actual_finish: existing?.actual_finish ?? null,
    }),
  };
  return progressMap[activityId];
}

// ── Util ────────────────────────────────────────────────────
function toISODate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
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
  selectedArea = '';
  currentPage = 1;
  const byBlock = allActivities.filter(a => !selectedUnit || a.unit_no === selectedUnit);
  updateAreaDropdown(byBlock);
  const filtered = byBlock.filter(a => !selectedDiscipline || a.department === selectedDiscipline);
  updateActivityIdDropdown(filtered);
  render();
});
document.getElementById('area-filter').addEventListener('change', e => {
  selectedArea = e.target.value;
  currentPage = 1;
  const filtered = allActivities.filter(a =>
    (!selectedUnit       || a.unit_no      === selectedUnit) &&
    (!selectedArea       || (a.area_system || '') === selectedArea) &&
    (!selectedDiscipline || a.department   === selectedDiscipline)
  );
  updateActivityIdDropdown(filtered);
  render();
});
document.getElementById('discipline-filter').addEventListener('change', e => {
  selectedDiscipline = e.target.value;
  currentPage = 1;
  const filtered = allActivities.filter(a =>
    (!selectedUnit       || a.unit_no      === selectedUnit) &&
    (!selectedArea       || (a.area_system || '') === selectedArea) &&
    (!selectedDiscipline || a.department   === selectedDiscipline)
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
  if (e.target.classList.contains('daily-input')) {
    const input = e.target;
    const detailTr = input.closest('tr.detail-row');
    const activityTr = detailTr.previousElementSibling;
    const activityId = activityTr.dataset.id;
    const qty = input.value !== '' ? parseFloat(input.value) : 0;

    input.disabled = true;
    try {
      await saveDailyEntry(activityId, qty);
      recalcRow(activityTr);
      input.classList.add('saved');
      setTimeout(() => input.classList.remove('saved'), 1200);
    } catch (err) {
      console.error('일자별 저장 실패:', err);
      alert('저장에 실패했습니다: ' + err.message);
    } finally {
      input.disabled = false;
    }
    return;
  }
  if (e.target.classList.contains('date-input')) {
    const input      = e.target;
    const activityId = input.dataset.id;
    const field      = input.dataset.field;
    const value      = input.value || null;
    const prev       = progressMap[activityId]?.[field] || null;
    if (!valChanged(value, prev)) return;
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

document.getElementById('table-body').addEventListener('click', async e => {
  const btn = e.target.closest('.expand-btn');
  if (!btn) return;

  const tr = btn.closest('tr');
  const activityId = btn.dataset.id;
  const next = tr.nextElementSibling;
  const existingDetail = (next && next.classList.contains('detail-row')) ? next : null;

  if (existingDetail) {
    const show = existingDetail.style.display === 'none';
    existingDetail.style.display = show ? '' : 'none';
    btn.innerHTML = show ? '&#9662;' : '&#9656;';
    return;
  }

  btn.innerHTML = '&#9662;';
  const colCount = tr.children.length;
  const detailTr = document.createElement('tr');
  detailTr.className = 'detail-row';
  detailTr.innerHTML = `<td colspan="${colCount}"><div class="daily-breakdown-wrap">불러오는 중...</div></td>`;
  tr.after(detailTr);

  const act = allActivities.find(a => a.activity_id === activityId);
  const isPiping = act && act.department === 'PIPING';
  const html = isPiping
    ? await renderPipingDailyDetail(activityId)
    : renderManualDailyDetail(activityId);
  detailTr.querySelector('td').innerHTML = html;
});

// ── Save (batch) ────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-btn');
  btn.textContent = '저장 중...'; btn.disabled = true;

  // 이번 주(목~수) 수요일을 report_date로 고정 (같은 주에 여러 번 저장해도 동일 날짜)
  const reportDate = getWeekWednesday(new Date());

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
    progMap[id].exists_in_db  = !!progressMap[id];
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

  // DB 원본값과 다른 항목만 전송
  const actLookup = Object.fromEntries(allActivities.map(a => [a.activity_id, a]));
  const actList = Object.values(actMap).filter(a => {
    const orig = actLookup[a.activity_id] || {};
    return Object.entries(a).some(([k, v]) =>
      k !== 'activity_id' && valChanged(v, orig[k])
    );
  });

  const progList = Object.values(progMap).filter(p => {
    const orig = progressMap[p.activity_id];
    if (!orig) {
      return PROG_FIELDS.some(f => p[f] != null);
    }
    return PROG_FIELDS.some(f => valChanged(p[f], orig[f]));
  });

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
      const { exists_in_db, ...rest } = p;
      Object.assign(progressMap[id], rest);
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

    const thList = [...document.querySelectorAll('#activity-table th')].filter(th => !th.classList.contains('col-expand'));
    const visibleIdx = thList
      .map((th, i) => getComputedStyle(th).display !== 'none' ? i : null)
      .filter(i => i !== null);
    const headers = thList
      .filter((_, i) => visibleIdx.includes(i))
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

      const fullRow = [
        idx + 1,
        act.wbs_level ?? 9,
        fmtBlock(act.unit_no),
        act.department || '',
        act.area_system ? act.area_system.toUpperCase() : '',
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
      ];
      return fullRow.filter((_, i) => visibleIdx.includes(i));
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 6 ? 42 : i === 5 ? 20 : i === 4 ? 15 : 14 }));
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
  renderTable(getFiltered(), 0, reportMode);
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

// ── Overview ─────────────────────────────────────────────────
let _chartWeight = null;
let _chartProg   = null;
let _chartDisc   = null;

function renderOverview() {
  const f2 = v => (v||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f3 = v => (v||0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // byDisc 먼저 계산 (차트 + 테이블 공용)
  const byDisc = {};
  for (const act of allActivities) {
    const disc = act.department || '(None)';
    const p    = progressMap[act.activity_id] || {};
    const wf   = parseFloat(act.weight_factor || 0);
    const tq   = (act.budgeted_units != null && parseFloat(act.budgeted_units) > 0)
                  ? parseFloat(act.budgeted_units) : 100;
    const pw   = parseFloat(p.prev_week_qty || 0);
    const tw   = parseFloat(p.this_week_qty || 0);
    const cq   = pw + tw;
    if (!byDisc[disc]) byDisc[disc] = {wf:0,prog:0,prev:0,this_:0};
    byDisc[disc].wf       += wf;
    byDisc[disc].prog     += wf * Math.min(1, cq / tq);
    byDisc[disc].prev     += wf * Math.min(1, pw / tq);
    byDisc[disc].this_    += wf * Math.min(1, tw / tq);
  }

  // ── 1. Charts ─────────────────────────────────────────────
  const prog      = kpiState.progressPct || 0;
  const thisWk    = kpiState.thisWeekPct || 0;
  const weightPct = kpiState.weightPct   || 0;
  const prevAcc   = Math.max(0, prog - thisWk);

  // Chart 1: Project Weight 기준 (합계 = weightPct)
  const wRemain = Math.max(0, weightPct - prog);
  if (_chartWeight) _chartWeight.destroy();
  _chartWeight = new Chart(document.getElementById('chart-weight'), {
    type: 'doughnut',
    data: {
      labels: ['Completed', 'This Week', 'Remaining'],
      datasets: [{ data: [+prevAcc.toFixed(3), +thisWk.toFixed(3), +wRemain.toFixed(3)],
        backgroundColor: ['#3b82f6','#22c55e','#e5e7eb'], borderWidth: 0 }]
    },
    options: { cutout: '72%', plugins: { legend:{display:false}, tooltip:{callbacks:{label: c=>`${c.label}: ${c.formattedValue}%`}} } }
  });
  document.getElementById('ov-wf-center').textContent = f3(prog) + '%';

  // Chart 2: Progress — weight 가중평균(Project Weight 합=100% 재정규화) 기준.
  // Discipline Summary 테이블·Discipline Progress 차트와 동일한 산식.
  // Completed = Prev Week + This Week 누적 합계(실제 완료 총량)
  const chartProgress = kpiState.progressRatePct || 0;
  const chartRemain   = Math.max(0, 100 - chartProgress);
  if (_chartProg) _chartProg.destroy();
  _chartProg = new Chart(document.getElementById('chart-progress'), {
    type: 'doughnut',
    data: {
      labels: ['Completed', 'Remaining'],
      datasets: [{ data: [+chartProgress.toFixed(3), +chartRemain.toFixed(3)],
        backgroundColor: ['#3b82f6','#e5e7eb'], borderWidth: 0 }]
    },
    options: { cutout: '72%', plugins: { legend:{display:false}, tooltip:{callbacks:{label: c=>`${c.label}: ${c.formattedValue}%`}} } }
  });
  document.getElementById('ov-prog-center').textContent = f3(chartProgress) + '%';

  // Discipline chart — discipline당 세로 막대 2개(나란히).
  // 4개 discipline의 weight 합(18.88%)을 100%로 재정규화 — 이 4개 discipline 전체가
  // "Project Total 100%"가 되도록 함.
  // 파란 막대: 이 discipline이 (재정규화된) Project Total에서 차지하는 비중
  // 초록 막대: 같은 기준으로 본 Completed(Prev Week + This Week 합계) 달성분
  const DISC_ORDER  = { 'MECH': 0, 'PIPING': 1, 'HVAC': 2, 'FF': 3 };
  const discEntries = Object.entries(byDisc).sort((a, b) => (DISC_ORDER[a[0]] ?? 99) - (DISC_ORDER[b[0]] ?? 99));
  const totalDiscWf  = discEntries.reduce((s, [,g]) => s + g.wf, 0) || 1;
  const discLabels    = discEntries.map(([d]) => d === 'MECH' ? 'BOP MECH' : d);
  const discWeightAbs = discEntries.map(([,g]) => +(g.wf              / totalDiscWf * 100).toFixed(3));
  const discCompAbs   = discEntries.map(([,g]) => +((g.prev + g.this_) / totalDiscWf * 100).toFixed(3));
  const maxBarPct     = Math.max(...discWeightAbs, ...discCompAbs, 0.01);

  if (_chartDisc) _chartDisc.destroy();
  _chartDisc = new Chart(document.getElementById('chart-discipline'), {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: discLabels,
      datasets: [
        { label: 'Project Weight (%)', data: discWeightAbs, backgroundColor: '#3b82f6', barPercentage: 0.6, categoryPercentage: 1.0 },
        { label: 'Completed (%)',      data: discCompAbs,   backgroundColor: '#22c55e', barPercentage: 0.6, categoryPercentage: 1.0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxRotation: 40, font: { size: 10 } }, grid: { display: false } },
        y: {
          max: Math.ceil(maxBarPct * 1.3),
          ticks: { callback: v => v.toFixed(1) + '%', font: { size: 10 } },
          grid: { color: '#f0f0f0' }
        }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.formattedValue}%`
          }
        },
        datalabels: {
          display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0.01,
          anchor: 'end',
          align: 'top',
          formatter: (v) => v.toFixed(3) + '%',
          font: { size: 9, weight: '600' },
          color: ctx => ['#2563eb', '#15803d'][ctx.datasetIndex],
          offset: 2
        }
      }
    }
  });

  // ── 2. Discipline Summary ──────────────────────────────────
  // PROGRESS 그룹은 차트와 동일하게 4개 discipline weight 합=100% 기준으로 재정규화.
  // Progress(=비중) / Completed(=Prev+This) / Prev Week / This Week 순서로 표시.
  const discBody = document.getElementById('ov-disc-body');
  discBody.innerHTML = '';
  let tWf=0, tProg=0, tPrev=0, tThis=0;
  for (const [disc, g] of discEntries) {
    const normProg = g.wf   / totalDiscWf * 100;
    const normComp = (g.prev + g.this_) / totalDiscWf * 100;
    const normPrev = g.prev / totalDiscWf * 100;
    const normThis = g.this_/ totalDiscWf * 100;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${disc === 'MECH' ? 'BOP MECH' : disc}</td>
      <td>${f2(g.wf*100)}%</td><td>${f3(g.prog*100)}%</td><td>${f3(g.prev*100)}%</td><td>${f3(g.this_*100)}%</td>
      <td>${f3(normProg)}%</td><td>${f3(normComp)}%</td><td>${f3(normPrev)}%</td><td>${f3(normThis)}%</td>`;
    discBody.appendChild(tr);
    tWf+=g.wf; tProg+=g.prog; tPrev+=g.prev; tThis+=g.this_;
  }
  const tf = document.createElement('tr');
  tf.className = 'ov-total';
  const tNormProg = tWf   / totalDiscWf * 100;
  const tNormComp = (tPrev + tThis) / totalDiscWf * 100;
  const tNormPrev = tPrev / totalDiscWf * 100;
  const tNormThis = tThis / totalDiscWf * 100;
  tf.innerHTML = `<td>Total</td>
    <td>${f2(tWf*100)}%</td><td>${f3(tProg*100)}%</td><td>${f3(tPrev*100)}%</td><td>${f3(tThis*100)}%</td>
    <td>${f3(tNormProg)}%</td><td>${f3(tNormComp)}%</td><td>${f3(tNormPrev)}%</td><td>${f3(tNormThis)}%</td>`;
  discBody.appendChild(tf);

  // ── 3. Activity Tables ─────────────────────────────────────
  function buildActTable(tbodyId, filterFn) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    const list = allActivities
      .filter(filterFn)
      .sort((a,b) => parseFloat(progressMap[b.activity_id]?.this_week_qty||0)
                   - parseFloat(progressMap[a.activity_id]?.this_week_qty||0))
      .slice(0, 5);

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="color:#aaa;font-style:italic;text-align:center">No data</td></tr>`;
      return;
    }
    for (const act of list) {
      const p  = progressMap[act.activity_id] || {};
      const tq = (act.budgeted_units != null && parseFloat(act.budgeted_units)>0) ? parseFloat(act.budgeted_units) : 100;
      const pw = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : null;
      const tw = p.this_week_qty != null ? parseFloat(p.this_week_qty) : null;
      const cq = (pw||0) + (tw||0);
      const pct = tq > 0 ? Math.min(100, cq/tq*100) : null;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${act.department||'-'}</td>
        <td>${fmtBlock(act.unit_no)}</td>
        <td class="ov-act-id">${act.activity_id||''}</td>
        <td class="ov-act-name">${act.activity_name||'-'}</td>
        <td>${toISODate(p.actual_start)||'-'}</td>
        <td>${Math.round(tq).toLocaleString()}</td>
        <td>${pw!=null ? Math.round(pw).toLocaleString() : '-'}</td>
        <td>${tw!=null ? Math.round(tw).toLocaleString() : '-'}</td>
        <td>${Math.round(cq).toLocaleString()}</td>
        <td>${pct!=null ? pct.toFixed(1)+'%' : '-'}</td>`;
      tbody.appendChild(tr);
    }
  }

  buildActTable('ov-key-body', act => {
    const p = progressMap[act.activity_id] || {};
    return p.this_week_qty != null && parseFloat(p.this_week_qty) > 0;
  });
  buildActTable('ov-new-body', act => {
    const p = progressMap[act.activity_id] || {};
    const tw = p.this_week_qty != null ? parseFloat(p.this_week_qty) : 0;
    const pw = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : 0;
    return tw > 0 && pw === 0;
  });
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(tab) {
  activeTab  = tab;
  reportMode = (tab === 'report');
  const isPmsTab = tab in DISC_TABS;

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');

  document.getElementById('tab-pms').style.display      = (isPmsTab || tab === 'report') ? '' : 'none';
  document.getElementById('tab-overview').style.display = tab === 'overview' ? '' : 'none';
  document.getElementById('activity-table').classList.toggle('report-mode', tab === 'report');

  // Save 버튼: 리포트 탭에서는 숨김
  document.getElementById('save-btn').style.display = reportMode ? 'none' : '';
  // Discipline/Area 필터: discipline 탭이나 report 탭에서는 숨김
  const hideDiscArea = isPmsTab || reportMode;
  document.getElementById('discipline-filter-group').style.display = hideDiscArea ? 'none' : '';
  document.getElementById('area-filter-group').style.display       = reportMode   ? 'none' : '';

  if (isPmsTab) {
    selectedDiscipline = DISC_TABS[tab];
    currentPage = 1;
    render();
  } else if (tab === 'overview') {
    selectedDiscipline = '';
    renderOverview();
  } else if (tab === 'report') {
    selectedDiscipline = '';
    document.getElementById('discipline-filter').value = '';
    currentPage = 1;
    render();
  }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Init ────────────────────────────────────────────────────
loadData();
