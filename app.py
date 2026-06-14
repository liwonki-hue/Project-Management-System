# PMS Dashboard Flask 서버 — API 라우트 + 정적 파일 서빙
from flask import Flask, jsonify, render_template, request
import db

app = Flask(__name__)


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

    # weekly_progress: 값 있으면 upsert, 값 비우면 PATCH(null 명시 UPDATE)
    # merge-duplicates upsert는 null로 기존 값을 덮어쓰지 않으므로 분리 처리
    qty_fields = ('actual_start', 'actual_finish', 'prev_week_qty', 'this_week_qty', 'actual_total_qty')
    upsert_records = []
    patch_records  = []
    for u in body.get('progress', []):
        aid = u.get('activity_id')
        if not aid:
            continue
        data = {k: (v if v != '' else None) for k, v in u.items() if k != 'activity_id'}
        if not data.get('report_date'):
            continue
        if any(data.get(f) is not None for f in qty_fields):
            upsert_records.append({'activity_id': aid, **data})
        else:
            patch_records.append({'activity_id': aid, **data})

    if upsert_records:
        db.upsert('weekly_progress', upsert_records, on_conflict='activity_id,report_date')
    for p in patch_records:
        aid = p['activity_id']
        rdt = p.get('report_date')
        if rdt:
            patch_data = {k: v for k, v in p.items() if k not in ('activity_id', 'report_date')}
            try:
                db.patch('weekly_progress', patch_data, activity_id=aid, report_date=rdt)
            except Exception:
                pass  # 기존 레코드 없으면 무시

    return jsonify({'ok': True})


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
