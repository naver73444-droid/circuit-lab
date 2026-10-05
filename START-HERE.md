# Circuit Lab — 회로 · 전자기학 · 신호 및 시스템

2026-10-05 latest product **eda508b**: reviewed F1 phasor duplicate names, F2 induction draft preservation, F3 unsupported time graphs, F4 original-symbol view mapping. Focused unit4 and native11/20/39/12 PASS in separate runs; not whole-product PASS. Opamp diagnostic attribution corrected; protected approvals pending. Frozen review ZIP remains c7ab125. [Evidence and corrections](../../../results/REVIEW-F1-F4-2026-10-05.md).

2026-10-05 post-review-snapshot product **314a78a**: successful solution-copy retry removes the stale manual-copy field; denial places selected text beside the button. Focused native UI11/11 PASS. Frozen 6pro ZIP remains c7ab125 and does not include this change. [Evidence](../../../results/COURSE-COPY-RETRY-2026-10-05.md). Protected decisions unchanged.

2026-10-05 latest product **74ec4a3**: numeric illustration fields identify the user's renamed symbolic quantities. Mapping4/4 and native flow12/12 PASS. [Evidence](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Earlier checkpoints are historical; protected decisions remain open.

Latest product **e5f996d**: lossless LC answer cards show distinct series/parallel resonance limits. Native UI9/9 PASS; formulas unchanged. [Student-gap audit and evidence](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Prior snapshots below are historical; protected decisions remain open.

Latest product **12a5d78**: reviewed symbolic j/I meaning collisions are rejected with clear guidance; same-role and suffixed names remain usable. New contract4/4 and native UI/copy15/15 PASS. [Evidence](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Protected historical decisions remain open.

Latest product **72c2f59**: full symbolic solution copy preserves original symbols and all conditions/answers, with manual-copy fallback. Native isolated adapter checks **11/11 PASS**. [Evidence](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Earlier product checkpoints remain historical; six protected test decisions remain open.

Latest product **0d7993c**: ROC shows selected time signal and coefficient assumptions beside the transform. Focused ROC/three-phase power actual UI **15/15 PASS**. Prior AC error recovery d569b76 remains included. [Evidence](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Older account-handoff entries below are historical; protected test decisions remain open.

Current product **d569b76**: AC invalid-input reasons persist when returning to a lesson and clear on editing/correction. Representative circuit/EM/Signals student flows **22/22 native UI PASS**. [Evidence](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Earlier account-handoff hashes below are historical; six protected test decisions remain open. User preview untouched.

Current account handoff — 5f86654 account-handoff marker: this main checkout's latest product is 5899b4e; the previous a97941e migration and cd39919 passages below describe earlier checkpoints. Loop signed-current and AC |S| fixes are in 9d4d89c (native 25/25); AC answer-first is in cd39919 (native 17/17); Faraday fit is in 5899b4e (native 21/21). [Detailed results and six open historical test decisions](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Protected tests/engines and the user preview have not been changed.

Latest local product 5899b4e: Faraday numerical diagram now auto-fits its physical loop and preserves manual zoom; native actual UI 21/21 PASS at 900/390px. [Result](../../../results/COURSE-CONTINUED-UI-2026-10-04.md). Existing user preview still needs a deliberate refresh to show local code changes. Historical test-contract and protected EM-C issues remain open.

이 폴더는 **최신 로컬 실행본**입니다. 2026-10-04 13:18UTC 사용자 지시로 기존 개선을 재개했으며 현재 진행 중입니다. 최신 제품cd39919; Faraday 조건/숫자 연결, loop 전류 방향, AC 피상전력 답과 답 우선 화면을 보완했습니다. 안정 체크포인트는 전체 목표 종료가 아닙니다. 현재 상태는 [STATUS](../../../STATUS.md), 실행·검증·남은 제한은 [체크포인트](../../../docs/CHECKPOINT-2026-10-04.md)를 먼저 읽으세요. 아래 과거 검증 숫자는 당시 기록이며 전체 최신 제품 PASS를 뜻하지 않습니다.

현재 유지 중인 사용자 미리보기는 http://127.0.0.1:56852/?example=rc-lowpass 입니다. 서버 PID18648(node server.mjs 0), HEAD 요청200 확인. 자동 새로고침하지 않았으므로 현재 브라우저에 열린 구버전 화면은 사용자가 수동 새로고침하면 최신 메뉴를 읽습니다. 서버/사용자 탭을 종료하지 마세요.

## 가장 빠른 실행

Node.js 20 이상이 필요합니다. 이번 022 시험 환경은 Node.js 24.21.0 / Windows였습니다. 저장소 루트에서 다음처럼 실행합니다.

```powershell
Set-Location .\candidates\EM-PLAYGROUND\source
node .\server.mjs 4173
```

브라우저에서 `http://127.0.0.1:4173/`을 열고, 끝낼 때 서버 터미널에서 `Ctrl+C`를 누릅니다. 4173 포트를 이미 사용 중이면 `node .\server.mjs 4197`처럼 다른 로컬 포트를 지정할 수 있습니다.

- 외부 패키지 설치, 계정, CDN, 인터넷 연결은 필요하지 않습니다.
- `index.html`을 더블클릭하는 `file://` 실행은 module/Worker 동작이 달라질 수 있으므로 사용하지 마십시오.
- `start-circuit-lab.cmd`와 `node .\scripts\launch.mjs 4173`도 제공하지만, 022의 실제 확인은 위 `server.mjs` 직접 실행 경로로 수행했습니다.
- 서버는 같은 PC의 `127.0.0.1`만 받습니다. 이 주소를 휴대폰에서 직접 열 수는 없습니다.

## 현재 화면 구조

상단은 **회로 / 전자기학 / 신호 및 시스템** 세 분야입니다. 회로는 기존 편집기와 작업 공간의 **학부 AC·3상** 교육 화면을 제공합니다. 전자기학은 점·선전하를 직접 움직이는 자유실험실과 **문자 문제 풀이 · 동축 전류부터** 버튼의 23모델 교육 화면을 제공합니다. 대표 동축 화면은 큰 단면·반경 바·간결 기호답을 기본으로 하며 풀이·조건·숫자·고급 설정은 접혀 있습니다. 신호 및 시스템 탭은 6단계 문자 풀이와 선택 수치 확인을 엽니다. 회로 입력 중 탭을 옮겨도 미확정 값을 적용하거나 버리지 않으며 회로 JSON에 전자기학 상태가 섞이지 않습니다.

왼쪽은 부품, 가운데는 캔버스(편집 도구·해석 선택·저장·열기·예제), 오른쪽은 **속성 / 결과** 탭, 아래는 **파형**입니다. 결과 탭에서 페이저와 테브난·노턴을 봅니다.

- 배치는 고정이며 패널을 옮기거나 크기를 바꾸는 기능은 없습니다.
- 900px 미만에서는 캔버스 아래에 패널 하나만 보이고 하단 탭 `부품/속성/결과/파형`으로 전환합니다.
- 해석은 캔버스 위의 선택(자동·DC·시간응답·AC)과 `해석 실행`, `자동 갱신`, 접힌 `해석 설정`에서 합니다.
- 캔버스의 `조작 도움말`을 열면 현재 마우스·터치·키보드 동작을 한곳에서 볼 수 있습니다.

전자기학의 고급 3D 설정/기본 장 모델에서는 다섯 장면을 고르고 소스와 측정점 값을 입력한 뒤 `장면 적용·측정`을 누릅니다. 3D 화면 끌기/휠, 축 시점 버튼, 화살표키와 `+`/`-`/`Home`, 단면 클릭을 사용할 수 있습니다. 평면파는 기본 정지이며 재생 중 탭을 나가거나 창을 숨기면 같은 물리시간에서 정지합니다. WebGL 실패 안내가 보이면 수치 대체보기만 가능하며 3D 성공으로 간주하지 않습니다.

## 회로 편집

1. `부품` 패널에서 소자를 고른 뒤 캔버스를 눌러 연속 배치합니다. `Esc`로 배치를 끝냅니다.
2. `배선` 도구에서 핀 또는 접속점을 누릅니다. 빈 격자점을 눌러 꺾임을 고정하고, 다른 핀·배선·접속점에서 끝냅니다. 단순 교차는 접속이 아닙니다.
3. 부품을 선택해 `속성`에서 값·파형·초기조건을 수정합니다. 캔버스의 값 글자를 두 번 눌러 바로 편집할 수도 있습니다.
4. 전압 프로브는 핀·배선·접속점, 전류 프로브는 부품을 누릅니다. 전류의 양수 기준은 회로 화살표와 범례에 표시됩니다.
5. `해석 실행`을 누르고 파형·페이저·DC 포트 결과를 확인합니다.

### 마우스·키보드

- 항목 클릭: 선택, 선택한 부품/접속점 끌기: 이동, 빈 캔버스 끌기: 화면 이동, 휠: 회로 확대·축소
- `R`: 회전, `Delete`: 삭제, `Ctrl/Cmd+D`: 복제
- `Ctrl/Cmd+Z`: 실행 취소, `Ctrl/Cmd+Y` 또는 `Shift+Cmd+Z`: 다시 실행
- 값 편집 중 `Enter`: 적용, `Esc`: 취소. 입력 칸을 편집하는 동안 회로 단축키는 작동하지 않습니다.
- 파형 클릭: 커서 고정, 좌우 방향키·`Home`·`End`: 표본 이동, `Esc`: 고정 해제

### 터치

- 먼저 탭해 선택한 부품/접속점만 다음 끌기에서 이동합니다.
- 선택되지 않은 항목이나 빈 영역에서 한 손가락으로 끌면 회로 화면이 이동합니다.
- 두 손가락은 확대·축소입니다. 배선·프로브는 해당 도구를 먼저 고른 뒤 대상점을 탭합니다.
- 이 동작은 코드·390px 브라우저 경로로 확인했지만 실제 손가락, 물리 iPhone/Safari의 이벤트 순서는 아직 미확인입니다.

## 해석·저장

- `관찰 설정`에서 자동 판단, 회로 상태(DC), 시간 변화(transient), 주파수 응답(AC), 직접 설정을 고릅니다.
- 계산은 module Worker에서 실행하며 `계산 취소`가 현재 작업을 중단합니다. 회로나 설정이 바뀌면 이전 결과는 stale로 표시됩니다.
- `저장`은 회로·분석 설정·프로브를 Circuit Lab JSON으로 내보내고, `열기`는 실제 파일 선택기로 다시 읽습니다. 패널 배치는 브라우저 표시 설정이며 회로 JSON과 분리됩니다.
- CSV는 원시 SI 표본을 보존합니다. 화면의 V/A 공통 배율이나 dBV/dBA 표시는 CSV 수치를 임의로 바꾸지 않습니다.

## 확인 상태와 알려진 제한

아래 022 결과는 당시 검증 기록입니다. 최신 EM A–D의 관련 38/38 PASS도 기존 기록이며, 물리폰 터치·3D source drag·회로 value draft·EM 디스크 파일선택기 재열기는 미관측으로 남아 있습니다.

- 022 관련 시험 42/42, 경계검사 오류 0입니다.
- 전체 시험은 301/308이며 부모부터 존재한 7개 실패를 삭제하거나 통과로 바꾸지 않았습니다. 세부 분류는 저장소 루트의 `results/CIRCUIT-022/audit.md`에 있습니다.
- 실제 HTTP에서 PC·390px 도움말, RC AC 해석, 실제 JSON 파일 열기와 DC 10 V/10 mA/10 µA 표시를 확인했습니다.
- 시험 브라우저가 Blob 다운로드 이벤트를 노출하지 않아 022 저장 다운로드 파일 확인은 `INCONCLUSIVE`입니다.
- 물리 휴대폰, Safari/WebKit, 기존 비공개 사이트 반영, CIRCUIT-023 3D 탭은 022의 확인 범위가 아닙니다.

## 문서·시험 경로

후보 폴더 안에서:

- 상세 기능·수치 의미: [README.md](README.md)
- 공통 계약: [docs/COMMON-CONTRACTS.md](docs/COMMON-CONTRACTS.md)
- 시험: `npm test`(엔진·UI 모델), `npm run test:browser`(헤드리스 Edge 스모크), `npm run test:all`
- 경계검사: `npm run check`
- 요약 보고: `npm run test:summary`

저장소 루트 기준 결과:

- `results/CIRCUIT-022/summary.md`
- `results/CIRCUIT-022/audit.md`
- `results/CIRCUIT-022/final-all/summary.json`

같은 hash·환경·시험을 다른 세션에서 반복하지 말고, 새로운 제품 변경 뒤 필요한 관련 시험만 다시 수행하십시오.
