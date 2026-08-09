# 진행률(Prev/This Week Qty)은 있지만 Actual Start가 비어있는 기존 weekly_progress 행을,
# 해당 Activity의 최초 진행 발생일(가장 이른 report_date)로 소급 채우는 1회성 스크립트.
# 기본은 대상 목록만 출력(dry-run)하며, --apply 옵션을 줘야 실제로 DB에 반영한다.
import sys
import db


def has_qty(r):
    return (r.get('prev_week_qty') or 0) > 0 or (r.get('this_week_qty') or 0) > 0


def main():
    rows = db.select('weekly_progress',
                      columns='activity_id,report_date,prev_week_qty,this_week_qty,actual_start')

    # activity_id별 최초(가장 이른) 진행 발생일
    first_progress_date = {}
    for r in rows:
        if not has_qty(r):
            continue
        aid = r['activity_id']
        if aid not in first_progress_date or r['report_date'] < first_progress_date[aid]:
            first_progress_date[aid] = r['report_date']

    targets = [r for r in rows if has_qty(r) and not r.get('actual_start')]

    print(f"대상 행: {len(targets)}건")
    for r in targets:
        aid = r['activity_id']
        print(f"  {aid} / report_date={r['report_date']} -> actual_start = {first_progress_date[aid]}")

    if not targets:
        return

    if '--apply' not in sys.argv:
        print("\n실제 반영하려면 --apply 옵션을 붙여 실행하세요. (지금은 dry-run)")
        return

    ok = 0
    for r in targets:
        aid = r['activity_id']
        db.patch('weekly_progress', {'actual_start': first_progress_date[aid]},
                  activity_id=aid, report_date=r['report_date'])
        ok += 1
    print(f"\n완료: {ok}건 반영")


if __name__ == '__main__':
    main()
