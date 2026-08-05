# Daily Progress Breakdown — Design

## 배경 / 문제

PMS 대시보드의 진행률은 `pms.weekly_progress`에 활동(activity)당 주 1행(`report_date` = 그 주 수요일)으로 저장되며, `prev_week_qty`(지난주까지 누적)와 `this_week_qty`(이번 주 증분)만 존재한다. 이 구조에는 두 가지 혼란 요소가 있었다.

1. **Piping 탭**: Joint Master(`construction.joint_master`)와 자동 동기화(`jm_sync.py`)되는데, "이번 주" 버킷은 목~수 전체 기간을 하나로 뭉쳐 보여줘서 오늘 기준 진행 상황을 알기 어려웠다. (참고: 2026-08-06 진단 결과 `joint_master`의 최신 `date_completed`가 8/4까지만 있어 This Week=0으로 보였던 것은 버그가 아니라 데이터 시차였음이 확인됨.)
2. **MECH/HVAC/FF 탭**: 사용자가 `this_week_qty`를 매번 "이번 주 누적 총합"으로 직접 계산해서 덮어써야 했고, 화면에는 `app.js`의 `buildProgressMap()`이 지난 주 `report_date`를 감지해 `this_week_qty`를 `prev_week_qty`로 이월시키는 클라이언트 전용(비영속) 로직이 있어, 실제 저장된 값과 화면에 보이는 값이 다를 수 있었다.

## 목표

- 활동 행을 펼치면 **이번 주(목~수) 일자별 진행 내역**을 볼 수 있게 한다.
- 수동 입력(MECH/HVAC/FF)은 **오늘 날짜의 증분량만** 입력하고, 나머지는 시스템이 계산한다.
- Piping은 기존과 동일하게 Joint Master가 유일한 진실 공급원이며, 읽기 전용으로 일자별 내역을 보여준다.
- 지난 주 → 이번 주 이월 로직을 "저장 시점에 확정"시켜, 화면 표시용 임시 계산과 실제 DB 값의 괴리를 없앤다.

## 비목표 (Non-goals)

- 이번 주 이전(과거 주) 일자별 이력 조회 — 이번 주만 지원한다.
- 이미 지난 날짜의 값을 수정하는 기능 — 오늘 날짜만 입력/수정 가능하다.
- Piping의 동기화 주기(5분 캐시) 변경.

## 데이터 모델

`pms.weekly_progress`에 컬럼 1개 추가:

```sql
ALTER TABLE pms.weekly_progress
  ADD COLUMN daily_breakdown jsonb DEFAULT '{}'::jsonb;
```

- 형태: `{"2026-08-06": 12, "2026-08-07": 8}` — 그 주(row)에 속하는 날짜만 key로 존재 (값 0 또는 미입력 날짜는 생략).
- `weekly_progress`는 `UNIQUE(activity_id, report_date)`이므로 주가 바뀌면 새 row가 생성된다. 즉 "새 주 시작 시 일별 기록 초기화"는 별도 로직 없이 테이블 구조상 자연히 보장된다.
- 이 컬럼은 **MECH/HVAC/FF(수동 입력)에서만 사용**한다. Piping은 이 컬럼을 쓰지 않고 `joint_master`에서 매번 라이브로 계산한다 (아래 참조).

## 백엔드

### 수동 입력 (MECH/HVAC/FF)

별도 API 변경 불필요.

- **읽기**: 기존 `GET /api/progress` (`app.py:63`)가 `weekly_progress`를 그대로 select하므로 `daily_breakdown`도 응답에 자동 포함된다.
- **쓰기**: 기존 `POST /api/save_batch` (`app.py:69`)는 `progress` 배열의 각 항목에서 `activity_id`/`exists_in_db`를 제외한 나머지 필드를 그대로 upsert/patch하는 범용 구조이므로, 프론트엔드가 `daily_breakdown`과 재계산된 `this_week_qty`를 포함해 보내기만 하면 코드 수정 없이 동작한다.

### Piping (JM 자동)

새 엔드포인트 1개 추가:

```
GET /api/jm_daily/<activity_id>
→ { "2026-08-06": 5, "2026-08-07": 3, ... }   # 이번 주 목~수만
```

