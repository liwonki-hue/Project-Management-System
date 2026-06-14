# JM(Joint Master) → PMS 피팅 데이터 동기화 스크립트
import os
import requests
import openpyxl
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

SUPA_URL    = os.getenv("SUPABASE_URL")
SUPA_KEY    = os.getenv("SUPABASE_KEY")
BASE        = f"{SUPA_URL}/rest/v1"
MAPPING_XLS = "JM_Mapping.xlsx"

PMS_HEADERS = {
    "apikey": SUPA_KEY,
    "Authorization": f"Bearer {SUPA_KEY}",
    "Accept-Profile":  "pms",
    "Content-Profile": "pms",
}
JM_HEADERS = {
    "apikey": SUPA_KEY,
    "Authorization": f"Bearer {SUPA_KEY}",
    "Accept-Profile": "construction",
}


def load_mapping() -> list:
    """JM_Mapping.xlsx 'JM Mapping' 시트에서 Active='Y' 행만 읽기"""
    wb = openpyxl.load_workbook(MAPPING_XLS, data_only=True)
    ws = wb['JM Mapping']
    mapping = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        activity_id, system, unit, desc, active = (row + (None,) * 5)[:5]
        if not activity_id or not system or not unit:
            continue
        if str(active or '').strip().upper() != 'Y':
            continue
        mapping.append((str(activity_id).strip(), str(system).strip(), str(unit).strip()))
    wb.close()
    return mapping


def week_bounds(d: date):
    """d를 포함하는 주의 (월요일, 일요일) 반환"""
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def fetch_jm(system: str, unit: str) -> list:
    """joint_master에서 해당 system+unit 전체 데이터 조회 (최대 5000행)"""
    params = {
        "select": "di,date_completed",
        "system": f"eq.{system}",
        "unit":   f"eq.{unit}",
        "limit":  "5000",
    }
    r = requests.get(f"{BASE}/joint_master", headers=JM_HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def get_latest_report_date() -> str:
    """PMS weekly_progress의 최신 report_date 조회"""
    r = requests.get(
        f"{BASE}/weekly_progress",
        headers=PMS_HEADERS,
        params={"select": "report_date", "order": "report_date.desc", "limit": "1"},
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    if rows:
        return rows[0]["report_date"]
    return date.today().isoformat()


def upsert_pms(table: str, records: list, on_conflict: str):
    h = {**PMS_HEADERS, "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=representation"}
    r = requests.post(f"{BASE}/{table}", headers=h,
                      params={"on_conflict": on_conflict}, json=records, timeout=30)
    r.raise_for_status()
    return r.json()


def sync():
    mapping = load_mapping()
    if not mapping:
        print(f"[오류] {MAPPING_XLS}에 Active='Y' 항목이 없습니다.")
        return
    print(f"매핑 로드 : {len(mapping)}개 항목")

    report_date_str = get_latest_report_date()
    report_date     = date.fromisoformat(report_date_str)

    this_mon, this_sun = week_bounds(report_date)
    prev_mon = this_mon - timedelta(weeks=1)
    prev_sun = this_mon - timedelta(days=1)

    print(f"PMS Report date  : {report_date_str}")
    print(f"This week        : {this_mon} ~ {this_sun}")
    print(f"Previous week    : {prev_mon} ~ {prev_sun}")
    print()

    for activity_id, jm_system, jm_unit in mapping:
        print(f"[{activity_id}]  system={jm_system}, unit={jm_unit}")

        joints = fetch_jm(jm_system, jm_unit)
        print(f"  JM 조회 결과 : {len(joints)}행")

        total_di = sum(float(j.get("di") or 0) for j in joints)

        completed = [j for j in joints if j.get("date_completed")]
        start_date = (
            min(j["date_completed"][:10] for j in completed)
            if completed else None
        )

        prev_di = sum(
            float(j.get("di") or 0) for j in completed
            if prev_mon.isoformat() <= j["date_completed"][:10] <= prev_sun.isoformat()
        )
        this_di = sum(
            float(j.get("di") or 0) for j in completed
            if this_mon.isoformat() <= j["date_completed"][:10] <= this_sun.isoformat()
        )

        print(f"  Total DI     : {total_di:.1f}")
        print(f"  Start date   : {start_date or '-'}")
        print(f"  Prev week DI : {prev_di:.1f}")
        print(f"  This week DI : {this_di:.1f}")

        # activities.budgeted_units 갱신
        upsert_pms("activities",
                   [{"activity_id": activity_id, "budgeted_units": total_di}],
                   on_conflict="activity_id")
        print(f"  activities.budgeted_units = {total_di:.1f} 저장 완료")

        # weekly_progress 갱신
        prog = {
            "activity_id":   activity_id,
            "report_date":   report_date_str,
            "prev_week_qty": prev_di,
            "this_week_qty": this_di,
        }
        if start_date:
            prog["actual_start"] = start_date

        upsert_pms("weekly_progress", [prog], on_conflict="activity_id,report_date")
        print(f"  weekly_progress 저장 완료")
        print()

    print("=== 동기화 완료 ===")


if __name__ == "__main__":
    sync()
