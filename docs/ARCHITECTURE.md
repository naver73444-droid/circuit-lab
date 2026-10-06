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
- `npm run check`가 import 사이클·누락 import·순수 모델의 DOM 접근·`app.js` import를 검사합니다(검사 대상 순수 모델 목록은 `scripts/check-boundaries.mjs`의 `pure`; 800줄을 넘는 모듈과 240자를 넘는 줄이 있는 모듈은 경고).

## 모듈 지도

### 엔진·순수 모델 (DOM 없음)
- `circuit-engine.js` — 값 파싱, 구조 검증·한도, 토폴로지(MNA), DC/과도/AC 해석, LU(실수·복소 typed array, 선형 과도는 dt별 LU 재사용), 직렬화.
- `union-find.js` — 토폴로지·진단용 서로소 집합. `port-analysis.js` — DC 테브난·노턴 포트.
- `analysis-policy.js` — 회로 값에서 해석 종류·범위 제안. `analysis-diagnostics.js` — 오류를 사용자 진단 문구로.
- `circuit-geometry.js`(핀 위치·격자·배선 경로) · `circuit-edit.js`(삭제·분할·세대 검사 `acceptsRunGeneration`) · `circuit-status.js`(연결 상태 분류) · `current-direction.js`(전류 기준 방향·라벨) · `wire-current-model.js`(배선별 전류: 부품 전류를 넷의 배선 그래프에 KCL로 나눔, 고리·불균형은 미정, 흐름 속도 등급·표본 선택. 엔진은 GND 부품을 모두 한 노드로 묶으므로 모든 GND 핀을 **한 정점**으로 합쳐 GND 사이를 잇는 배선처럼 그 정점을 지나는 고리 위 배선은 `loop`(미정). 위상 분석 `analyzeWireNets`은 전류와 무관해 지오메트리마다 한 번만 계산) · `id-allocator.js`(프로젝트별 단조 증가 id 발급).
- `project-format.js`(JSON 직렬화·검증, version 1~3) · `csv-format.js` · `persistence.js`(탭별 자동저장 슬롯 + 프로젝트를 바꿀 때 이전 상태를 보존하는 `.prev` 슬롯) · `share-url.js`(`#p=` 인코딩·압축·한도).
- `scope-model.js`(눈금·표본 선택) · `plot-format.js`(표시 배율·축, AC 크기 dB·위상) · `phasor-format.js` · `cursor-label-model.js` · `cursor-delta-model.js`(A/B 차이) · `measure-model.js`·`wave-measure-model.js`(자동 측정) · `node-readout-model.js`(호버 판독) · `sweep-model.js`(스윕 계획·병합).
- `selection-model.js`(다중 선택 모델·상자 선택 적중 판정) · `group-edit.js`(선택 전체 이동·회전, 드래그 origin) · `clipboard-model.js`(복사·붙여넣기 조각, 시스템 클립보드 JSON 검사, 배선 정규화 `normalizeClipboardWires`, 한도 검사 `additionLimitReason`) · `editor-shortcuts.js`(키 → 동작, `isTypingTarget`, Ctrl+C/X/V 한 눌림당 토큰 `createClipboardShortcutGate`) · `value-series.js`(E12) · `input-drafts.js`(미확정 입력) · `ui-model.js`(편집 UI 모델) · `interaction-math.js`(제스처 계산·포인터 세션·적중 거리) · `examples.js`. 끝점 키(`pinKey`/`junctionKey`/`endpointKey`)는 `circuit-engine.js`가 한 곳에서 내보내며 상태 분류·포트·클립보드·캔버스·배선 전류가 모두 그것을 씁니다.

