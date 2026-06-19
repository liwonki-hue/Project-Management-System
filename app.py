# PMS Dashboard Flask 서버 — API 라우트 + 정적 파일 서빙
from flask import Flask, jsonify, render_template, request
from flask_compress import Compress
from concurrent.futures import ThreadPoolExecutor
import db

app = Flask(__name__)
Compress(app)


def _patch_progress(p):
    aid = p['activity_id']
    rdt = p.get('report_date')
    if not rdt:
        return None
    patch_data = {k: v for k, v in p.items() if k not in ('activity_id', 'report_date')}
    # NOT NULL 컬럼(prev_week_qty, this_week_qty)은 null 대신 0으로 초기화
    for f in ('prev_week_qty', 'this_week_qty'):
        if patch_data.get(f) is None:
            patch_data[f] = 0
    try:
        db.patch('weekly_progress', patch_data, activity_id=aid, report_date=rdt)
        return None
    except Exception as e:
        return f'{aid}/{rdt}: {e}'


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/activities')
def get_activities():
    data = db.select('activities', order='activity_id.asc')
    return jsonify(data)


@app.route('/api/progress')
def get_progress():
    data = db.select('weekly_progress', order='report_date.desc')
    return jsonify(data)


@app.route('/api/save_batch', methods=['POST'])
def save_batch():
    try:
        body = request.get_json()

        # activities: 변경값이 있는 항목만 배치 upsert
        act_records = []
        for u in body.get('activities', []):
            aid = u.get('activity_id')
            if not aid:
                continue
            data = {k: v for k, v in u.items() if k != 'activity_id' and v is not None}
            if data:
                act_records.append({'activity_id': aid, **data})
        if act_records:
            db.upsert('activities', act_records, on_conflict='activity_id')

        # weekly_progress: 기존 레코드는 PATCH(null 포함 전체 덮어씀), 신규만 upsert
        # merge-duplicates는 null을 무시하므로 기존 레코드의 값 삭제가 불가능 — PATCH로 처리
        upsert_records = []
        patch_records  = []
        for u in body.get('progress', []):
            aid = u.get('activity_id')
            if not aid:
                continue
            exists_in_db = bool(u.get('exists_in_db'))
            data = {k: (v if v != '' else None) for k, v in u.items()
                    if k not in ('activity_id', 'exists_in_db')}
            if not data.get('report_date'):
                continue
            if exists_in_db:
                patch_records.append({'activity_id': aid, **data})
            else:
                has_data = any(data.get(f) is not None
                              for f in ('actual_start', 'actual_finish', 'prev_week_qty', 'this_week_qty'))
                if has_data:
                    upsert_records.append({'activity_id': aid, **data})

        if upsert_records:
            db.upsert('weekly_progress', upsert_records, on_conflict='activity_id,report_date')

        errors = []
        if patch_records:
            with ThreadPoolExecutor(max_workers=10) as executor:
                results = list(executor.map(_patch_progress, patch_records))
            errors = [r for r in results if r]
            for e in errors:
                print(f'[PATCH 실패] {e}')

        return jsonify({'ok': True, 'errors': errors})

    except Exception as e:
        print(f'[save_batch 오류] {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/progress/<activity_id>/dates', methods=['PATCH'])
def update_dates(activity_id):
    body = request.get_json()
    data = {k: (body[k] or None) for k in ('actual_start', 'actual_finish') if k in body}
    if not data:
        return jsonify({'error': 'no fields'}), 400
    result = db.patch('weekly_progress', data, activity_id=activity_id)
    return jsonify(result)


@app.route('/api/activities/<activity_id>/unit_type', methods=['PATCH'])
def update_unit_type(activity_id):
    body = request.get_json()
    unit_type = body.get('unit_type', '')
    if unit_type not in ('DI', '%', 'EA'):
        return jsonify({'error': 'invalid unit_type'}), 400
    result = db.patch('activities', {'unit_type': unit_type}, activity_id=activity_id)
    return jsonify(result)


if __name__ == '__main__':
    app.run(debug=True, threaded=True)
