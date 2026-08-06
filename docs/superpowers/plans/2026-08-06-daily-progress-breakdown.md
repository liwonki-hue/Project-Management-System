# Daily Progress Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users expand any activity row to see this week's (Thu–Wed) day-by-day progress, with manual disciplines (MECH/HVAC/FF) entering only today's increment and Piping showing a live read-only breakdown sourced from Joint Master.

**Architecture:** Add one `jsonb` column (`daily_breakdown`) to `pms.weekly_progress` that stores `{date: qty}` for the row's week. Manual-discipline reads/writes reuse the existing generic `/api/progress` and `/api/save_batch` endpoints unchanged. Piping's breakdown is computed live from `construction.joint_master` via one new endpoint, since Piping never writes to `daily_breakdown`. The frontend adds a per-row expand toggle that renders a 7-day sub-row; only today's cell is editable, and only for non-Piping disciplines.

**Tech Stack:** Flask + vanilla JS (no build step) + Supabase (PostgREST) via `db.py`/`jm_sync.py`. No automated test framework exists in this project (no pytest, no JS test runner) — verification steps in this plan use `python -c` snippets, `curl`, and manual browser checks via the Playwright MCP tool, matching how this codebase has always been verified.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-daily-progress-breakdown-design.md` — follow it exactly; this plan does not deviate from it.
- Only today's date is ever writable; past days in the current week are read-only once saved.
- Drill-down shows the **current week only** (no historical week browsing).
- Piping never writes `daily_breakdown` — it is Joint-Master-derived and read-only in the UI.
- Do not touch `jm_sync.py`'s 5-minute sync cache or `week_bounds_thu_wed()` — reuse them as-is.
- Do not restructure files or introduce a build step / test framework — this is a small Flask + vanilla-JS app and should stay that way.

---

### Task 1: Supabase schema migration — `daily_breakdown` column

**Files:**
- Modify: `schema.sql:18-33` (documentation of the live schema — keep it in sync)
- Manual action: Supabase SQL Editor (this repo has no DB migration tool; `schema.sql`'s own header says "Supabase SQL Editor에서 실행")

**Interfaces:**
- Produces: `pms.weekly_progress.daily_breakdown` (jsonb, default `'{}'::jsonb`), consumed by Task 4 (frontend read) and Task 7 (frontend write) with no backend code changes needed since `GET /api/progress` and `POST /api/save_batch` already pass columns through generically.

- [ ] **Step 1: Update `schema.sql` to document the new column**

In `schema.sql`, the `weekly_progress` table definition currently ends:

```sql
CREATE TABLE IF NOT EXISTS pms.weekly_progress (
    id               serial PRIMARY KEY,
    activity_id      text REFERENCES pms.activities(activity_id),
    report_date      date,
    actual_start     text,
    actual_finish    text,
    actual_quantity  text,
    design_quantity  numeric,
    gap              numeric,
    prev_week_qty    numeric,
    this_week_qty    numeric,
    actual_total_qty numeric,
    local_staff      int,
    korean_staff     int,
    UNIQUE(activity_id, report_date)
);
```

Add `daily_breakdown` right after `this_week_qty`:

```sql
CREATE TABLE IF NOT EXISTS pms.weekly_progress (
    id               serial PRIMARY KEY,
    activity_id      text REFERENCES pms.activities(activity_id),
    report_date      date,
    actual_start     text,
    actual_finish    text,
    actual_quantity  text,
    design_quantity  numeric,
    gap              numeric,
    prev_week_qty    numeric,
    this_week_qty    numeric,
    daily_breakdown  jsonb DEFAULT '{}'::jsonb,
    actual_total_qty numeric,
    local_staff      int,
    korean_staff     int,
    UNIQUE(activity_id, report_date)
);
```

- [ ] **Step 2: Add a migration statement for the already-existing live table**

Directly below the `CREATE TABLE IF NOT EXISTS pms.weekly_progress (...)` block in `schema.sql`, add:

```sql
-- 기존 테이블에 daily_breakdown 컬럼 추가 (최초 1회, 이미 있으면 무시)
ALTER TABLE pms.weekly_progress
  ADD COLUMN IF NOT EXISTS daily_breakdown jsonb DEFAULT '{}'::jsonb;