### 회로 편집기 컨트롤러 (DOM 있음, `app.js`가 조립)
- `editor-session.js` — 편집 상태(`createEditorState`)와 회로·설정을 바꾸는 경로: `mutate()`(이력·세대·재렌더·자동실행·자동저장 알림)·`mutateGrouped()`(휠·방향키를 이력 한 단계로 묶음, 방향키는 키업 또는 700 ms 유휴로 닫힘)·`commitMove()`(끝난 드래그, 제자리로 돌아오면 호출하지 않음)·프로브 추가·제거(`recordProbeEdit`, 결과를 무효화하지 않음). undo/redo(`restore`)는 같은 프로젝트 안에서는 진행 중인 실행만 취소하고 결과를 stale로 표시하며 스코프 줌·커서·포트 선택·스윕 입력은 유지하고, 다른 프로젝트의 스냅샷(새 회로·열기·예제를 되돌릴 때)이면 `resetProjectSession()`으로 전부 비웁니다.
- `canvas-renderer.js` — SVG 캔버스 전체 렌더, 선택 클래스 토글, 드래그 중 부분 갱신.
- `editor-input.js` — 도구·배치·배선(클릭-클릭과 핀에서 끌기)·프로브, 캔버스·파형 포인터/휠/키 입력 전부. `canvas-touch.js`(터치 라우팅), `editor-shortcuts.js` 사용. `selection-commands.js` — 선택 전체에 대한 삭제·복제·회전·방향키 이동·모두 선택·복사/잘라내기/붙여넣기(내부 클립보드).
- `analysis-runner.js` — 해석 수명주기(예약·Worker 실행·취소·stale·진단)와 결과 표시(프로브 목록, 파형, 페이저, 포트 패널). `sweep-runner.js`(스윕), `analysis-worker-client.js`(Worker 1회용 래퍼), `analysis-worker.js`(Worker 본체).
- `inspector.js` — 속성·해석 설정·화면 값 편집·draft 확정. `sweep-panel.js`(스윕 UI).
- `project-io.js` — 예제·새 회로·JSON 저장/열기·CSV·자동저장·복원 배너·링크 공유. 모든 프로젝트 교체는 `openProject()` 한 길이며 시작 시 `#p=`와 열린 탭에서 주소를 바꾸는 `hashchange`도 같은 길을 탑니다. 교체 직전에 `autosave.retire()`가 이전 프로젝트의 대기 중 저장을 마무리하고, 새 프로젝트의 첫 저장이 그 슬롯을 `<탭 id>.prev`로 옮깁니다(탭마다 prev는 하나, 5개 한도에 함께 셈). 예제·새 회로·파일 열기는 이전 프로젝트에서 직접 입력한 해석 설정을 가져오지 않고 기본값에서 시작합니다.
- `hover-readout.js` — 판독 말풍선. `canvas-notices.js` — 캔버스 위 알림. `responsive-editor.js` — 폰 폭에서 머리줄 요소 재배치(이동만, 재생성 없음). `panel-controller.js` — 고정 레이아웃(폰 하단 탭, `파형 크게`). `theme.js`.
- 표시: `flow-layer.js`("전류 흐름" 보기: 배선 위로 전류 방향 점선이 흐르는 별도 SVG 레이어 `#flow-layer`, `wire-current-model`이 계산한 배선 전류를 속도 등급별 path로 그림. 결과가 오래되는 즉시(`markStale`·`markInputDirty`·실행 무효화 → `onStaleChange`) 지우고, 이동 끌기(`state.drag`가 부품·접속점이고 움직인 상태)가 진행되는 동안에는 어떤 렌더가 와도 숨김 유지. 망 그래프·배선 경로는 회로 지오메트리(회로 객체·`generation`·항목 수)별로 캐시하고, 결과·표본·지오메트리가 같으면 다시 계산하지 않음. 배선 id는 `escapeHtml`로 속성에 넣음), `scope-view.js`(파형 SVG, 커서 A/B; 관찰은 `subscribe(fn)` → 해제 함수, 이벤트 `change`·`cursor`), `measure-view.js`(측정 요약), `phasor-view.js`·`phasor-practice.js`(복소 연산 모델 + 연습 탭), `trace-color.js`(파형 색 대비 계산 + 테마별 색), `safe-dom.js`(escape).