- `jm_sync.py`에 `daily_breakdown_for_activity(activity_id)` 함수 추가.
  - `load_mapping()`으로 해당 `activity_id`의 system/unit/ratio를 찾는다.
  - `fetch_jm()`으로 joint 목록을 가져와 `date_completed`가 이번 주 범위(`week_bounds_thu_wed`의 `this_thu`~`this_wed`) 안에 있는 것만 날짜별로 `di * ratio` 합산.
- 행을 펼칠 때만 호출한다 (전체 279개 활동을 매 페이지 로드마다 계산하지 않음).

## 프론트엔드 (static/js/app.js)

- 각 활동 행에 펼침 토글(▸)을 추가. 클릭 시 그 아래 sub-row로 이번 주 7일(목~수, 실제 날짜 라벨 포함)을 표시.
- **수동 디시플린**: 이미 로드되어 있는 `progressMap[activity_id].daily_breakdown`을 바로 렌더링 (추가 fetch 없음).
  - 오늘 날짜 칸만 편집 가능한 숫자 input, 나머지 6칸은 읽기 전용.
  - 입력 후 blur/Enter 시: 로컬 `daily_breakdown[오늘]` 갱신 → `this_week_qty = Object.values(daily_breakdown).reduce(합)` 재계산 → 해당 활동 1건을 기존 `save_batch` payload 형식으로 전송 → 응답 후 `recalcRow()`로 Completed/Remaining/Progress/Status 즉시 갱신.
- **Piping**: 최초 펼침 시 `GET /api/jm_daily/<id>` 1회 호출, 7칸 모두 읽기 전용 렌더링.
- 메인 테이블의 **Prev Week / This Week 칸은 모든 디시플린에서 읽기 전용으로 전환** (`renderTable()`의 `prevCell`/`thisCell`에서 input 제거, 항상 표시 전용). 값 입력은 오직 펼침 패널의 "오늘" 칸에서만 이뤄진다.

## 새 주 이월 로직

- 오늘이 새 주(목요일)인데 해당 `activity_id`+`report_date`(이번 주 수요일) row가 아직 없을 때:
  - 프론트엔드가 가장 최근 과거 row의 `prev_week_qty + this_week_qty`를 계산해 새 row의 `prev_week_qty`로 채우고, `daily_breakdown = { 오늘: 입력값 }`, `this_week_qty = 입력값`으로 `save_batch`에 신규 upsert 전송.
  - **이 시점에 DB에 영속화**되므로, 이후 새로고침해도 값이 달라지지 않는다.
- 기존 `app.js:135-146`의 "지난 주 `report_date`를 감지해 화면에서만 이월 처리"하는 코드는 **제거**한다. (읽을 때마다 추측하던 것을, 저장 시점에 한 번 확정하는 구조로 대체)
- 아직 아무도 저장하지 않은 새 주: row 자체가 없으므로 This Week은 자연스럽게 빈칸(0)으로 표시 — Piping에서 이미 확인한 것과 동일한 "정상적인 데이터 없음" 상태.
- Piping은 이 이월 로직과 무관 — `jm_sync.sync()`가 매번 `joint_master` 원본에서 `prev_week_qty`(누적)와 `this_week_qty`를 전부 재계산하므로 그대로 유지.

## 영향받지 않는 부분

- Overview 대시보드, Discipline Summary 등은 `weekly_progress`의 `prev_week_qty`/`this_week_qty`를 그대로 읽으므로 변경 없이 동작한다.
- `jm_sync.py`의 5분 캐시(`SYNC_JM_CACHE_SECONDS`), 주간 경계 계산(`week_bounds_thu_wed`) 로직은 그대로 유지.

## 테스트 관점

- 신규 컬럼 마이그레이션 후 기존 row들의 `daily_breakdown`이 기본값(`{}`)으로 채워지는지 확인.
- 수동 입력: 오늘 값 저장 → `this_week_qty` 합계 재계산 → Completed/Progress/Status 갱신까지 한 번에 검증.
- 새 주 첫 저장 시 `prev_week_qty` 이월값이 정확히 DB에 반영되는지 확인.
- Piping 행 펼침 시 `/api/jm_daily/<id>` 응답이 실제 `joint_master` 집계와 일치하는지 확인.
