# PMS Dashboard — Streamlit 웹 대시보드
import streamlit as st
import pandas as pd
import plotly.express as px
import db

st.set_page_config(page_title="PMS Dashboard", layout="wide", page_icon="📊")


@st.cache_data(ttl=300)
def load_data():
    acts = pd.DataFrame(db.select("activities"))
    if acts.empty:
        return acts

    prog_all = pd.DataFrame(
        db.select(
            "weekly_progress",
            columns="activity_id,report_date,actual_start,actual_finish,"
                    "actual_quantity,prev_week_qty,this_week_qty,actual_total_qty,"
                    "local_staff,korean_staff",
            order="report_date.desc",
        )
    )
    if prog_all.empty:
        return acts

    prog_all["report_date"] = pd.to_datetime(prog_all["report_date"])
    latest = prog_all.drop_duplicates("activity_id", keep="first")
    return acts.merge(latest, on="activity_id", how="left")


# ── Sidebar ──────────────────────────────────────────────────
with st.sidebar:
    st.title("🔧 필터")
    if st.button("🔄 새로고침"):
        st.cache_data.clear()
        st.rerun()

    unit_options = ["1CF", "2CF", "0CF"]
    selected_units = st.multiselect("Unit", unit_options, default=unit_options)
    unit_type_opt = st.radio("단위 유형", ["전체", "D/I", "%"])
    search = st.text_input("Activity 검색", placeholder="이름 또는 ID")

# ── 데이터 로드 ──────────────────────────────────────────────
df = load_data()

if df.empty:
    st.warning("데이터가 없습니다. load_data.py를 먼저 실행하세요.")
    st.stop()

# 필터 적용
if selected_units:
    df = df[df["unit_no"].isin(selected_units)]
if unit_type_opt != "전체":
    df = df[df["unit_type"] == unit_type_opt]
if search:
    mask = (
        df["activity_name"].str.contains(search, case=False, na=False)
        | df["activity_id"].str.contains(search, case=False, na=False)
    )
    df = df[mask]

# ── 제목 ─────────────────────────────────────────────────────
st.title("📊 PMS Dashboard")
if "report_date" in df.columns and df["report_date"].notna().any():
    last_date = df["report_date"].max()
    st.caption(f"기준일: {last_date.strftime('%Y-%m-%d')} | 총 {len(df):,}개 Activity")
else:
    st.caption(f"총 {len(df):,}개 Activity")

# ── KPI 카드 ─────────────────────────────────────────────────
c1, c2, c3, c4 = st.columns(4)

with c1:
    st.metric("전체 Activity", f"{len(df):,}")

with c2:
    di_budget = df[df["unit_type"] == "D/I"]["budgeted_units"].sum()
    st.metric("D/I 예산 합계", f"{di_budget:,.0f}")

with c3:
    pct_df = df[df["unit_type"] == "%"].copy()
    pct_df["_qty"] = pd.to_numeric(pct_df["actual_quantity"], errors="coerce")
    completed = (pct_df["_qty"] >= 100).sum()
    st.metric("% 완료 Activity", f"{completed:,} / {len(pct_df):,}")

with c4:
    this_week_count = df["this_week_qty"].notna().sum() if "this_week_qty" in df.columns else 0
    st.metric("금주 실적 등록", f"{this_week_count:,}개")

st.divider()

# ── 탭 ───────────────────────────────────────────────────────
tab1, tab2 = st.tabs(["📋 Activity 목록", "📈 차트"])

with tab1:
    col_cfg = {
        "unit_no":         st.column_config.TextColumn("Unit", width="small"),
        "activity_id":     st.column_config.TextColumn("Activity ID", width="medium"),
        "activity_name":   st.column_config.TextColumn("Activity Name", width="large"),
        "budgeted_units":  st.column_config.NumberColumn("예산 물량", format="%,.0f"),
        "unit_type":       st.column_config.TextColumn("단위", width="small"),
        "actual_quantity": st.column_config.TextColumn("현황"),
        "prev_week_qty":   st.column_config.NumberColumn("전주", format="%,.1f"),
        "this_week_qty":   st.column_config.NumberColumn("금주", format="%,.1f"),
        "actual_total_qty":st.column_config.NumberColumn("누계", format="%,.1f"),
        "report_date":     st.column_config.DateColumn("기준일"),
    }
    show_cols = [c for c in col_cfg if c in df.columns]
    st.dataframe(
        df[show_cols],
        use_container_width=True,
        hide_index=True,
        column_config=col_cfg,
        height=580,
    )

with tab2:
    row1_c1, row1_c2 = st.columns(2)

    with row1_c1:
        chart = df.groupby(["unit_no", "unit_type"])["budgeted_units"].sum().reset_index()
        fig = px.bar(
            chart, x="unit_no", y="budgeted_units", color="unit_type",
            labels={"unit_no": "Unit", "budgeted_units": "예산 물량", "unit_type": "단위"},
            title="Unit별 예산 물량",
            color_discrete_map={"D/I": "#1f77b4", "%": "#ff7f0e"},
        )
        st.plotly_chart(fig, use_container_width=True)

    with row1_c2:
        type_counts = df["unit_type"].value_counts().reset_index()
        type_counts.columns = ["단위 유형", "Activity 수"]
        fig2 = px.pie(
            type_counts, names="단위 유형", values="Activity 수",
            title="Activity 유형 분포",
        )
        st.plotly_chart(fig2, use_container_width=True)

    # Unit별 Activity 수
    unit_counts = df.groupby("unit_no").size().reset_index(name="Activity 수")
    fig3 = px.bar(
        unit_counts, x="unit_no", y="Activity 수",
        labels={"unit_no": "Unit"},
        title="Unit별 Activity 수",
        text_auto=True,
    )
    st.plotly_chart(fig3, use_container_width=True)