### 학습 작업공간 (지연 로딩, 회로 편집기와 독립)
- 전자기학: `em-controller.js`(자유실험실·기본 모델·3D, 진입점) · `em-physics.js`/`em-state.js`/`em-view.js`(WebGL)/`em-format.js` · `em-playground-{physics,state,interaction,calculus,project}.js` · 문제 풀이 `em-course-controller.js` + `em-course-registry.js`가 모으는 `em-course-{electrostatics,coaxial,magnetostatics,boundaries,integrals,induction,waves,transmission}.js`(+ `constants`, `view`).
- 신호 및 시스템: `signals-course-controller.js`(탭·슬라이더·재생, 뷰 6개를 한 번씩 만들어 속성만 갱신) · 순수 계산 `signals-util.js`·`signals-course-model.js`·`signals-time-model.js`·`signals-convolution-model.js`·`signals-series-model.js`·`signals-transform-model.js`·`signals-roc-model.js`·`signals-sampling-model.js`·`signals-custom-input.js`·`signals-expression.js`(제한 산술 AST, JS 평가 없음)·`signals-playback.js` · SVG 도구 `signals-plot.js`·`signals-style.js` · 뷰 `signals-{time,convolution,series,transform,roc,sampling}-view.js`.
- 회로 과정(AC·3상, 네 번째 최상위 탭 "회로 과정"): `circuit-course-controller.js` · `circuit-course-registry.js` · `circuit-course-model.js` · `circuit-course-problem{,-symbolic}.js` · `circuit-course-view.js`.
- 공용: `course-focus.js`(재렌더 후 포커스 유지) · `course-style.js`(스타일 1회 주입) · `course-math-view.js`·`course-symbolic-view.js`(수식 표시) · `course-illustration-contract.js`.
- `workspace-tabs.js` — 작업공간 탭과 `createLazyController`.

## 선택 모델

