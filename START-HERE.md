# START-HERE — 다음 개발자·AI를 위한 안내

Circuit Lab은 빌드 없는 순수 ES 모듈 웹 앱(회로 편집·해석 + 전자기·신호·회로 과정 학습)입니다. 작업 사본은 `D:\AI\circuit-lab-work`이고 git 이력이 있습니다. 먼저 `git log --oneline`과 이 폴더의 `git status`로 현재 상태를 확인하십시오.

## 어디에 무엇이 있나

| 경로 | 내용 |
|---|---|
| `index.html`, `styles.css` | 정적 마크업·스타일(색 토큰은 `:root` / `[data-theme="light"]`) |
| `src/app.js` | 조립자(약 340줄). 모듈을 만들고 서로 연결, `window.__CIRCUIT_LAB__` 시험 훅 |
| `src/circuit-engine.js` | 해석 엔진(DOM 없음). Worker는 `analysis-worker*.js` |
| `src/editor-*.js`, `canvas-*.js`, `analysis-runner.js`, `inspector.js`, `project-io.js` | 회로 편집기 컨트롤러 |
| `src/em-*`, `signals-*`, `circuit-course-*` | 학습 작업공간(탭 진입 때 지연 로딩) |
| `server.mjs`, `scripts/` | 로컬 서버(`src/*.js` 평면 파일만 제공), 실행기, 경계 검사, 시험 요약 |
| `tests/` | `engine/` `ui-model/` `tooling/` + `browser/`(헤드리스 Edge 스모크) |
| `docs/ARCHITECTURE.md` | 모듈 지도·데이터 흐름·확장 위치 (먼저 읽을 것) |
| `docs/COMMON-CONTRACTS.md` | 전기량·단위·파일·실행 상태 계약 |
| `README.md`, `DESIGN.md` | 사용자 기능·조작표, 화면 설계 원칙 |

`docs/`의 `REVIEW-*`, `session-*`, `dark-sessions/`, `OPAMP-*`, `github-tools.md`, `IMPROVEMENT-PLAN-*`는 당시 기록(역사 자료)입니다. 현재 동작은 코드·시험·README·ARCHITECTURE가 기준입니다.

## 실행과 검증

```powershell
node server.mjs 0              # 빈 포트로 서버 시작 → 출력된 http://127.0.0.1:<포트> 열기 (또는 start-circuit-lab.cmd)
npm test                       # engine + ui-model + tooling, 약 4초
npm run check                  # src 경계·import 사이클 검사
npm run test:browser           # 헤드리스 Edge 스모크 (Edge 필요, EDGE_PATH로 지정 가능)
npm run test:all               # 위 둘
```

- 코드를 바꾸면 최소 `npm test`와 `npm run check`를 돌리고, 화면·입력 동작을 바꿨으면 `npm run test:browser`도 돌립니다. 새 실패 0이 기준입니다.
- 새 기능은 시험을 같이 추가합니다(순수 모델은 `tests/ui-model/` 또는 `tests/engine/`, 실제 입력 흐름은 `tests/browser/smoke.test.mjs`).
- 같은 코드·환경에서 이미 통과한 시험을 이유 없이 반복하지 말고, 바꾼 부분의 관련 시험을 돌리십시오.

## 지킬 규칙

1. **배포 금지**: 사용자의 명시적 확인 없이 어디에도 배포·업로드·공개하지 않습니다.
2. **브라우저는 헤드리스로만**: 자동 시험·점검은 헤드리스(임시 프로필) 브라우저로 합니다. 사용자의 열린 창·탭·마우스·포커스를 건드리지 않습니다.
3. **프로세스는 내가 띄운 PID만 종료**: 이미지 이름(`node`, `msedge`)으로 죽이지 않습니다. 시험 harness는 임시 프로필 경로로 자기 프로세스만 찾아 종료합니다. 사용자의 서버·브라우저는 건드리지 않습니다.
4. **실제 사용자 데이터에 쓰지 않기**: 시험·렌더 도구가 사용자의 저장 파일·자동저장 데이터를 덮어쓰지 않게 합니다(시험은 임시 프로필·임시 폴더 사용).
5. **계산 의미를 몰래 바꾸지 않기**: 표시용 배율·반올림은 solver 값·CSV·측정(원 표본)을 바꾸지 않습니다. 계약 변경은 `docs/COMMON-CONTRACTS.md`와 시험을 함께 고칩니다.
6. 새 모듈은 `src/` 바로 아래에 `[A-Za-z0-9_-]+.js`로 만듭니다(서버가 그 패턴만 제공). 외부 패키지·CDN·폰트 파일은 추가하지 않습니다.
7. 모든 문구는 한국어, 화면 색은 토큰으로(DESIGN.md).

## 알아 둘 점

- 회로·설정 편집은 `session.mutate()`/`mutateGrouped()`/`commitMove()`를, 프로브 편집은 `addVoltageProbe` 등을 거칩니다(이력·세대·재렌더·자동저장 연동). 결과 채택은 `runSerial`+`generation` 검사를 통과해야 합니다.
- `scripts/check-boundaries.mjs`의 순수 모델 목록은 오래돼 최근에 추가된 순수 모듈(자동저장·공유·측정 등)을 검사하지 않습니다. 새 순수 모듈은 목록에 넣는 것이 좋습니다.
- Node는 앱 실행에 20 이상, 시험에 22 이상(전역 `WebSocket`, `node --test` glob)이 필요합니다.
