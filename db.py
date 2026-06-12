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


def select(table, columns="*", order=None, **eq_filters):
    params = {"select": columns}
    if order:
        params["order"] = order
    for k, v in eq_filters.items():
        params[k] = f"eq.{v}"
    r = requests.get(f"{_BASE}/{table}", headers=_HEADERS, params=params)
    r.raise_for_status()
    return r.json()


def patch(table, data, **eq_filters):
    h = {
        **_HEADERS,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    params = {k: f"eq.{v}" for k, v in eq_filters.items()}
    r = requests.patch(f"{_BASE}/{table}", headers=h, params=params, json=data)
    r.raise_for_status()
    return r.json()