```

- [ ] **Step 3: Run the migration against the live Supabase project**

This project's live schema lives in Supabase, not a local DB — there is no local migration runner. Open the Supabase project's SQL Editor (same place `schema.sql` says to run this file) and execute exactly the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS daily_breakdown ...` statement from Step 2.

- [ ] **Step 4: Verify the column exists and defaults correctly**

Run:

```bash
python -c "
import db
rows = db.select('weekly_progress', columns='activity_id,report_date,daily_breakdown', order='report_date.desc')
print(rows[0] if rows else 'no rows')
"
```

Expected: the printed row includes a `daily_breakdown` key (value `{}` for existing rows, since they predate the column).

- [ ] **Step 5: Commit**

```bash
git add schema.sql
git commit -m "feat: weekly_progress에 daily_breakdown 컬럼 추가"
```

---

### Task 2: `jm_sync.py` — per-activity daily breakdown for Piping

**Files:**
- Modify: `jm_sync.py` (add a new function after `sync()`, i.e. after line 156)

**Interfaces:**
- Consumes: `load_mapping()` (existing, returns `list[(activity_id, system, unit, ratio)]`), `fetch_jm(system, unit)` (existing, returns `list[dict]` with `di`/`date_completed`), `week_bounds_thu_wed(d)` (existing, returns `(this_thu, this_wed, prev_wed)`).
- Produces: `daily_breakdown_for_activity(activity_id: str) -> dict[str, float]` — consumed by Task 3's Flask route.

- [ ] **Step 1: Add the function**

At the end of `jm_sync.py` (after the `sync()` function, which currently ends at line 156), add:

```python


def daily_breakdown_for_activity(activity_id: str) -> dict:
    """단일 활동의 이번 주(목~수) 일자별 완료 DI 합계 반환 (Piping 전용, 읽기 전용)"""
    mapping = load_mapping()
    entry = next((m for m in mapping if m[0] == activity_id), None)
    if not entry:
        return {}

    _, jm_system, jm_unit, ratio = entry
    this_thu, this_wed, _ = week_bounds_thu_wed(date.today())

    joints = fetch_jm(jm_system, jm_unit)
    breakdown = {}
    for j in joints:
        dc = j.get("date_completed")
        if not dc:
            continue
        d = dc[:10]
        if this_thu.isoformat() <= d <= this_wed.isoformat():
            breakdown[d] = breakdown.get(d, 0.0) + float(j.get("di") or 0) * ratio
    return breakdown
```

- [ ] **Step 2: Verify it against a real mapped activity**

First find an activity_id that has an active JM mapping:

```bash
python -c "
import jm_sync
mapping = jm_sync.load_mapping()
print(mapping[0])
"
```

Then run the new function against that activity_id (replace `ACT_ID` with the value printed above):

```bash
python -c "
import jm_sync
print(jm_sync.daily_breakdown_for_activity('ACT_ID'))
"
```

Expected: a dict (possibly empty `{}` if no joints were completed this week — this is expected/normal per the 2026-08-06 investigation, not an error). Confirm it does NOT raise an exception and does NOT include dates outside this week's Thu–Wed range.

- [ ] **Step 3: Verify the "unknown activity" case**

```bash
python -c "
import jm_sync
print(jm_sync.daily_breakdown_for_activity('NOT_A_REAL_ID'))
"
```

Expected: `{}` (no exception).

- [ ] **Step 4: Commit**

```bash
git add jm_sync.py
git commit -m "feat: jm_sync에 활동별 일자별 breakdown 함수 추가"
```

---

### Task 3: `app.py` — `GET /api/jm_daily/<activity_id>`

**Files:**
- Modify: `app.py` (add a new route after `get_progress()`, i.e. after line 66)

**Interfaces:**
- Consumes: `jm_sync.daily_breakdown_for_activity(activity_id)` from Task 2.
- Produces: `GET /api/jm_daily/<activity_id>` → JSON `{ "YYYY-MM-DD": number, ... }`, consumed by the frontend in Task 6.

