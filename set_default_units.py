# Unit이 비어있는 Activity에 unit_type='%', budgeted_units=100 일괄 설정
import os, requests
from dotenv import load_dotenv

load_dotenv()
BASE = f"{os.getenv('SUPABASE_URL')}/rest/v1"
HEADERS = {
    "apikey":          os.getenv("SUPABASE_KEY"),
    "Authorization":   f"Bearer {os.getenv('SUPABASE_KEY')}",
    "Accept-Profile":  "pms",
    "Content-Profile": "pms",
    "Content-Type":    "application/json",
}

r = requests.get(f"{BASE}/activities", headers=HEADERS,
                 params={"select": "activity_id,unit_type,budgeted_units"}, timeout=30)
r.raise_for_status()
activities = r.json()

to_update = [a for a in activities if not a.get("unit_type")]
print(f"대상 Activity: {len(to_update)} 건")
if not to_update:
    print("업데이트할 항목 없음.")
else:
    records = [{"activity_id": a["activity_id"], "unit_type": "%", "budgeted_units": 100}
               for a in to_update]
    r2 = requests.post(
        f"{BASE}/activities",
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
        params={"on_conflict": "activity_id"},
        json=records, timeout=30,
    )
    r2.raise_for_status()
    print(f"완료: {len(r2.json())} 건 업데이트 (unit_type='%', budgeted_units=100)")