- `state.selected`는 **기본(primary) 항목 하나**(`{kind, id}` | null)로, 인스펙터·페이저·포트 패널이 기존대로 읽습니다. `state.selection`은 선택된 **모든** 항목의 `Set`이며 키는 `"component:R1"`·`"wire:W3"`·`"junction:J1"` 꼴입니다(종류가 달라도 id 충돌 없음). `selected`가 있으면 그 키가 `selection`에 들어 있습니다.
- 읽는 쪽은 `selection-model.js`의 `selectedKeys(state)`/`selectedItems`/`isSelected`를 씁니다. 다른 모듈이 `state.selected`만 직접 바꿔도(그 키가 `selection`에 없으면) 단일 선택으로 해석되므로 깨지지 않습니다. 쓰는 쪽은 `setSingleSelection`·`toggleSelection`·`setSelectionItems`·`clearSelection`을 씁니다. 프로젝트 교체·undo/redo(`restore`)는 선택을 비웁니다.
- 입력: `Shift`+클릭은 `pointerdown`에서 토글(드래그 없음, 뒤따르는 click은 무시), `Shift`+빈 곳 끌기(마우스·펜, 선택 도구)는 `kind: "marquee"` 포인터 세션으로 `marqueeHits`(부품: 경계 상자가 닿으면, 접속점: 점이 안, 배선: 기본 경로 전체가 안)를 실시간 반영하고 `canvas-renderer.setMarquee`가 `#marquee-rect`를 그립니다. 다중 선택된 부품을 끌면 `captureGroupOrigins`로 기준 위치를 기록해 프레임마다 `applyGroupOffset`(주 항목의 격자 오프셋 그대로)으로 움직이고, 끝에 `commitMove(before)` **한 번**이 이력 한 단계입니다(양 끝이 함께 움직이는 배선의 꺾임점도 이동). 움직임 없이 놓으면 그 항목 하나로 좁혀집니다.
- 렌더: `applySelection`이 클래스만 토글합니다(둘 이상이면 부품 삭제 배지는 없음). 부분 갱신은 `scheduleDragUpdate("group", {components, junctions})` → `updateMoved`가 움직인 항목과 닿은 배선만 고칩니다(≤50 부품에서 전체 렌더로 떨어지지 않음).
- 명령(`selection-commands.js`): 삭제(`deleteSelectionFromCircuit`), 복제·붙여넣기(`circuit-edit.js`의 `extractFragment`/`remapFragment` — 새 ID, 내부 배선·제어원 참조 재매핑, 밖으로 나가는 배선 제외. 복제도 붙여넣기와 같은 크기 한도 사전 검사를 거쳐 넘으면 "복제 거부" 알림), 회전(`rotateGroup`, 기준 부품 고정), 방향키(`moveGroup` + `mutateGrouped`) 모두 `mutate`/`mutateGrouped` 한 번 = 이력 한 단계이고, 먼저 `commitActiveDrag()`로 진행 중 드래그를 확정합니다. 클립보드는 앱 안 변수(붙여넣을 때마다 2칸씩 비켜 놓임)이며 JSON을 시스템 클립보드에도 씁니다. **브라우저의 네이티브 `copy`/`cut`/`paste` 이벤트(`clipboardData`)를 우선**합니다: Ctrl+C/X/V `keydown`은 막지 않고 두며, 같은 눌림에서 네이티브 이벤트가 오면 그것이 처리하고(권한 창 없이 최신 시스템 클립보드를 읽음), 오지 않으면(일부 임베더·자동화) `setTimeout(0)` 뒤 키 경로가 `navigator.clipboard`로 대신 처리합니다. 눌림마다 **토큰 하나**(`createClipboardShortcutGate`)를 두고 실제로 복사·붙여넣기를 하는 쪽이 `claim()`하므로 어느 쪽이 먼저 와도(네이티브 이벤트가 0ms 타이머보다 늦게 와도, 비동기 `readText`가 아직 진행 중이어도) 한 번만 실행됩니다. 비동기 `readText`는 요청 시점의 `projectId`·요청 번호를 기억해 프로젝트가 바뀌었거나 더 새 붙여넣기 요청이 있으면 결과를 버립니다. 붙여넣기는 `clipboardData`에 Circuit Lab JSON이 있으면 그것을, 없을 때만 앱 안 클립보드를 씁니다. 글자 칸에 포커스가 있거나 페이지에 드래그해 선택한 글자가 있으면 복사·잘라내기·모두 선택은 브라우저 몫입니다(`getSelection`). Ctrl+V·D·X를 꾹 누른 반복은 무시합니다.
- 붙여넣기 검증: 시스템 클립보드 텍스트는 `parseClipboardText`가 알려진 필드만 남긴 새 객체로 정규화합니다(좌표 유한·±1e6, 회전 0/90/180/270, props는 문자열·숫자·불리언만, 자기 루프·완전히 같은 배선(끝점 둘과 꺾임점이 모두 같음, 끝점을 바꿔 꺾임점을 거꾸로 읽어도 같음) 제거 — 같은 끝점이라도 경로가 다른 병렬 배선은 유지, 내부·시스템 두 경로 모두 `normalizeClipboardWires` 사용, 없는 핀 거부, 부품+접속점 500·배선 1000 한도 — 복사도 같은 한도라 넘으면 알림). 붙일 때마다 `pasteRejection`이 **붙이는 조각만**(제어 대상은 대역 부품으로 대체) 검증하고 합친 회로의 크기 한도를 봅니다(회로의 다른 기존 오류는 막지 않음). 앱 안 클립보드는 붙여넣기에 **성공한 뒤에만** 교체되므로 거부된 조각이 다음 Ctrl+V에서 검증 없이 들어가지 않습니다.
- 제어원 외부 참조: 조각에는 복사한 프로젝트의 id(`source`, `state.projectId` — 새 회로·열기·예제·링크·복원마다 새로 만들고 undo/redo 때 함께 되돌림)가 들어 있습니다. 조각 밖을 가리키는 CCCS/CCVS의 제어 참조는 같은 프로젝트이고 대상(V 또는 전류 센서)이 아직 있을 때만 유지하고, 다른 프로젝트·대상 없음이면 지우고 "제어 대상을 다시 선택하세요" 알림을 냅니다(인스펙터는 "제어 대상과 방향을 선택하세요" 오류 상태). 조각 안 참조는 항상 새 id로 이어집니다. 복제·붙여넣기 부품의 참조 라벨(`props.ref`)은 원본과 겹치면 다음 빈 라벨(R3…)을 받습니다.
- 그룹 편집 세부: 그룹 이동은 항목(과 꺾임점)마다 격자에 맞춥니다. 그룹 회전은 항목별 격자 스냅 없이 축을 중심으로 정확히 돌려(부동소수점 잡음만 제거) 시계→반시계가 격자 밖 좌표도 그대로 되돌립니다. 회전 각도는 0..270으로 정규화하고, 회전 축은 기본 항목이 부품·접속점이면 그것, 배선이면 선택에서 마지막 부품, 부품이 없으면 선택 범위 중심(격자)입니다. 터치로 다중 선택 부품을 끌면 마우스처럼 그룹이 같이 움직입니다. 배선 대기 중 그 시작 부품·접속점이 삭제되면 `mutate()`가 대기 배선을 취소합니다. **id는 재사용하지 않습니다**: `id-allocator.js`가 프로젝트별(`state.projectId`)로 접두어별 발급한 최대 번호를 기억하고(`mutate`·복원 전에 현재 회로의 id를 `observe`) 항상 그 위에서 이어 세므로, S1을 지우고 새 센서를 놓아도 S2가 되어 앞서 복사해 둔 F1의 제어 참조가 엉뚱한 새 S1에 묶이지 않습니다. 부품·접속점·배선 id 모두 이 경로(`nextId`, `remapFragment`, `splitWireAtJunction`)를 거치고 undo/redo는 번호를 낮추지 않습니다.
- 다중 선택 중 **부하 제외**(포트 패널)·페이저 보기는 기본(primary) 항목 하나만 기준으로 합니다(의도된 동작: 여러 항목에 대한 포트·페이저 의미가 없음). 인스펙터 값 편집도 한 부품씩입니다.
- 핀에서 끌어 배선: 핀 `pointerdown`(선택·배선 도구, 마우스·펜)이 `kind: "wire"` 세션을 열고(포인터 캡처 없음), 슬롭을 넘으면 `pendingPin`을 세워 기존 미리보기를 재사용합니다. 놓은 곳이 다른 핀·접속점이면 완성, 배선이면 접속점을 만들어 연결, 빈 캔버스나 출발 핀이면 배선이 **그대로 대기**(클릭-클릭 흐름 계속, `Esc` 취소), 캔버스 밖(툴바·인스펙터 위)에서 놓으면 취소합니다. 포인터 캡처가 없으므로 `window`의 `pointercancel`도 제스처를 끝냅니다. 펜의 끌기 슬롭은 터치와 같은 8px입니다. 터치는 배선 도구에서만(한 손가락 끌기 = 화면 이동 계약 유지).
- 포커스: `isTypingTarget(element, key, {modifier})`가 글자를 받는 칸만 단축키를 막습니다(체크박스·버튼은 아님, 슬라이더는 방향키만, `<select>`는 방향키와 수식키 없는 글자 한 자(타입어헤드)). 캔버스에서 `preventDefault`하는 눌림은 `releaseStaleFocus()`로 글자 칸이 아닌 포커스를 풀어 줍니다. 파형 그래프가 키를 처리했으면(`defaultPrevented`) 편집기 `keydown`은 건너뜁니다.

