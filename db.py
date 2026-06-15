# Supabase REST API 호출 헬퍼 — pms 스키마 전용
import os
import requests
from dotenv import load_dotenv

load_dotenv()

_URL = os.getenv("SUPABASE_URL")
_KEY = os.getenv("SUPABASE_KEY")
_BASE = f"{_URL}/rest/v1"
_HEADERS = {
    "apikey": _KEY,
    "Authorization": f"Bearer {_KEY}",
    "Accept-Profile": "pms",
    "Content-Profile": "pms",
}

_session = requests.Session()
_session.headers.update(_HEADERS)


def select(table, columns="*", order=None, **eq_filters):
    params = {"select": columns}
    if order:
        params["order"] = order
    for k, v in eq_filters.items():
        params[k] = f"eq.{v}"
    r = _session.get(f"{_BASE}/{table}", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def patch(table, data, **eq_filters):
    params = {k: f"eq.{v}" for k, v in eq_filters.items()}
    r = _session.patch(
        f"{_BASE}/{table}",
        headers={"Content-Type": "application/json", "Prefer": "return=representation"},
        params=params,
        json=data,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def upsert(table, data, on_conflict):
    r = _session.post(
        f"{_BASE}/{table}",
        headers={
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        params={"on_conflict": on_conflict},
        json=data,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def delete_in(table, field, values):
    vals = ','.join(str(v) for v in values)
    r = _session.delete(
        f"{_BASE}/{table}",
        headers={"Prefer": "return=representation"},
        params={field: f"in.({vals})"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()
