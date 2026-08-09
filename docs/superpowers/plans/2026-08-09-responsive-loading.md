# Responsive Auto-Fit + Loading Delay Fix — Plan

> Spec: `docs/superpowers/specs/2026-08-09-responsive-loading-design.md`

## Task 1: 로딩 지연 수정 (`static/js/app.js`)

- [ ] `loadData()`에서 `activities`/`progress`를 먼저 병렬로 fetch → 렌더링
- [ ] `sync_jm`은 `await` 없이 fire-and-forget으로 실행
- [ ] `sync_jm` 응답에서 `synced > 0`이면 `activities`/`progress` 재조회 후 조용히 재렌더링
- [ ] 브라우저에서 실제 로딩 체감 속도 확인 (Network 탭으로 순서 확인)
- [ ] 커밋

## Task 2: 데스크톱 auto-fit scale (`templates/index.html`, `static/css/style.css`, `static/js/app.js`)

- [ ] `.layout`을 감싸는 `#app-scale` 컨테이너 추가 (또는 `.layout` 자체에 적용)
- [ ] JS: 뷰포트 폭 ≥ 1280px일 때 `scale(viewportWidth / 1920)` 적용, resize 시 디바운스 재계산
- [ ] 1280px 미만에서는 scale 미적용(1:1)
- [ ] 여러 뷰포트 폭(1366 / 1920 / 2560 / 3840)에서 가로스크롤 없이 꽉 차는지 확인

## Task 3: 태블릿 레이아웃 (`static/css/style.css`)

- [ ] `@media (max-width: 1279px)` 블록 추가
- [ ] 사이드바 아이콘 전용 축소
- [ ] KPI 카드 2열 줄바꿈
- [ ] 차트 3개 세로 스택
- [ ] 활동 테이블 가로스크롤 유지 확인 (768~1024px)

## Task 4: 검증 및 커밋

- [ ] `python app.py` 재기동 후 브라우저(또는 Playwright)로 데스크톱/태블릿 폭 각각 확인
- [ ] 기존 기능(필터, 저장, Export, 탭 전환) 회귀 없는지 확인
- [ ] git commit (semantic, 로딩 수정과 반응형 작업 분리)
