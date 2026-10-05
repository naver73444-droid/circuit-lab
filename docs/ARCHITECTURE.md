# Circuit Lab 구조

빌드·번들러·런타임 의존성이 없는 순수 ES 모듈 앱입니다. 브라우저가 `index.html` → `src/app.js`를 모듈로 직접 불러옵니다. 서버(`server.mjs`)는 `index.html`, `styles.css`, **`src/` 바로 아래의 `[A-Za-z0-9_-]+.js`만** 제공하므로, 새 모듈은 하위 폴더나 점이 든 이름 없이 `src/`에 평평하게 둡니다.

## 의존 방향

```
app.js (조립자, 유일하게 모든 모듈을 앎)
  └─ 회로 편집기 컨트롤러 6종 ─→ 순수 모델·형식 모듈 ─→ circuit-engine.js (DOM 없음)
  └─ 표시 모듈(scope-view, phasor-view, measure-view, sweep-panel)
  └─ [동적 import] em-controller / signals-course-controller / circuit-course-controller
```

- 순수 모델(`*-model`, `*-format`, `circuit-*`, `persistence`, `share-url`, `value-series` …)은 DOM·`window`를 쓰지 않고 `app.js`·뷰·컨트롤러를 import하지 않습니다.
- 컨트롤러 사이의 호출은 `app.js`가 주입한 함수로 합니다(뒤에 만들어질 모듈을 가리키는 호출은 `() => analysis.x()`로 감쌈). import로 얽힌 예외는 `project-io` → `editor-session`(`PROBE_COLORS`)과 `analysis-runner`/`inspector` → `sweep-panel` 정도입니다. `app.js`를 import하는 모듈은 없습니다.
- `circuit-engine.js`는 `union-find.js`만 import합니다. `scope-view.js`·`phasor-view.js`는 engine을 import하지 않습니다(검사됨).
- `npm run check`가 import 사이클·누락 import·순수 모델의 DOM 접근·`app.js` import를 검사합니다(검사 대상 순수 모델 목록은 `scripts/check-boundaries.mjs`의 `pure`).

## 모듈 지도

### 엔진·순수 모델 (DOM 없음)
- `circuit-engine.js` — 값 파싱, 구조 검증·한도, 토폴로지(MNA), DC/과도/AC 해석, LU(실수·복소 typed array, 선형 과도는 dt별 LU 재사용), 직렬화.
- `union-find.js` — 토폴로지·진단용 서로소 집합. `port-analysis.js` — DC 테브난·노턴 포트.
- `analysis-policy.js` — 회로 값에서 해석 종류·범위 제안. `analysis-diagnostics.js` — 오류를 사용자 진단 문구로.
- `circuit-geometry.js`(핀 위치·격자·배선 경로) · `circuit-edit.js`(삭제·분할·세대 검사 `acceptsRunGeneration`) · `circuit-status.js`(연결 상태 분류) · `current-direction.js`(전류 기준 방향·라벨).
- `project-format.js`(JSON 직렬화·검증, version 1~3) · `csv-format.js` · `persistence.js`(탭별 자동저장 슬롯) · `share-url.js`(`#p=` 인코딩·압축·한도).
- `scope-model.js`(눈금·표본 선택) · `plot-format.js` · `measurement-format.js`(dB·위상) · `phasor-format.js` · `cursor-label-model.js` · `cursor-delta-model.js`(A/B 차이) · `measure-model.js`·`wave-measure-model.js`(자동 측정) · `node-readout-model.js`(호버 판독) · `sweep-model.js`(스윕 계획·병합).
- `editor-shortcuts.js`(키 → 동작) · `value-series.js`(E12) · `input-drafts.js`(미확정 입력) · `ui-model.js`(편집 UI 모델) · `interaction-math.js`·`touch-targets.js`·`pointer-session.js`(제스처 계산) · `port-ui-state.js` · `color-model.js` · `phasor-practice-model.js` · `examples.js`.