- [ ] **Step 1: Add the route**

In `app.py`, right after the `get_progress()` function (ends at line 66, blank line, then `@app.route('/api/save_batch', ...)` starts at line 69), insert:

```python
@app.route('/api/jm_daily/<activity_id>')
def jm_daily(activity_id):
    try:
        data = jm_sync.daily_breakdown_for_activity(activity_id)
        return jsonify(data)
    except Exception as e:
        print(f'[jm_daily 오류] {e}')
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 2: Start the server and verify with curl**

```bash
cd "c:\Users\PCLOVE\Downloads\Project Management System" && python app.py &
```

Wait ~2 seconds for startup, then (replace `ACT_ID` with the same mapped activity_id used in Task 2):

```bash
curl -s http://127.0.0.1:5000/api/jm_daily/ACT_ID
```

Expected: HTTP 200 with a JSON object (matches Task 2 Step 2's output).

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/jm_daily/NOT_A_REAL_ID
```

Expected: `200` with body `{}`.

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: Piping 활동별 일자별 breakdown API 추가"
```

---

### Task 4: `static/js/app.js` — make Prev/This Week read-only everywhere

**Files:**
- Modify: `static/js/app.js:22` (`PROG_FIELDS`)
- Modify: `static/js/app.js:368-373` (`prevCell`/`thisCell` in `renderTable`)
- Modify: `static/js/app.js:403-433` (`recalcRow`)

**Interfaces:**
- Produces: `.prev-cell` / `.this-cell` CSS classes on the main table's Prev Week / This Week `<td>` elements — consumed by Task 7's `saveDailyEntry()` flow (via `recalcRow`).
- This task's changes are prerequisites for Task 6/7 and must land first — after this task, quantities can no longer be edited via the main table at all (by design; editing moves to the drill-down in Task 7).

- [ ] **Step 1: Remove `prev_week_qty`/`this_week_qty` from `PROG_FIELDS`**

In `static/js/app.js:22`, change:

```javascript
const PROG_FIELDS = ['actual_start', 'actual_finish', 'prev_week_qty', 'this_week_qty'];
```

to:

```javascript
const PROG_FIELDS = ['actual_start', 'actual_finish'];
```

(Why: the bulk "Save" button's dirty-check loop at `app.js:610-616` uses this list. Once Step 2 below removes the `prev_week_qty`/`this_week_qty` `<input>` elements, `progMap[id]` will never have those keys set, so leaving them in `PROG_FIELDS` would make `valChanged(undefined, existingValue)` evaluate `true` for every row on every bulk save — silently sending `null` and wiping quantity data. Removing them here is required, not optional.)

- [ ] **Step 2: Make `prevCell`/`thisCell` unconditionally read-only**

In `static/js/app.js:368-373`, change:

```javascript
    const prevCell = readOnly
      ? `<td>${prevWk != null && prevWk > 0 ? Math.round(prevWk).toLocaleString() : '-'}</td>`
      : `<td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="prev_week_qty" data-table="progress" value="${prevWk != null && prevWk > 0 ? Math.round(prevWk) : ''}"></td>`;
    const thisCell = readOnly
      ? `<td>${thisWk != null && thisWk > 0 ? Math.round(thisWk).toLocaleString() : '-'}</td>`
      : `<td><input type="number" class="qty-input" data-id="${act.activity_id}" data-field="this_week_qty" data-table="progress" value="${thisWk != null && thisWk > 0 ? Math.round(thisWk) : ''}"></td>`;
```

to:

```javascript
    const prevCell = `<td class="prev-cell">${prevWk != null && prevWk > 0 ? Math.round(prevWk).toLocaleString() : '-'}</td>`;
    const thisCell = `<td class="this-cell">${thisWk != null && thisWk > 0 ? Math.round(thisWk).toLocaleString() : '-'}</td>`;