## 해석 실행 데이터 흐름

공유 `state` 하나를 모듈별 슬라이스(`createEditorState`/`createInputState`/`createRunState`)가 나눠 소유합니다. 핵심 카운터는 `state.generation`(회로·설정이 바뀔 때마다 +1)과 `state.runSerial`(실행·취소마다 +1)입니다.

1. 편집: 입력 모듈 → `session.mutate(change)` → 이력 저장, `change()`, `generation++`, `analysis.markStale()`(진행 중인 Worker 작업 취소·`runSerial++`·결과 stale), `renderAll()`, `analysis.scheduleAutoRun()`(250 ms 타이머, 입력 중·미연결이면 대기), `projectIO.noteCommitted()`(자동저장 0.8 s 디바운스).
2. 실행: `analysis.runAnalysis()` — draft 확정(`commitPendingInputs`), 이전 작업 무효화, `serial = ++runSerial`, 회로·설정을 `structuredClone`, 한 프레임 양보 후 `serial`/`generation`을 다시 확인.
3. Worker: `AnalysisWorkerClient.start(kind, payload)`가 **요청마다 새 module Worker**를 만들고 `{requestId, kind}`로 응답을 맞춥니다. 새 요청·취소·완료·오류 때 `terminate()`. `analysis-worker.js`의 `executeAnalysisRequest`가 `simulate`(AC면 페이저용 `simulateACAtFrequency` 포함) 또는 `analyzeDCPort`를 실행하고, 오류는 직렬화해 돌려줘 메인에서 `CircuitError`로 복원합니다.
4. 결과 채택: `await` 뒤 `serial !== state.runSerial` 또는 `generation !== state.generation`이면 **버립니다**(오래된 결과). 통과하면 `state.result`/`phasorResult`를 바꾸고 `renderAll()`. 오류는 `failureRecord`로 코드·메시지·힌트·상세를 모두 `runState.error`에 두고 `describeCircuitFailure`로 진단 표시합니다(재렌더가 같은 힌트를 다시 그림). 다이오드 해석은 역방향 전압에 하한이 없고, 해석 예산은 선형 과도(dt별 LU 재사용)와 Newton 반복을 따로 셉니다. 취소(`AnalysisCancelledError`)는 조용히 무시.
5. 포트 해석은 같은 작업 슬롯을 쓰되 `serial`·`generation`에 더해 p/n·부하 선택 스냅샷이 같을 때만 채택합니다. 스윕은 한 작업으로 N회 실행하고 `isCurrent(job)`이 참일 때만 겹침을 게시합니다.
6. 표시: `renderPlot`이 프로브 → 시리즈(원 표본 `raw`와 표시 배율 분리) → `scopeView.setData` + `measureView.update`. 측정·CSV는 항상 원 표본 기준입니다.