### 회로 편집기 컨트롤러 (DOM 있음, `app.js`가 조립)
- `editor-session.js` — 편집 상태(`createEditorState`)와 **유일한 편집 경로** `mutate()`(이력·세대·재렌더·자동실행·자동저장 알림), undo/redo, 프로브 추가·제거.
- `canvas-renderer.js` — SVG 캔버스 전체 렌더, 선택 클래스 토글, 드래그 중 부분 갱신.
- `editor-input.js` — 도구·배치·배선·프로브, 캔버스·파형 포인터/휠/키 입력 전부. `canvas-touch.js`(터치 라우팅), `editor-shortcuts.js` 사용.
- `analysis-runner.js` — 해석 수명주기(예약·Worker 실행·취소·stale·진단)와 결과 표시(프로브 목록, 파형, 페이저, 포트 패널). `sweep-runner.js`(스윕), `analysis-worker-client.js`(Worker 1회용 래퍼), `analysis-worker.js`(Worker 본체).
- `inspector.js` — 속성·해석 설정·화면 값 편집·draft 확정. `sweep-panel.js`(스윕 UI).
- `project-io.js` — 예제·새 회로·JSON 저장/열기·CSV·자동저장·복원 배너·링크 공유. 모든 프로젝트 교체는 `openProject()` 한 길.
- `hover-readout.js` — 판독 말풍선. `canvas-notices.js` — 캔버스 위 알림. `responsive-editor.js` — 폰 폭에서 머리줄 요소 재배치(이동만, 재생성 없음). `panel-controller.js` — 고정 레이아웃(폰 하단 탭, `파형 크게`). `theme.js`.
- 표시: `scope-view.js`(파형 SVG, 커서 A/B), `measure-view.js`(측정 요약), `phasor-view.js`·`phasor-practice.js`, `trace-color.js`, `safe-dom.js`(escape).

### 학습 작업공간 (지연 로딩, 회로 편집기와 독립)
- 전자기학: `em-controller.js`(자유실험실·기본 모델·3D, 진입점) · `em-physics.js`/`em-state.js`/`em-view.js`(WebGL)/`em-format.js` · `em-playground-{physics,state,interaction,calculus,project}.js` · 문제 풀이 `em-course-controller.js` + `em-course-registry.js`가 모으는 `em-course-{electrostatics,coaxial,magnetostatics,boundaries,integrals,induction,waves,transmission}.js`(+ `constants`, `view`).
- 신호 및 시스템: `signals-course-controller.js` · `signals-course-model.js` · `signals-expression.js`(제한 산술 AST, JS 평가 없음) · `signals-visual.js`·`signals-convolution-view.js`·`signals-playback.js`.
- 회로 과정(AC·3상): `circuit-course-controller.js` · `circuit-course-registry.js` · `circuit-course-model.js` · `circuit-course-problem{,-symbolic}.js` · `circuit-course-view.js`.
- 공용: `course-focus.js`(재렌더 후 포커스 유지) · `course-style.js`(스타일 1회 주입) · `course-math-view.js`·`course-symbolic-view.js`(수식 표시) · `course-illustration-contract.js`.
- `workspace-tabs.js` — 작업공간 탭과 `createLazyController`.

## 해석 실행 데이터 흐름

공유 `state` 하나를 모듈별 슬라이스(`createEditorState`/`createInputState`/`createRunState`)가 나눠 소유합니다. 핵심 카운터는 `state.generation`(회로·설정이 바뀔 때마다 +1)과 `state.runSerial`(실행·취소마다 +1)입니다.

1. 편집: 입력 모듈 → `session.mutate(change)` → 이력 저장, `change()`, `generation++`, `analysis.markStale()`(진행 중인 Worker 작업 취소·`runSerial++`·결과 stale), `renderAll()`, `analysis.scheduleAutoRun()`(250 ms 타이머, 입력 중·미연결이면 대기), `projectIO.noteCommitted()`(자동저장 0.8 s 디바운스).
2. 실행: `analysis.runAnalysis()` — draft 확정(`commitPendingInputs`), 이전 작업 무효화, `serial = ++runSerial`, 회로·설정을 `structuredClone`, 한 프레임 양보 후 `serial`/`generation`을 다시 확인.
3. Worker: `AnalysisWorkerClient.start(kind, payload)`가 **요청마다 새 module Worker**를 만들고 `{requestId, kind}`로 응답을 맞춥니다. 새 요청·취소·완료·오류 때 `terminate()`. `analysis-worker.js`의 `executeAnalysisRequest`가 `simulate`(AC면 페이저용 `simulateACAtFrequency` 포함) 또는 `analyzeDCPort`를 실행하고, 오류는 직렬화해 돌려줘 메인에서 `CircuitError`로 복원합니다.
4. 결과 채택: `await` 뒤 `serial !== state.runSerial` 또는 `generation !== state.generation`이면 **버립니다**(오래된 결과). 통과하면 `state.result`/`phasorResult`를 바꾸고 `renderAll()`. 오류는 `describeCircuitFailure`로 진단 표시. 취소(`AnalysisCancelledError`)는 조용히 무시.
5. 포트 해석은 같은 작업 슬롯을 쓰되 `serial`·`generation`에 더해 p/n·부하 선택 스냅샷이 같을 때만 채택합니다. 스윕은 한 작업으로 N회 실행하고 `isCurrent(job)`이 참일 때만 겹침을 게시합니다.
6. 표시: `renderPlot`이 프로브 → 시리즈(원 표본 `raw`와 표시 배율 분리) → `scopeView.setData` + `measureView.update`. 측정·CSV는 항상 원 표본 기준입니다.

