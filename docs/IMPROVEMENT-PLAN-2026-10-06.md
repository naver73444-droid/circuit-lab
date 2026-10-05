# Circuit Lab 개선 기록 (2026-10-06)

기준: `c1b3c44`(원본 제품 3a872a2 소스 사본). 작업 사본 `D:\AI\circuit-lab-work`. **배포는 하지 않았다** — 사용자 확인 후 별도 진행.
시험: 기준선 757개 중 747 통과(낡은 계약 10건 실패) → 현재 단위 978/978, 헤드리스 브라우저 스모크 58/58, 경계 검사 오류 0.
검토: Sonnet 하위 에이전트 실행 + 보조 GPT(codex_alt)·보조 Claude(claude_alt) 교차 리뷰 5회(재현된 결함 총 63건 수정).

## 1. 성능
| 항목 | 전 | 후 |
|---|---|---|
| 첫 로드 JS (탭 지연 로딩) | 75모듈·1.07MB | 37모듈·0.37MB |
| 모바일 저속 DCL | 7.1 s | 3.2 s |
| RC 사다리 15단 과도 5000스텝 | ~1.2 s | ~0.14 s |
| AC 1000점 | ~130 ms | ~12–23 ms |
| 전자기 미적분(16전하) | 378 ms | 140 ms |
| 부품 드래그 1스텝 태스크(60부품) | 16.9 ms | 3.2 ms |

## 2. 구조 단순화
- app.js 2301줄 → 351줄 + 책임별 모듈(editor-session, canvas-renderer, analysis-runner, inspector, project-io, editor-input 등).
- 자유 배치 패널(드래그·도킹·구분선·배치 저장) 제거 → 고정 레이아웃(부품 | 캔버스 | 속성·결과, 하단 파형, 모바일 하단 탭).
- 해석 종류 선택 1곳, 개발 흔적 문구·중복 버튼·숨은 바·인라인 style 7개·미사용 CSS 제거, 런타임 마크업 재작성 제거.
- 시험을 tests/engine·ui-model·tooling·browser로 재편, 소스 문자열 정규식 시험·frozen 사본·외부 드라이버 의존 제거.

## 3. 추가 기능 (타 앱 비교: Falstad, CircuitLab, EveryCircuit, iCircuit, PhET, Multisim Live, LTspice)
- 탭별 자동저장 + 복원 배너, 링크(#p=) 공유
- 단축키(Shift+R, Ctrl+S, Ctrl+Enter, W/V, 방향키, Ctrl+C/X/V/A), 값 글자 위 휠 E12 조절
- 호버 판독(노드 전압·소자 전류·전력), 자동 측정(Vpp·RMS·주기·−3dB…), A/B 두 커서
- 파라미터 스윕 겹쳐 그리기, 전류 흐름 보기(기본 꺼짐, reduced-motion 대응)
- 다중 선택(Shift+클릭·Shift+상자)·묶음 편집, 핀에서 끌어 배선, "파형 크게"

## 4. 남은 판단 (사용자 확인 필요)
- 배포: 이 작업본을 learning 사이트(현재 v4)에 올릴지. 올리면 v4에서 빠진 Y–Δ 계산기 처리도 함께 결정.
- 원본 Codex 저장소(`C:\Users\alswn\.codex\.chatgpt-projects\...`)에 반영할지 — 손대지 않았다.
- Worker 재사용은 하지 않음(요청마다 생성·종료). 필요 시 별도 작업.
- 경고로 남은 큰 파일: circuit-engine.js(약 1650줄), editor-input.js(약 1000줄).
