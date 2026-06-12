# PMS.xlsx → Supabase pms 스키마 데이터 적재 스크립트
import pandas as pd
from datetime import date
import db

EXCEL_PATH = "Raw File/PMS.xlsx"
REPORT_DATE = date.today().isoformat()

# 열 인덱스 (헤더 2행 건너뜀)
COL = {
    "wbs_level":      0,
    "activity_id":    1,
    "activity_name":  2,
    "budgeted_units": 3,
    "actual_start":   4,
    "actual_finish":  5,
    "actual_quantity":6,
    "design_quantity":7,
    "gap":            8,
    "prev_week_qty":  9,
    "unit_type":     10,  # Previous Week Unit → D/I or %
    "this_week_qty": 11,
    "actual_total":  13,
    "department":    15,
    "local_staff":   16,
    "korean_staff":  17,
}


def _num(val):
    if pd.isna(val):
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except ValueError:
        return None


def _str(val):
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s or None


def _int(val):
    n = _num(val)
    return int(n) if n is not None else None


def main():
    df = pd.read_excel(EXCEL_PATH, header=None, skiprows=2)

    activities, progress = [], []

    for _, row in df.iterrows():
        act_id = _str(row[COL["activity_id"]])
        if not act_id:
            continue

        unit_no = act_id[:3] if len(act_id) >= 3 else None

        activities.append({
            "wbs_level":      _int(row[COL["wbs_level"]]),
            "activity_id":    act_id,
            "activity_name":  _str(row[COL["activity_name"]]),
            "budgeted_units": _num(row[COL["budgeted_units"]]),
            "unit_type":      _str(row[COL["unit_type"]]),
            "unit_no":        unit_no,
            "department":     _str(row[COL["department"]]),
        })

        progress.append({
            "activity_id":      act_id,
            "report_date":      REPORT_DATE,
            "actual_start":     _str(row[COL["actual_start"]]),
            "actual_finish":    _str(row[COL["actual_finish"]]),
            "actual_quantity":  _str(row[COL["actual_quantity"]]),
            "design_quantity":  _num(row[COL["design_quantity"]]),
            "gap":              _num(row[COL["gap"]]),
            "prev_week_qty":    _num(row[COL["prev_week_qty"]]),
            "this_week_qty":    _num(row[COL["this_week_qty"]]),
            "actual_total_qty": _num(row[COL["actual_total"]]),
            "local_staff":      _int(row[COL["local_staff"]]),
            "korean_staff":     _int(row[COL["korean_staff"]]),
        })

    print(f"[activities] {len(activities)}개 upsert 중...")
    res = db.upsert("activities", activities, on_conflict="activity_id")
    print(f"  → {len(res)}개 완료")

    print(f"[weekly_progress] {len(progress)}개 upsert 중 (기준일: {REPORT_DATE})...")
    res = db.upsert("weekly_progress", progress, on_conflict="activity_id,report_date")
    print(f"  → {len(res)}개 완료")

    print("데이터 적재 완료!")


if __name__ == "__main__":
    main()