프로젝트 교체(새 회로·열기·복원·링크·`hashchange`·예제)는 `resetProjectSession()`으로 예약 실행·제스처·draft·결과·포트·스윕·스코프 상태를 전부 비웁니다.

## 지연 로딩 경계

`createLazyController({host, load, create})`가 모듈 import를 한 번만 하고 컨트롤러를 하나만 만들며, 실패하면 `?retry=N`을 붙여 다시 시도하는 버튼을 보입니다. 경계는 세 곳입니다: `em-controller.js`, `signals-course-controller.js`, `circuit-course-controller.js`(모두 `app.js`의 `import()`; 탭 이름은 `workspace-tabs.js`의 `WORKSPACES`). `em-controller.js`는 안에서 다시 `em-course-controller.js`(문제 풀이 23실험)를 첫 사용 때 동적 import합니다. 탭 위 포인터·포커스에서 미리 받고(`onIntent`), 페이지가 한가해지면 1.5 s 뒤 세 모듈을 미리 받습니다(Save-Data면 생략). 전환 순서를 지키는 토큰은 `workspaceSeq`입니다. 회로 편집기 모듈은 지연 로딩하지 않으며, 숨겨진 동안의 재렌더는 `workspace.renderDeferred`로 미룹니다.

## 확장하는 곳

