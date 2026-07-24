# JM(Joint Master) → PMS 피팅 데이터 수동 동기화 CLI — 로직은 jm_sync.py 공용 모듈 사용
import jm_sync


def main():
    result = jm_sync.sync()
    if not result["results"] and not result["failed"]:
        print(f"[오류] {jm_sync.MAPPING_XLS}에 Active='Y' 항목이 없습니다.")
        return

    print(f"Report date (목~수 기준) : {result['report_date']}")
    print()
    for r in result["results"]:
        print(f"[{r['activity_id']}]")
        print(f"  Total DI   : {r['total_di']:.1f}")
        print(f"  Prev week DI (cumul) : {r['prev_di']:.1f}")
        print(f"  This week DI         : {r['this_di']:.1f}")
        print(f"  Start date : {r['start_date'] or '-'}")
        print()

    for f in result["failed"]:
        print(f"[실패] {f}")

    print(f"=== 동기화 완료 : {result['synced']}건 성공, {len(result['failed'])}건 실패 ===")


if __name__ == "__main__":
    main()
