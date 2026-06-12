// PMS Dashboard — 메인 프론트엔드 로직
let allActivities = [];
let progressMap = {};   // activity_id → 최신 weekly_progress
let charts = {};

let activeUnits = new Set(['1CF', '2CF', '0CF']);
let activeUnitType = '';
let searchText = '';

// ── 데이터 로드 ──────────────────────────────────────────────
async function loadData() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('activity-table').style.display = 'none';

  const [actRes, progRes] = await Promise.all([
    fetch('/api/activities'),
    fetch('/api/progress'),
  ]);
  allActivities = await actRes.json();

  const allProg = await progRes.json();
  progressMap = {};
  for (const p of allProg) {
    const id = p.activity_id;
    if (!progressMap[id] || p.report_date > progressMap[id].report_date) {
      progressMap[id] = p;
    }
  }

  document.getElementById('loading').style.display = 'none';
  document.getElementById('activity-table').style.display = 'table';

  const dates = Object.values(progressMap).map(p => p.report_date).filter(Boolean).sort();
  if (dates.length) {
    document.getElementById('last-updated').textContent =
      `기준일: ${dates[dates.length - 1]} | ${allActivities.length}개 Activity`;
  }

  render();
}

// ── 필터 적용 ────────────────────────────────────────────────
function getFiltered() {
  return allActivities.filter(act => {
    if (activeUnits.size && !activeUnits.has(act.unit_no)) return false;
    if (activeUnitType && act.unit_type !== activeUnitType) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const inId = (act.activity_id || '').toLowerCase().includes(q);
      const inName = (act.activity_name || '').toLowerCase().includes(q);
      if (!inId && !inName) return false;
    }
    return true;
  });
}

// ── 렌더링 ───────────────────────────────────────────────────
function render() {
  const data = getFiltered();
  renderKPIs(data);
  renderTable(data);
  if (document.getElementById('tab-charts').classList.contains('active')) {
    renderCharts(data);
  }
}

// ── KPI ──────────────────────────────────────────────────────
function renderKPIs(data) {
  document.getElementById('kpi-total').textContent = data.length.toLocaleString();

  const diBudget = data
    .filter(a => a.unit_type === 'D/I')
    .reduce((s, a) => s + (a.budgeted_units || 0), 0);
  document.getElementById('kpi-di-budget').textContent =
    diBudget.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const pctActs = data.filter(a => a.unit_type === '%');
  const completed = pctActs.filter(a => {
    const p = progressMap[a.activity_id];
    return p && parseFloat(p.actual_quantity) >= 100;
  }).length;
  document.getElementById('kpi-pct-complete').textContent =
    `${completed} / ${pctActs.length}`;

  const thisWeek = data.filter(a => {
    const p = progressMap[a.activity_id];
    return p && p.this_week_qty != null;
  }).length;
  document.getElementById('kpi-this-week').textContent = `${thisWeek}개`;
}

// ── 테이블 ───────────────────────────────────────────────────
function renderTable(data) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  for (const act of data) {
    const p = progressMap[act.activity_id] || {};
    const tr = document.createElement('tr');
    const unitClass = `unit-${act.unit_no}`;
    tr.innerHTML = `
      <td><span class="unit-badge ${unitClass}">${act.unit_no || '-'}</span></td>
      <td class="mono">${act.activity_id || '-'}</td>
      <td>${act.activity_name || '-'}</td>
      <td class="num">${fmtNum(act.budgeted_units, 0)}</td>
      <td><span class="type-badge">${act.unit_type || '-'}</span></td>
      <td>${p.actual_quantity || '-'}</td>
      <td class="num">${fmtNum(p.prev_week_qty, 1)}</td>
      <td class="num">${fmtNum(p.this_week_qty, 1)}</td>
      <td class="num">${fmtNum(p.actual_total_qty, 1)}</td>
      <td>${p.report_date || '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── 차트 ─────────────────────────────────────────────────────
function renderCharts(data) {
  const units = ['1CF', '2CF', '0CF'];
  const colors = ['#4f8ef7', '#f7a14f', '#4fc9a4'];

  // Unit별 예산 물량 (막대)
  if (charts.budget) charts.budget.destroy();
  charts.budget = new Chart(document.getElementById('chart-budget'), {
    type: 'bar',
    data: {
      labels: units,
      datasets: [{
        label: '예산 물량',
        data: units.map(u =>
          data.filter(a => a.unit_no === u).reduce((s, a) => s + (a.budgeted_units || 0), 0)
        ),
        backgroundColor: colors,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => v.toLocaleString() } } },
    },
  });

  // Activity 유형 분포 (파이)
  if (charts.type) charts.type.destroy();
  const diCount  = data.filter(a => a.unit_type === 'D/I').length;
  const pctCount = data.filter(a => a.unit_type === '%').length;
  const etcCount = data.length - diCount - pctCount;
  const pieLabels = ['D/I', '%'];
  const pieData   = [diCount, pctCount];
  if (etcCount > 0) { pieLabels.push('기타'); pieData.push(etcCount); }

  charts.type = new Chart(document.getElementById('chart-type'), {
    type: 'pie',
    data: {
      labels: pieLabels,
      datasets: [{ data: pieData, backgroundColor: ['#4f8ef7', '#f7a14f', '#aaa'] }],
    },
    options: { responsive: true },
  });

  // Unit별 Activity 수 (가로 막대)
  if (charts.unitCount) charts.unitCount.destroy();
  charts.unitCount = new Chart(document.getElementById('chart-unit-count'), {
    type: 'bar',
    data: {
      labels: units,
      datasets: [{
        label: 'Activity 수',
        data: units.map(u => data.filter(a => a.unit_no === u).length),
        backgroundColor: colors,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
    },
  });
}

// ── 유틸 ─────────────────────────────────────────────────────
function fmtNum(val, decimals = 1) {
  if (val == null || val === '') return '-';
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// ── 이벤트 바인딩 ────────────────────────────────────────────
document.querySelectorAll('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const unit = btn.dataset.unit;
    if (activeUnits.has(unit)) {
      activeUnits.delete(unit);
      btn.classList.remove('active');
    } else {
      activeUnits.add(unit);
      btn.classList.add('active');
    }
    render();
  });
});

document.getElementById('unit-type-filter').addEventListener('change', e => {
  activeUnitType = e.target.value;
  render();
});

document.getElementById('search').addEventListener('input', e => {
  searchText = e.target.value.trim();
  render();
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'charts') renderCharts(getFiltered());
  });
});

document.getElementById('refresh-btn').addEventListener('click', loadData);

// ── 초기 로드 ────────────────────────────────────────────────
loadData();