**새 부품 종류** (`CCVS`를 기준으로 grep하면 빠짐없이 나옵니다): `circuit-engine.js`(핀 수·기본값·값 검증·구조 검증·토폴로지·DC/과도/AC 스탬프·전류 산출) → `circuit-status.js`(연결 간선) → `circuit-geometry.js`(핀 위치) → `canvas-renderer.js`(기호) → `editor-input.js`의 `PALETTE` → `inspector.js`·`node-readout-model.js`의 `TYPE_NAMES`와 속성 칸 → `current-direction.js`·`ui-model.js`·`circuit-edit.js` → `project-format.js`(필요 시 version) → 필요하면 `port-analysis.js`. 시험은 `tests/engine/circuit/`(해석 기대값)와 `tests/ui-model/circuit-geometry`·`current-direction` 등.

**새 해석 기능**: 계산은 순수 모듈(+ 시험)로 만들고, 실행은 `analysis-worker.js`의 `kind`에 추가해 `AnalysisWorkerClient`로 호출합니다. 결과는 `analysis-runner.js`에서 반드시 `serial`·`generation`을 확인하고 채택합니다(스윕처럼 같은 작업 슬롯을 `beginJob`/`endJob`으로 쓰면 취소 버튼·stale 처리가 공짜입니다). 표시는 `scope-view`/`measure-view`/별도 패널에서 하되 solver 값을 바꾸지 않습니다. 새 UI 상태는 해당 `create*State` 슬라이스에 두십시오.

**새 측정·판독**: `measure-model.js`(계산, note에 보간·기준 명시) → `wave-measure-model.js`(어느 항목을 보일지) → `measure-view.js`.

**새 단축키**: `editor-shortcuts.js`에 동작 이름을 추가하고 `editor-input.js`의 `handled` 표에 연결합니다(이력을 쓰거나 되돌리는 동작은 `DRAG_COMMITTING`에 넣어 진행 중 드래그를 먼저 확정). 글자 입력 칸 안에서도 동작해야 하는 키는 `shortcutFor`의 `typing` 검사 앞에 둡니다(현재 Ctrl+S, Ctrl+Enter; Ctrl+S는 IME 조합 중에도 동작해 브라우저 저장 대화상자를 막음).

**새 학습 실험**: EM은 해당 `em-course-*.js`의 `EXPERIMENTS`에 추가(레지스트리가 모음), 회로 과정은 `circuit-course-registry.js`, 신호는 `signals-course-model.js`의 `SIGNALS_LESSONS`.

## 시험 구조

- `tests/engine/` — 순수 계산: `circuit/`(MNA·소스·OP AMP·LU·포트·페이저), `circuit-course/`, `em/`, `signals/`. 독립 기대값과 `tests/fixtures/*.json` 사용.
- `tests/ui-model/` — DOM 없는 UI 모델과 가짜 DOM 컨트롤러(편집·이력·기하·단축키·자동저장·공유·측정·스윕·패널·워크스페이스·테마 대비 등).
- `tests/tooling/` — 소스 내보내기 스크립트와 경계 검사기(`check-boundaries`). `tests/helpers/` — 시험 전용 보조(`parseCSV`, `phasorFromPolar`).
- `tests/browser/` — `harness.mjs`(서버 `node server.mjs 0` 기동, 임시 프로필 헤드리스 Edge, CDP 입력·`window.__CIRCUIT_LAB__` 상태 조회, 프로필 경로로만 프로세스를 찾아 종료·확인)와 `smoke.test.mjs`(콘솔 오류·실패 요청이 있으면 해당 시나리오 실패, 67개 시나리오).
- 명령: `npm test`(engine + ui-model + tooling), `npm run test:browser`, `npm run test:all`, `npm run test:summary`, `npm run check`.