```

- [ ] **Step 3: Make `recalcRow` read Prev/This Week from `progressMap` instead of inputs**

In `static/js/app.js:403-433`, change:

```javascript
function recalcRow(tr) {
  if (!tr.querySelector('[data-field="budgeted_units"]')) return;
  const totalQty = parseFloat(tr.querySelector('[data-field="budgeted_units"]')?.value) || null;
  const prev     = parseFloat(tr.querySelector('[data-field="prev_week_qty"]')?.value)  || null;
  const thisWk   = parseFloat(tr.querySelector('[data-field="this_week_qty"]')?.value)  || null;

  const completed = (prev != null || thisWk != null) ? (prev || 0) + (thisWk || 0) : null;
  const remaining = (totalQty != null && completed != null) ? totalQty - completed : null;
  const pct       = (totalQty && totalQty > 0 && completed != null)
    ? Math.min(100, (completed / totalQty) * 100) : null;

  const fmt = v => v != null ? Math.round(v).toLocaleString() : '-';
  tr.querySelector('.completed-cell').textContent = fmt(completed);
  tr.querySelector('.remaining-cell').textContent = fmt(remaining);
```

to:

```javascript
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
```

(The rest of the function — progress bar and status badge — is unchanged.)

- [ ] **Step 4: Manual verification**

Start the server (`python app.py`) if not already running, open `http://127.0.0.1:5000` in a browser, and confirm:
- Prev Week / This Week columns show plain numbers (no input box, no border).
- Editing "Total Q'ty" for a row still updates Completed/Remaining/Progress/Status live (proves `recalcRow` still works after reading from `progressMap`).
- Editing Actual Start/Finish and clicking Save still works (proves the bulk save path still functions for the fields it still owns).

- [ ] **Step 5: Commit**

```bash
git add static/js/app.js
git commit -m "refactor: Prev/This Week 칸을 읽기 전용으로 전환"
```

---

### Task 5: Table markup — expand-toggle column

**Files:**
- Modify: `templates/index.html:248-267` (header row)
- Modify: `static/css/style.css:152-159` (column widths), `static/css/style.css:350-358` (report-mode column hiding)

**Interfaces:**
- Produces: a new leading `<th class="col-expand">` header cell and `.col-expand` CSS class, consumed by Task 6's row markup.

- [ ] **Step 1: Add the header cell**

In `templates/index.html`, the header row currently starts:

```html
            <tr>
              <th class="col-seq">#</th>
```

Change to:

```html
            <tr>
              <th class="col-expand"></th>
              <th class="col-seq">#</th>
```

- [ ] **Step 2: Add the column width**

In `static/css/style.css:152`, right before `.col-seq`, add:

```css
.col-expand     { width: 28px;  min-width: 28px; text-align: center; }
```

- [ ] **Step 3: Fix report-mode column hiding for the shifted column positions**

Inserting a new first column shifts every `nth-child` index in the report-mode rule by 1. In `static/css/style.css:350-358`, change:

```css
/* Weekly Report 모드: #, Discipline, Area 열 숨김 */
#activity-table.report-mode .col-seq,
#activity-table.report-mode .col-discipline,
#activity-table.report-mode .col-area,
#activity-table.report-mode td:nth-child(1),
#activity-table.report-mode td:nth-child(4),
#activity-table.report-mode td:nth-child(5) {
  display: none;
}
```

to:

```css
/* Weekly Report 모드: 펼침 토글, #, Discipline, Area 열 숨김 */
#activity-table.report-mode .col-expand,
#activity-table.report-mode .col-seq,
#activity-table.report-mode .col-discipline,
#activity-table.report-mode .col-area,
#activity-table.report-mode td:nth-child(1),
#activity-table.report-mode td:nth-child(2),
#activity-table.report-mode td:nth-child(5),
#activity-table.report-mode td:nth-child(6) {
  display: none;
}
```

(Position map after the new column: 1=expand, 2=seq, 3=level, 4=block, 5=discipline, 6=area. `.col-expand`/`.col-seq`/`.col-discipline`/`.col-area` already select by class so they still work unconditionally; the `nth-child` fallbacks are updated from `(1,4,5)` to `(1,2,5,6)` to match.)

- [ ] **Step 4: Commit**

```bash
git add templates/index.html static/css/style.css
git commit -m "feat: 활동 테이블에 펼침 토글 컬럼 추가"
```

(Note: the toggle button itself and its row-cell are added to `renderTable` in Task 6 — this task only adds the header/CSS, so the table will render with an empty extra header cell and no matching body cell until Task 6 lands. That's fine as an intermediate state since these commits are local; if you want every commit independently deployable, do Task 5 and Task 6 as one commit instead.)

---

### Task 6: `static/js/app.js` — expand/collapse and daily-detail rendering

**Files:**
- Modify: `static/js/app.js:24-39` (add `getCurrentWeekDates` near the other week helpers)
- Modify: `static/js/app.js:377-397` (row markup in `renderTable`, add the expand-toggle `<td>`)
- Modify: `static/js/app.js` after `recalcRow` (after line 433 in the pre-Task-4 numbering — insert after the function you edited in Task 4 Step 3)
- Modify: `static/js/app.js` after the existing `#table-body` `'change'` listener (after line 562)

**Interfaces:**
- Consumes: `getWeekWednesday`, `getWeekThursday`, `fmtWeekDate` (existing, `app.js:25-48`), `progressMap`, `allActivities` (existing globals), `GET /api/jm_daily/<activity_id>` (Task 3).
- Produces: `getCurrentWeekDates(): string[]` (7 ISO date strings, Thu→Wed), `buildDailyTableHtml(dates, breakdown, editableDate): string`, `renderManualDailyDetail(activityId): string`, `renderPipingDailyDetail(activityId): Promise<string>` — all consumed by Task 6 Step 4's click handler and by Task 7.

- [ ] **Step 1: Add `todayISO()` and `getCurrentWeekDates()`**

In `static/js/app.js`, right after `getWeekThursday` (which ends at line 39):

```javascript

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
```

(Note: an earlier implementation pass used `d.toISOString().slice(0, 10)` inside the loop, matching what appeared here originally. That has a real timezone bug — `toISOString()` converts through UTC, which shifts every date backward by one day in any positive-UTC-offset timezone, including KST. This plan already reflects the corrected version, built entirely from local `getFullYear()/getMonth()/getDate()` components, matching the existing `getWeekWednesday()` pattern. `todayISO()` uses the same safe pattern and is consumed by Step 3 below and by Task 7.)

- [ ] **Step 2: Add the expand-toggle `<td>` to the row markup**

In `static/js/app.js`, the `tr.innerHTML` template (originally lines 377-396, now shifted slightly by Task 4's edits) currently starts:

```javascript
    tr.innerHTML = `
      <td class="td-seq">${seqNo}</td>
```

Change to:

```javascript
    tr.innerHTML = `
      <td class="td-expand"><button type="button" class="expand-btn" data-id="${act.activity_id}">&#9656;</button></td>
      <td class="td-seq">${seqNo}</td>
```

- [ ] **Step 3: Add the daily-detail rendering helpers**

Immediately after the `recalcRow` function (which Task 4 Step 3 edited; it ends with the closing `}` of the status-badge block, originally line 433), add:

```javascript

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
```

- [ ] **Step 4: Add the expand/collapse click handler**

Right after the existing `#table-body` `'change'` event listener block (it ends with the closing `});` after the `unit-select` handling, originally line 562), add:

```javascript

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
```

(`colspan="${colCount}"` reads the actual rendered column count from the row itself, so it always matches regardless of how many `<td>`s the row ends up with — no hardcoded column count to keep in sync.)

- [ ] **Step 5: Add CSS for the new elements**

In `static/css/style.css`, after the `.qty-input` block (ends at `static/css/style.css:112`), add:

```css
.expand-btn {
  background: none; border: none; cursor: pointer; font-size: 11px;
  color: #4f8ef7; padding: 2px 4px; line-height: 1;
}
.expand-btn:hover { color: #2563eb; }
.detail-row td { background: #f7faff; padding: 8px 24px; }
.daily-table { border-collapse: collapse; font-size: 11px; }
.daily-table th, .daily-table td {
  border: 1px solid #d0d5dd; padding: 4px 10px; text-align: center; min-width: 70px;
}
.daily-table thead { background: #eef2ff; }
.daily-input {
  width: 60px; height: 22px; border: 1px solid #d0d5dd; border-radius: 4px;
  font-size: 11px; text-align: center; background: #fff;
}
.daily-input.saved { border-color: #4fc9a4; }
```

- [ ] **Step 6: Manual verification**

Start the server, open `http://127.0.0.1:5000`, go to any discipline tab (e.g. BOP MECH), and confirm:
- Every row shows a ▸ button as the first column.
- Clicking it shows a sub-row with 7 day columns labeled with real dates (e.g. `08/06(목)` … `08/12(수)`), and it fetches only once (network tab shows no repeat calls on re-expand).
- Clicking it again collapses (▾ → ▸) without re-fetching.
- On the PIPING tab, expanding a mapped activity's row shows read-only values (confirm one matches Task 2/3's output for that activity) and calls `/api/jm_daily/<id>`.
- On MECH/HVAC/FF, today's column shows an editable input; all other columns are plain text.

- [ ] **Step 7: Commit**

```bash
git add static/js/app.js static/css/style.css
git commit -m "feat: 활동 행 펼침 시 이번 주 일자별 상세 표시"
```

---

### Task 7: `static/js/app.js` — save today's entry from the drill-down

**Files:**
- Modify: `static/js/app.js` inside the existing `#table-body` `'change'` listener (the one edited/referenced in Task 6 Step 4 — insert at the very top of that function body)

**Interfaces:**
- Consumes: `POST /api/save_batch` (existing, `app.py:69`), `progressMap`, `getWeekWednesday` (existing), `todayISO()` (added in Task 6 Step 1 — reuse it, do not recompute "today" via `.toISOString()`, which has a real timezone bug in positive-UTC-offset zones including KST; see Task 6's note).
- Produces: `saveDailyEntry(activityId, qty): Promise<object>` — updates `progressMap[activityId]` in place with the new `prev_week_qty`/`this_week_qty`/`daily_breakdown`/`report_date`, matching the shape every other read of `progressMap` already expects.

- [ ] **Step 1: Add `saveDailyEntry`**

Add this function right after `renderPipingDailyDetail` (added in Task 6 Step 3):

```javascript

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
  };
  return progressMap[activityId];
}
```

- [ ] **Step 2: Wire it to the daily-input field**

In `static/js/app.js`, find the existing `#table-body` `'change'` listener (starts `document.getElementById('table-body').addEventListener('change', async e => {`, originally line 501). As the very first line inside that function body, before the existing `if (e.target.classList.contains('date-input')) {` check, add:

```javascript
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
```

- [ ] **Step 3: Manual verification — same-week save**

With the server running, expand a MECH/HVAC/FF activity that already has a current-week row (has non-zero This Week), type a new number in today's cell, and press Tab/click away. Confirm:
- The input briefly shows a green "saved" border.
- The main row's This Week / Completed / Remaining / Progress / Status update immediately without a page reload.
- Reload the page, re-expand the same row: today's value persisted, and This Week still matches the sum shown.

- [ ] **Step 4: Manual verification — first save of a brand-new week**

Pick an activity with no row at all for `daily_breakdown` in progressMap (or manually delete its current-week test row in Supabase), enter a value in today's cell, save, then check:

```bash
python -c "
import db
rows = db.select('weekly_progress', columns='activity_id,report_date,prev_week_qty,this_week_qty,daily_breakdown', order='report_date.desc')
print(rows[0])
"
```

Expected: a new row for this week's `report_date`, `prev_week_qty` equal to whatever the previous week's `prev_week_qty + this_week_qty` was (0 if this was truly the activity's first-ever entry), `this_week_qty` equal to the value entered, `daily_breakdown` containing exactly `{today: value}`.

- [ ] **Step 5: Commit**

```bash
git add static/js/app.js
git commit -m "feat: 일자별 상세에서 오늘 증분량 저장"
```

---

### Task 8: Retire the obsolete client-side week-rollover hack

**Files:**
- Modify: `static/js/app.js:126-147` (`buildProgressMap`)

**Interfaces:**
- No interface changes — this only removes dead logic now superseded by Task 7's server-persisted carry-forward.

- [ ] **Step 1: Remove the rollover block**

In `static/js/app.js`, `buildProgressMap` currently reads:

```javascript
function buildProgressMap() {
  progressMap = {};
  for (const p of allProgress) {
    const id = p.activity_id;
    if (!progressMap[id] || p.report_date > progressMap[id].report_date) {
      progressMap[id] = p;
    }
  }

  // 저장된 report_date가 지난 주(목~수 이전)면 this_week_qty를 prev_week_qty로 이월하고
  // this_week_qty는 새 주 입력을 위해 비움
  const curWed = getWeekWednesday(new Date());
  for (const id in progressMap) {
    const p = progressMap[id];
    if (p.report_date && p.report_date < curWed) {
      const prev  = p.prev_week_qty != null ? parseFloat(p.prev_week_qty) : 0;
      const this_ = p.this_week_qty != null ? parseFloat(p.this_week_qty) : 0;
      p.prev_week_qty = (prev + this_) || null;
      p.this_week_qty = null;
    }
  }
}
```

Change to:

```javascript
function buildProgressMap() {
  progressMap = {};
  for (const p of allProgress) {
    const id = p.activity_id;
    if (!progressMap[id] || p.report_date > progressMap[id].report_date) {
      progressMap[id] = p;
    }
  }
}
```

(Why safe to remove now: Piping's `this_week_qty` is always freshly recomputed by `jm_sync.sync()` on every load regardless of this block. For manual disciplines, Task 7's `saveDailyEntry` now performs the exact same carry-forward calculation **at save time** and persists it to the DB — so by the time a new week's data is loaded, the stored row already has the correct `prev_week_qty`/`this_week_qty`, and this display-time guess is redundant. Leaving it in would double-apply the rollover for a stale row that hasn't been saved to yet this week, which is now purely a "no data yet" state, not something to patch over.)

- [ ] **Step 2: Verify Overview/KPI numbers are still correct after a real new-week transition**

This can only be fully verified by waiting for an actual week boundary in production data, so verify the reachable part now: with today's data loaded, confirm in the browser console:

```javascript
Object.values(progressMap).find(p => p.report_date < getWeekWednesday(new Date()))
```

returns rows whose `this_week_qty` is whatever was actually stored (not force-nulled) — i.e., stale-but-unedited rows now display their real last-saved numbers instead of a client-side guess, which is expected: they'll get corrected automatically the next time someone edits that activity (Task 7) or the next JM sync runs (Piping).

- [ ] **Step 3: Commit**

```bash
git add static/js/app.js
git commit -m "refactor: 구식 클라이언트 이월 로직 제거 (저장 시점 이월로 대체)"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full restart and smoke test**

```bash
cd "c:\Users\PCLOVE\Downloads\Project Management System" && python app.py
```

- [ ] **Step 2: Browser walkthrough (Playwright MCP or manual)**

Navigate to `http://127.0.0.1:5000` and confirm, for each of the four discipline tabs (BOP MECH, PIPING, HVAC, FF):
- Table loads with the new ▸ column as the first column and no console errors.
- Prev Week / This Week are plain text, not inputs.
- Expanding a row shows 7 correctly-dated columns.
- For MECH/HVAC/FF: entering a value in today's column saves and updates the row's Completed/Remaining/Progress/Status.
- For PIPING: the row is fully read-only in the drill-down and matches `jm_sync.daily_breakdown_for_activity()`'s output for that activity.
- Overview tab's KPI cards and Discipline Progress chart still render non-error values (proves `progressMap` shape didn't break downstream consumers).
- Weekly Report tab (`reportMode`) still hides the `#`, Discipline, Area, and (new) expand-toggle columns correctly.

- [ ] **Step 3: Confirm no regressions in bulk Save**

Edit an Actual Start date and the Unit dropdown on one row (fields untouched by this feature), click the global "Save" button, reload, and confirm those two values persisted and no other row's `daily_breakdown`/quantities changed.