프로젝트 교체(새 회로·열기·복원·링크·예제)는 `resetProjectSession()`으로 예약 실행·제스처·draft·결과·포트·스윕·스코프 상태를 전부 비웁니다.

## 지연 로딩 경계

`createLazyController({host, load, create})`가 모듈 import를 한 번만 하고 컨트롤러를 하나만 만들며, 실패하면 `?retry=N`을 붙여 다시 시도하는 버튼을 보입니다. 경계는 세 곳입니다: `em-controller.js`, `signals-course-controller.js`, `circuit-course-controller.js`(모두 `app.js`의 `import()`). `em-controller.js`는 안에서 다시 `em-course-controller.js`(문제 풀이 23실험)를 첫 사용 때 동적 import합니다. 탭 위 포인터·포커스에서 미리 받고(`onIntent`), 페이지가 한가해지면 1.5 s 뒤 세 모듈을 미리 받습니다(Save-Data면 생략). 전환 순서를 지키는 토큰은 `workspaceSeq`입니다. 회로 편집기 모듈은 지연 로딩하지 않으며, 숨겨진 동안의 재렌더는 `workspace.renderDeferred`로 미룹니다.

## 확장하는 곳

**새 부품 종류** (`CCVS`를 기준으로 grep하면 빠짐없이 나옵니다): `circuit-engine.js`(핀 수·기본값·값 검증·구조 검증·토폴로지·DC/과도/AC 스탬프·전류 산출) → `circuit-status.js`(연결 간선) → `circuit-geometry.js`(핀 위치) → `canvas-renderer.js`(기호) → `editor-input.js`의 `PALETTE` → `inspector.js`·`node-readout-model.js`의 `TYPE_NAMES`와 속성 칸 → `current-direction.js`·`ui-model.js`·`circuit-edit.js` → `project-format.js`(필요 시 version) → 필요하면 `port-analysis.js`. 시험은 `tests/engine/circuit/`(해석 기대값)와 `tests/ui-model/circuit-geometry`·`current-direction` 등.

**새 해석 기능**: 계산은 순수 모듈(+ 시험)로 만들고, 실행은 `analysis-worker.js`의 `kind`에 추가해 `AnalysisWorkerClient`로 호출합니다. 결과는 `analysis-runner.js`에서 반드시 `serial`·`generation`을 확인하고 채택합니다(스윕처럼 같은 작업 슬롯을 `beginJob`/`endJob`으로 쓰면 취소 버튼·stale 처리가 공짜입니다). 표시는 `scope-view`/`measure-view`/별도 패널에서 하되 solver 값을 바꾸지 않습니다. 새 UI 상태는 해당 `create*State` 슬라이스에 두십시오.

**새 측정·판독**: `measure-model.js`(계산, note에 보간·기준 명시) → `wave-measure-model.js`(어느 항목을 보일지) → `measure-view.js`.

**새 단축키**: `editor-shortcuts.js`에 동작 이름을 추가하고 `editor-input.js`의 `handled` 표에 연결합니다(이력을 쓰거나 되돌리는 동작은 `DRAG_COMMITTING`에 넣어 진행 중 드래그를 먼저 확정).

**새 학습 실험**: EM은 해당 `em-course-*.js`의 `EXPERIMENTS`에 추가(레지스트리가 모음), 회로 과정은 `circuit-course-registry.js`, 신호는 `signals-course-model.js`의 `SIGNALS_LESSONS`.

## 시험 구조

- `tests/engine/` — 순수 계산: `circuit/`(MNA·소스·OP AMP·LU·포트·페이저), `circuit-course/`, `em/`, `signals/`. 독립 기대값과 `tests/fixtures/*.json` 사용.
- `tests/ui-model/` — DOM 없는 UI 모델과 가짜 DOM 컨트롤러(편집·이력·기하·단축키·자동저장·공유·측정·스윕·패널·워크스페이스·테마 대비 등).
- `tests/tooling/` — 소스 내보내기 스크립트.
- `tests/browser/` — `harness.mjs`(서버 `node server.mjs 0` 기동, 임시 프로필 헤드리스 Edge, CDP 입력·`window.__CIRCUIT_LAB__` 상태 조회, 프로필 경로로만 프로세스를 찾아 종료·확인)와 `smoke.test.mjs`(콘솔 오류·실패 요청이 있으면 해당 시나리오 실패, 약 30개 시나리오).
- 명령: `npm test`(engine + ui-model + tooling), `npm run test:browser`, `npm run test:all`, `npm run test:summary`, `npm run check`.
