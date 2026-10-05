# Circuit Lab에 맞는 GitHub 도구 조사

조사 기준일: 2026-09-12. 아래는 저장소/공식 문서에서 확인한 기능과 이 프로젝트에 대한 적용 제안을 구분한 자료다. 별표 수나 인기 순위는 선정 기준으로 사용하지 않았다. 외부 도구를 사용자 PC에 설치하거나 계정을 연결하지 않았다.

## 결론
Godot용 Skill을 그대로 옮기는 것보다 **프로젝트 전용 작성 경계 + 브라우저 회귀시험 + 선택적인 정적 검사**가 적합하다. Circuit Lab은 HTML/CSS/ES modules 기반이고 수치 모델이 중요하므로 React 전용 최적화 Skill, 대형 UI 프레임워크, Godot의 `.tscn` 검사기를 도입할 이유는 없다.

| 도구/공식 저장소 | 자료에서 확인한 기능 | Circuit Lab 적용 제안 | 이번 작업 상태 |
|---|---|---|---|
| [Impeccable](https://github.com/pbakaus/impeccable) | AI 프론트엔드 설계 Skill. audit, critique, quieter, distill, harden, adapt 등 | UI 장식 제거, 정보 우선순위, 작은 화면·오류 상태 검토에 한정. 계측 화면을 랜딩 페이지로 바꾸지 않기 | 조사만. 설치·실행하지 않음 |
| [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli) | 브라우저 조작, 선택자 확인, 스크린샷, 코드 기록, 에이전트 Skill | 스크린샷을 매번 수동 분석하는 대신 클릭·휠·입력·레이아웃을 회귀시험으로 보존 | CLI/Skill은 미설치. 이번 시험은 별도로 준비된 Python Playwright 사용 |
| [jscpd](https://github.com/kucherenko/jscpd) | 소스 복사/붙여넣기 중복 탐지 | app/CSS/상태 처리 중복을 찾는 보조 검토. 수학적으로 비슷한 AC/DC 수식을 자동 병합하지 않기 | 미실행. 중복률 수치 없음 |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | 모듈 의존성 검증·시각화, 규칙 적용 | 엔진→UI 역의존, 순환 참조를 금지하는 규칙. Godot 경계 원칙에 가장 가까운 정적 검사 도구 | 미실행. 대신 이번에는 무의존성 경량 검사기를 직접 작성·실행 |
| [Knip](https://github.com/webpro-nl/knip) | JS/TS 미사용 파일·의존성·export 탐지 | HTML에서 시작되는 `src/app.js`, 서버, exporter, 시험을 명시적 entry로 지정한 뒤 사용 | 미실행. 결과를 근거로 삭제한 파일 없음 |

## 외부 Skill 사용 순서 제안

우선 번들에 포함한 `AGENTS.md`, `DESIGN.md`, `.agents/skills/circuit-lab-boundary/SKILL.md`를 개발 세션에서 읽는다. 이것은 이 프로젝트를 위해 새로 작성한 지침이며 외부 Skill의 복제품이 아니다. `.agents/skills`와 `SKILL.md`의 name/description 구성은 [OpenAI 공식 Skill 문서](https://developers.openai.com/codex/skills)를 따른다. 실제 인식 여부는 사용 중인 클라이언트의 Skill 목록에서 확인한다. 이 채팅에서 사용자의 Codex 설정을 변경한 것은 아니다.

Impeccable을 도입할 때는 저장소 지침상 설치 명령이 `npx impeccable install`이고, 설치 범위·provider·hook 승인이 별도로 있다. 자동 전역 설치를 권하지 않는다. 최신 실행 파일을 내려받을 수 있으므로 설치 전에 릴리스/변경 내용과 프로젝트 범위를 확인한다. 이 검토본은 Impeccable이 없어도 실행된다.

이 프로젝트의 디자인 작업 예시는 다음과 같다. 이는 설치된 환경에서 사용할 요청 예시이며 실행 로그가 아니다.

```text
/impeccable audit Circuit Lab의 입력 오류, 1024px 레이아웃, 그래프 조작
/impeccable quieter 발광·큰 그림자·장식 카드만 줄이고 파형 색 구분은 유지
/impeccable distill 해석 선택을 관찰 목적 하나로 정리
/impeccable harden 숫자 입력 중 상태와 회로 전환 타이머
```

Playwright CLI는 저장소에서 `npm install -g @playwright/cli@latest`, `playwright-cli install --skills`를 안내한다. 전역 설치를 지금 실행한 것은 아니다. 기존 브라우저 자동화가 있으면 CLI/MCP/다른 래퍼를 동시에 중복 설치하기보다 한 경로로 시험을 고정한다. 토큰 절약률은 이번 작업에서 측정하지 않았다.

jscpd/Knip/dependency-cruiser는 실제 도입 시 버전을 고정하고 첫 결과를 사람이 검토한다. 미사용/중복이라는 이유만으로 exporter, HTML entry, 시험 fixture, 물리량별 공식을 자동 삭제하지 않는다.

## 이번에 실제로 적용한 경계

- `scope-model.js`: 1–2–5, 범위, 실제 표본 좌표 검색, 표시용 축소
- `scope-view.js`: 눈금·커서·휠·SVG. 엔진 의존 없음
- `analysis-policy.js`: 변경 가능한 초기 해석 추천. 회로·IC 불변
- `union-find.js`: 엔진/상태 검사 자료구조 중복 제거
- `scripts/check-boundaries.mjs`: 상대 import 존재, 순환 참조, 순수 모델의 DOM 접근 검사

검사기는 정규식 기반 경량 도구다. AST 분석·보안 감사·수치 정확도 증명을 대신하지 않는다. `app.js`가 아직 크다는 경고를 의도적으로 숨기지 않는다.

참고한 Godot 원칙의 원문: [godot-scene-authoring-boundary](https://github.com/macian-games/godot-scene-authoring-boundary). “고정된 작성 구조와 런타임 동작의 책임을 나눈다”는 생각만 참고하며 Godot 파일 형식과 스캐너는 이 프로젝트에 적용하지 않는다.
