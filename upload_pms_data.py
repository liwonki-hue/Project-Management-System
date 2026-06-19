# PMS Data.xlsx → Supabase 업로드 스크립트
# 작업 내용:
#   1. 기존 레코드: area_system 업데이트 + Discipline 충돌 16개 수정 (Excel 기준, 대문자)
#   2. 신규 31개 레코드 삽입 (unit_no: B0→0CF, B1→1CF, B2→2CF 변환)
#   3. 모든 텍스트 값 영문 대문자로 통일

import openpyxl
import db

BLOCK_MAP = {'B0': '0CF', 'B1': '1CF', 'B2': '2CF'}


def to_upper(val):
    if val is None:
        return None
    s = str(val).strip()
    return s.upper() if s else None


def load_excel():
    wb = openpyxl.load_workbook('Raw File/PMS Data.xlsx', read_only=True, data_only=True)
    ws = wb['Sheet2']
    rows = list(ws.iter_rows(values_only=True))
    # 헤더: WBS Level, Block, Discipline, Area(System), Activity ID, Activity Name,
    #        Weight, Actual Start, Actual Finish, Unit, Previous Week, This Week
    result = []
    for r in rows[1:]:
        aid = str(r[4]).strip() if r[4] else None
        if not aid:
            continue
        result.append({
            'wbs_level':     r[0],
            'block_excel':   str(r[1]).strip() if r[1] else None,
            'discipline':    to_upper(r[2]),
            'area_system':   to_upper(r[3]),
            'activity_id':   aid,
            'activity_name': str(r[5]).strip().upper() if r[5] else None,
            'weight_factor': float(r[6]) if r[6] is not None else None,
            'unit_type':     to_upper(r[9]),
        })
    return result


def main():
    print('=== PMS Data 업로드 시작 ===\n')
    excel_rows = load_excel()
    excel_map = {r['activity_id']: r for r in excel_rows}

    db_data = db.select('activities', order='activity_id.asc')
    db_ids = set(r['activity_id'] for r in db_data)
    excel_ids = set(excel_map.keys())

    # ── 1. 기존 레코드 area_system 업데이트 + Discipline 16개 수정 ──
    update_records = []
    for r in db_data:
        aid = r['activity_id']
        if aid not in excel_ids:
            continue
        ex = excel_map[aid]
        patch = {'area_system': ex['area_system']}
        # Discipline: DB 값(대문자)과 Excel 값이 다르면 Excel로 덮어씀
        db_dept_upper = (r['department'] or '').strip().upper()
        if ex['discipline'] and ex['discipline'] != db_dept_upper:
            patch['department'] = ex['discipline']
        update_records.append((aid, patch))

    print(f'기존 레코드 업데이트 대상: {len(update_records)}개')
    ok_count = 0
    err_count = 0
    for aid, patch in update_records:
        try:
            db.patch('activities', patch, activity_id=aid)
            ok_count += 1
        except Exception as e:
            print(f'  [오류] {aid}: {e}')
            err_count += 1
    print(f'  완료: {ok_count}개 성공, {err_count}개 실패\n')

    # ── 2. 신규 레코드 삽입 (Excel에만 있는 31개) ──
    new_ids = excel_ids - db_ids
    new_records = []
    for aid in sorted(new_ids):
        ex = excel_map[aid]
        unit_no = BLOCK_MAP.get(ex['block_excel'], ex['block_excel'])
        rec = {
            'activity_id':   aid,
            'wbs_level':     ex['wbs_level'],
            'unit_no':       unit_no,
            'department':    ex['discipline'],
            'area_system':   ex['area_system'],
            'activity_name': ex['activity_name'],
            'weight_factor': ex['weight_factor'],
        }
        if ex['unit_type']:
            rec['unit_type'] = ex['unit_type']
        new_records.append(rec)

    print(f'신규 삽입 대상: {len(new_records)}개')
    if new_records:
        try:
            db.upsert('activities', new_records, on_conflict='activity_id')
            print(f'  삽입 완료: {len(new_records)}개\n')
        except Exception as e:
            print(f'  [오류] 신규 삽입 실패: {e}\n')

    # ── 3. 기존 DB 전체 텍스트 대문자 통일 (department, activity_name) ──
    db_data_fresh = db.select('activities', order='activity_id.asc')
    uppercase_updates = []
    for r in db_data_fresh:
        patch = {}
        dept = r.get('department') or ''
        name = r.get('activity_name') or ''
        area = r.get('area_system') or ''
        if dept and dept != dept.upper():
            patch['department'] = dept.upper()
        if name and name != name.upper():
            patch['activity_name'] = name.upper()
        if area and area != area.upper():
            patch['area_system'] = area.upper()
        if patch:
            uppercase_updates.append((r['activity_id'], patch))

    print(f'대문자 변환 대상: {len(uppercase_updates)}개')
    ok2 = 0
    for aid, patch in uppercase_updates:
        try:
            db.patch('activities', patch, activity_id=aid)
            ok2 += 1
        except Exception as e:
            print(f'  [오류] {aid}: {e}')
    print(f'  대문자 변환 완료: {ok2}개\n')

    print('=== 업로드 완료 ===')


if __name__ == '__main__':
    main()
