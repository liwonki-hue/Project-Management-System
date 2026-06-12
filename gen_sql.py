# Excel → SQL INSERT 파일 생성 → Supabase SQL Editor에서 실행
import pandas as pd
from datetime import date

EXCEL_PATH = "Raw File/PMS.xlsx"
REPORT_DATE = date.today().isoformat()
OUTPUT = "insert_pms_data.sql"

COL = {
    "wbs_level": 0, "activity_id": 1, "activity_name": 2,
    "budgeted_units": 3, "actual_start": 4, "actual_finish": 5,
    "actual_quantity": 6, "design_quantity": 7, "gap": 8,
    "prev_week_qty": 9, "unit_type": 10, "this_week_qty": 11,
    "actual_total": 13, "department": 15, "local_staff": 16, "korean_staff": 17,
}


def _sql_val(val):
    if val is None or (isinstance(val, float) and val != val):
        return "NULL"
    if isinstance(val, str):
        cleaned = val.replace("\n", " ").replace("\r", "").replace("'", "''")
        return "'" + cleaned + "'"
    return str(val)


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

    act_rows, prog_rows = [], []

    for _, row in df.iterrows():
        act_id = _str(row[COL["activity_id"]])
        if not act_id:
            continue

        unit_no = act_id[:3] if len(act_id) >= 3 else None

        act_rows.append((
            _int(row[COL["wbs_level"]]),
            act_id,
            _str(row[COL["activity_name"]]),
            _num(row[COL["budgeted_units"]]),
            _str(row[COL["unit_type"]]),
            unit_no,
            _str(row[COL["department"]]),
        ))

        prog_rows.append((
            act_id,
            REPORT_DATE,
            _str(row[COL["actual_start"]]),
            _str(row[COL["actual_finish"]]),
            _str(row[COL["actual_quantity"]]),
            _num(row[COL["design_quantity"]]),
            _num(row[COL["gap"]]),
            _num(row[COL["prev_week_qty"]]),
            _num(row[COL["this_week_qty"]]),
            _num(row[COL["actual_total"]]),
            _int(row[COL["local_staff"]]),
            _int(row[COL["korean_staff"]]),
        ))

    lines = [
        "-- PMS 초기 데이터 적재",
        f"-- 기준일: {REPORT_DATE}",
        "",
        "TRUNCATE pms.weekly_progress;",
        "TRUNCATE pms.activities CASCADE;",
        "",
        "INSERT INTO pms.activities",
        "  (wbs_level, activity_id, activity_name, budgeted_units, unit_type, unit_no, department)",
        "VALUES",
    ]
    act_vals = [
        f"  ({', '.join(_sql_val(v) for v in r)})"
        for r in act_rows
    ]
    lines.append(",\n".join(act_vals) + ";")

    lines += [
        "",
        "INSERT INTO pms.weekly_progress",
        "  (activity_id, report_date, actual_start, actual_finish, actual_quantity,",
        "   design_quantity, gap, prev_week_qty, this_week_qty, actual_total_qty,",
        "   local_staff, korean_staff)",
        "VALUES",
    ]
    prog_vals = [
        f"  ({', '.join(_sql_val(v) for v in r)})"
        for r in prog_rows
    ]
    lines.append(",\n".join(prog_vals) + ";")

    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"생성 완료: {OUTPUT}")
    print(f"  activities: {len(act_rows)}개")
    print(f"  weekly_progress: {len(prog_rows)}개")
    print(f"Supabase SQL Editor에서 {OUTPUT} 내용을 실행하세요.")


if __name__ == "__main__":
    main()
