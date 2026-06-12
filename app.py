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
    for u in body.get('activities', []):
        aid = u.get('activity_id')
        if not aid: continue
        data = {k: v for k, v in u.items() if k != 'activity_id' and v is not None}
        if data:
            db.patch('activities', data, activity_id=aid)
    for u in body.get('progress', []):
        aid = u.get('activity_id')
        if not aid: continue
        data = {k: (v if v != '' else None) for k, v in u.items() if k != 'activity_id'}
        if any(v is not None for v in data.values()):
            db.patch('weekly_progress', data, activity_id=aid)
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
    if unit_type not in ('DI', '%'):
        return jsonify({'error': 'invalid unit_type'}), 400
    result = db.patch('activities', {'unit_type': unit_type}, activity_id=activity_id)
    return jsonify(result)


if __name__ == '__main__':
    app.run(debug=True, threaded=True)
