# PMS Dashboard Flask 서버 — API 라우트 + 정적 파일 서빙
from flask import Flask, jsonify, render_template
import db

app = Flask(__name__)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/activities')
def get_activities():
    data = db.select('activities', order='unit_no.asc,activity_id.asc')
    return jsonify(data)


@app.route('/api/progress')
def get_progress():
    data = db.select('weekly_progress', order='report_date.desc')
    return jsonify(data)


if __name__ == '__main__':
    app.run(debug=True)
