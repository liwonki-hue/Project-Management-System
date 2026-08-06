-- PMS 스키마 생성 및 테이블 설정
-- Supabase SQL Editor에서 실행
-- ※ 실행 전: Settings > API > Extra Schemas 에 "pms" 추가 필요

CREATE SCHEMA IF NOT EXISTS pms;

CREATE TABLE IF NOT EXISTS pms.activities (
    id             serial PRIMARY KEY,
    wbs_level      int,
    activity_id    text UNIQUE NOT NULL,
    activity_name  text,
    budgeted_units numeric,
    unit_type      text,
    unit_no        text,
    department     text
);

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

-- 기존 테이블에 daily_breakdown 컬럼 추가 (최초 1회, 이미 있으면 무시)
ALTER TABLE pms.weekly_progress
  ADD COLUMN IF NOT EXISTS daily_breakdown jsonb DEFAULT '{}'::jsonb;

-- 역할별 접근 권한
GRANT USAGE ON SCHEMA pms TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA pms TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pms TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pms GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pms GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- RLS 비활성화
ALTER TABLE pms.activities DISABLE ROW LEVEL SECURITY;
ALTER TABLE pms.weekly_progress DISABLE ROW LEVEL SECURITY;
