# Circuit Lab 전체 재검토·다크 UX 개선 보고서

작성일: 2026-09-12. 표기: **실제 재현 / 계약 명료화·확장 / 예방 개선 / 미구현·미검증**을 구분한다.

## 1. 검토 기준과 결론

대상은 사용자 업로드 `Circuit-Lab-Development-Handover-2026-09-12.zip`이다. 압축 원본 SHA-256은 `229f76331edd9c521419eec5dfe7c2c84e02a3c4accf37e515a6c314540a1009`. 132개 파일이며 자체 MANIFEST의 131개 항목이 모두 일치했다. MANIFEST 자신은 목록 대상이 아니다. 압축 전 사용자 PC의 원본까지 직접 확인한 것은 아니다.

사용자는 `68dcc64` 커밋을 알려 주었고, ZIP의 START-HERE는 `acc07989600e2c780e5c6eb5d2a75ffd6a9bdf41`을 정리 기준으로 기록한다. 문서를 만든 시점과 최종 포장 커밋은 다를 수 있다. `.git`이 없어 어느 커밋의 트리인지 독립 확인하지 않았으며 이번 식별자는 ZIP/파일 해시다. 사용자 저장소에 커밋하거나 PC 파일을 수정하지 않았다.

기존 앱 `source-baseline/`과 새 UX 후보 `source-ux-candidate/`를 구분해서 읽었다. 수정은 후자의 별도 사본에만 했다. 기존 앱 70개, 원 UX 후보 106개 시험은 다시 통과했다. 그러나 인계 문서 6절의 보류 과제 중 실제 문제가 존재했다. 추가 재현으로 고립 접속점, 분할 프로브, draft 전환, 자동 눈금 무한 반복, 역바이어스 다이오드 AC 등을 확인했다.

**결론:** 전체 재작성이나 Godot/React로의 이전보다 현재의 순수 수치 모듈·표시 모듈 경계를 유지하며 보완하는 편이 적절하다. 이번 사본은 신뢰성 및 다크 UI를 개선했지만 통합/배포 승인본은 아니다. 큰 `app.js`, 동기 solver, 단위 차원 검사는 다음 분리 과제로 남는다.

## 2. 원 인계 상태를 보존한 부분

- CIRCUIT-007의 ACCEPT는 소스 포장·fixture 재현성에 한정된다. baseline의 006 미검증 변경까지 전체 승인된 것은 아니다.
- CIRCUIT-008은 원 기록 그대로 P PASS / U INCONCLUSIVE / N PASS / E PASS, 전체 통합 DEFER다. 이번 시험으로 종전 판정을 덮어쓰지 않는다.
- 기존 후보의 병렬 C·C 고리·SIN 초기전류 개선은 이미 들어 있던 변경이다. 이를 이번에 새로 구현했다고 주장하지 않는다. 관련 N1~N5 시험은 그대로 유지·통과했다.
- 이상 OP AMP 및 실제형 OP AMP는 **둘 다 미구현**이다. 현재 모델은 기본 유한 이득 100000, 입력전류0·출력저항0의 간략 모델이다. UI에서도 한계를 표시한다.
- 기존 source-baseline, project-records, attempt-02 근거는 입력 ZIP 안에 보존된다. 사용자 사이트·배포·자동 시작·외부 계정은 변경하지 않았다.

## 3. 주요 항목: 확인 결과와 수정

### DARK-001 / 높음 / 실제 재현 — 고립 junction이 정상 회로를 SINGULAR로 만듦

분압기에 배선되지 않은 접속점 하나만 추가하면 원 후보가 특이행렬을 반환했다. 부품 핀과 관계없는 순수 표시용 island까지 전압 미지수로 만들었기 때문이다. 부품 핀으로 정의된 net에 속한 접속점만 solver node에 연결했다. 고립 접속점·선만 있는 island는 편집 데이터에 보존하되 전압이 0이라고 꾸미거나 matrix row를 추가하지 않는다. 같은 입력의 분압기 출력은 수정 후 5V다. 실제 부품으로 이루어진 부유 회로의 오류 검사는 유지한다.

근거: `reproductions-before.json`, `reproductions-after.json`, `AUDIT-N01/N02`, `AUDIT-B14`.

### DARK-002 / 높음 / 실제 재현 — 분할 뒤 프로브가 잘못된 배선 조각을 가리킴

원래 wire의 b 쪽 핀에 놓인 프로브도 첫 번째 조각으로 무조건 이동했다. 사례에서 실제 W5, 기대 W6였다. `retargetWireProbes`가 원 측정 endpoint를 포함하는 조각을 선택하도록 바꿨다. 프로브의 전기적 anchor는 바꾸지 않는다. 기존 3인자 호출은 호환용으로 유지한다.

근거: `AUDIT-N03`, before/after 재현 JSON. 수정 후 W6.

### DARK-003 / 중간 / 실제 재현 — 끝점에서 split하면 0길이 가지 생성

기존 끝점을 분할할 때 불필요한 junction과 wire가 하나씩 늘었다. 끝점에 투영된 경우에는 그 endpoint를 그대로 사용하도록 했다. 퇴화 경로는 RangeError로 명시 거부한다. 예제 wire 수는 4→5가 아니라 4로 유지된다. 기존 내부 split 동작과 legacy 10 단위 경로는 유지한다.

근거: `AUDIT-N04/N05`, `circuit-geometry.js` 및 기존 geometry 회귀.

### DARK-004 / 높음 / 실제 재현 — 다른 부품으로 이동하면 미확정 입력 소실

R1의 값을 `banana`로 편집하고 R2를 선택한 뒤 실행하는 경로에서 pending text가 DOM 교체로 소실될 수 있었다. `InputDrafts`에 필드 소유자와 문자열을 저장하고 모든 visible/hidden draft를 실행·저장 전에 원자적으로 검증한다. 실패 시 해당 필드 또는 고급 설정을 표시하고 성공/CSV를 막는다. ‘입력 취소’와 새 회로·예제·가져오기·회로 undo/redo 전환 확인을 추가했다. DOM이 바뀌어도 잘못 입력한 원문을 지우지 않는다.

근거: `AUDIT-W01~W03`, `AUDIT-B01/B06/B07/B08`. 새 파일/히스토리 전환 확인은 데이터 손실 방지 정책이며 단순 삭제 취소와 구분한다.

### DARK-005 / 중간 / 실제 재현 — 프로브 삭제가 독립 undo 이력이 아님

프로브 하나를 지우고 undo하면 프로브 삭제 대신 이전 회로 편집(경우에 따라 예제 불러오기)까지 되돌아갔다. 프로브 추가·삭제를 별도 snapshot 이력으로 기록했다. solver 입력이나 raw 결과는 프로브 보기 조작으로 수정하지 않는다.

근거: `AUDIT-B02` before 실패 / after 통과.

### DARK-006 / 높음 / 실제 재현 — 큰 값에서 자동 축 맞춤이 끝나지 않음

`fittedAxis([-3.15e20, 4.05e20])`가 기존 1–2–5 눈금 상한과 while 반복에 걸려 종료하지 않았다. 별도 Node 프로세스가 1200ms timeout에 도달했다. 눈금 범위를 확장하고 증가하지 않는 값·반복 한도를 검사한다. 표시 불가 시 명시 메시지를 내며 계산값·CSV를 바꾸지 않는다. 수정 후 유한한 정상 범위를 반환한다.

근거: `AUDIT-N13`, `AUDIT-W05`, before/after 재현. 이는 모든 수치 크기의 안전성 증명이 아니라 해당 무한 반복 경로의 제거다.

### DARK-007 / 높음 / 실제 재현 — 역바이어스 다이오드의 AC 도함수 오류

-0.2V DC bias, Is=1e-12A, n=1, 1V peak AC 자극에서 기존 AC 전류는 `3.8684719535783364e-11 A`였다. 현재 간략 모델의 도함수 `(Is/Vt)*exp(Vd/Vt)`는 `1.6882136479563037e-14 A`이며 비율 약2291.46이다. 기존 코드가 Newton 안정화용 conductance 하한을 AC 물리 도함수에도 재사용했다.

`diodeSmallSignalConductance`를 분리해 AC 행렬과 AC 표시 전류에 원 모델 도함수를 사용했다. Newton 반복 안정화는 그대로다. -0.2/0/+0.2V에서 독립 기대식과 대조했다. 실제 제조사 다이오드나 breakdown 정확도가 개선됐다는 뜻은 아니다.

근거: `AUDIT-N08` 3개 조건. **이 변경은 UI PR와 별개로 설계 세션이 승인해야 하는 수치 변경이다.**

### DARK-008 / 중간 / 계약 명료화 — 0 진폭의 AC 위상·로그 크기

기존은 로그 하한 -600dBV와 위상0°를 반환했다. 이번에는 0 진폭의 로그 크기를 −∞, 위상을 미정(null)으로 구분한다. 차트는 비유한 값·미정 위상을 유한 trace로 연결하지 않으며 안내를 표시한다. CSV는 `-Infinity`, 빈 phase cell로 저장한다. 숫자만 받는 downstream 도구는 이 표현을 별도 처리해야 한다.

근거: `AUDIT-N09/N10`, `AUDIT-B11`. 일반 0이 아닌 신호의 수치/단위 및 peak/cos 기준은 유지했다.

### DARK-009 / 중간 / 실제 재현 — end보다 매우 큰 dt가 마지막 표본을 생략

종료시간1ns, 요청 dt100s에서 기존은 `[0]`만 반환했다. 적어도 끝 표본 하나를 실제 남은 구간으로 계산하게 바꿔 `[0, 1e-9]`를 반환한다. 시간 해상도가 부족한 설정을 정밀한 것으로 보장하지는 않는다. 정상 범위에서는 기존 backward Euler 정의를 유지한다.

근거: `AUDIT-N12`.

### DARK-010 / 중간 / 입력 지원 확장 — E 및 두 micro 표기

`1E-3`, Greek μ가 포함된 `2.2μF`가 거부됐다. e/E, µ/μ/u를 허용하고 M/m/F/f의 기존 의미는 유지했다. 이는 입력 표기 계약 확장이며 **단위 차원 검사를 구현한 것은 아니다**.

근거: `AUDIT-N06/N07`, 기존 엔진 단위 시험.

### DARK-011 / 중간 / 보안 보강 — 외부 라벨과 로컬 서버 범위

CSV 텍스트 헤더가 수식 시작 문자로 시작하는 경우 보호 접두어를 추가한다. 실제 음수 전류 표본은 그대로 내보낸다. 임의의 스프레드시트 환경 전체에 대한 보안 인증은 아니다.

원 기본 서버는 README/package 및 runtime과 관계없는 파일을 제공했고, 임시 시험의 src symlink가 루트 밖 sentinel 파일을 읽었다. 기본 서버를 GET/HEAD, index/styles/src JS로 제한하고 realpath 경계를 확인한다. unrelated Host를 거부하며 CSP/nosniff/frame 제한 헤더를 제공한다. 실제 HTTP 13개 조건으로 확인했다. 과거 `scripts/verification/attempt-02-server.mjs`는 역사적 계측 도구로 유지했으며 이번 기본 서버 강화의 대상이 아니다. 외부 공개 서버로 사용하면 안 된다.

근거: `AUDIT-N11`, `http-before-checks.json`, `http-after-checks.json`.

### DARK-012 / 중간 / 예방 정책 — 동기 solver의 계산량 상한

기존 표본 수 제한만으로 행렬 크기×표본×반복 횟수의 비용을 제한하기 어렵다. 편집 데이터 상한, 미지수128, `size³ × points × (diode ? 120 : 1)`의 보수적 추정 예산2억을 추가했다. 넘으면 명시 중단하며 소자나 표본을 몰래 줄이지 않는다. 이 예산은 벤치마크 기반 시간 제한이 아니다. 작지만 ill-conditioned인 회로나 특정 브라우저 멈춤을 모두 해결한 것이 아니며 **Worker/실행 중 취소는 미구현**이다.

근거: `AUDIT-W06/W07/W09`. 고급 사용자가 큰 회로를 쓰려면 먼저 실행 제어 구조와 성능 근거를 보완해야 한다.

### DARK-013 / 중간 / 조작·표시 보강

SVG letterboxing을 고려해 canvas pan을 CTM 배율로 변환했다. fit-to-view가 배선 waypoint도 포함한다. 부품 회전과 라벨 회전을 분리했다. 눈금 ± 버튼의 키보드 포커스는 재렌더 후 복원한다. 줌 anchor fraction을 경계 내로 일관되게 clamp했다. `:`가 포함된 부품 ID는 overlay에서 문자열을 임의 분할하지 않고 원 endpoint로 추적한다.

근거: `AUDIT-N14`, `AUDIT-B15/B16/B17`, 정적 변경 검토. 모든 특수 ID 및 모든 waypoint 형태의 브라우저 조작까지 검증한 것은 아니다.

배선 click 시 전체 DOM을 교체하지 않도록 예방 정리도 했다. **native double-click split은 이번 before 시험에서도 통과했으므로 이를 새로 재현한 버그 수정으로 세지 않는다.** `AUDIT-B03`은 정상 대조 조건이다.

## 4. 중복 코드 및 구조 정리

| 영역 | 적용한 정리 | 의도적으로 남긴 것 |
|---|---|---|
| 배선 자동 경로 | legacy/grid의 거의 같은 함수 두 개를 spacing 인자 한 함수로 통합 | legacy10 / current20 단위 차이는 유지 |
| 페이저 화면 | `phasor-view.js`로 약150줄 분리, 읽기 전용 view 역할 명시 | 실제 풀이 및 source/IC 변경은 view에서 금지 |
| 입력 상태 | `input-drafts.js`에 필드 소유자별 대기 문자열 저장 | 소자별 값 제약은 현 계약을 유지 |
| 테마/색 | `theme.js`, `trace-color.js`, 순수 `color-model.js`로 공통화 | 저장한 원 색은 보존, 표시색만 보정 |
| pin 개수 | UI와 JSON probe 검증에서 engine의 pinCount 재사용 | OP AMP 새 핀 계약은 아직 정의하지 않음 |
| topology | 사용되지 않는 roots 배열과 O(n²) includes 수집 제거 | 실제 floating/ground/constraint 규칙 유지 |

7개 연속 유효 줄, 공백 정규화, 240자 이상 동일 블록을 찾는 보조 스캔에서 현재 src에는 RC 예제 두 개의 동일 배선 블록 한 곳이 남는다. 두 예제가 같은 topology를 쓰는 것은 의도이며 독립 복제되는 예제 데이터라 그대로 두었다. 이 스캔은 AST/의미 분석이나 ‘중복 0’ 증명이 아니다.

짧은 반복 패턴까지 모두 합치지 않았다. 실수/복소수 matrix stamping, 초기조건/동작점, 레거시 표기 helper는 물리적 의미와 기존 회귀 때문에 무작정 통합하지 않는다. `plot-format.js`의 일부 함수는 새 view의 실사용 경로가 아닌 기존 회귀 계약에 남아 있다. 제거하려면 호환 범위를 먼저 정해야 한다.

`app.js`는 약1774줄에서 약1737줄로 감소했지만 여전히 큰 coordinator다. 새 기능 때문에 전체 코드량은 증가했다. 경계 검사도 **경고1개**를 유지한다. 다음 분리 대상은 input transaction controller → run controller → editor/pointer controller다. 파일 수 증가나 줄 수 감소 자체를 완성도로 보지 않는다.

## 5. UI/UX: Apple 스타일을 적용한 범위

기본 화면을 차콜 계열 다크로 바꾸고 순백 중심 라이트를 보조 선택으로 두었다. 시스템 글꼴, 일관된 모서리/간격, 단순한 툴바, 절제된 파란 주동작, 명확한 패널 위계로 구성했다. 파형·격자·수치에는 불투명 표면을 사용하고 도구 영역에만 약한 반투명을 허용한다. Apple 로고, 가짜 macOS 버튼, 번들 폰트는 사용하지 않았다.

회로와 결과의 기능은 이전 후보를 유지한다. 한 번 선택하는 예제, 관찰 목적, 접힌 고급 설정, 1–2–5 눈금, 자동맞춤, 공통 물리량 축, AC 상세 해설은 사라지지 않는다. 회전 부품 라벨과 확대·축소 조작의 가독성을 보완했다.

테마는 회로값·설정·프로브 원색·solver 결과를 바꾸지 않는다. 저장소를 사용할 수 없으면 테마는 현재 세션에서만 적용된다. 파형 색은 양쪽 테마 배경 대비를 확보하도록 화면에서만 보정한다. 같은 색이 저장 파일과 화면에서 수치 RGB상 약간 다를 수 있지만 모든 표시 위치에 같은 보정을 적용한다.

다크 주요 텍스트 7:1, 보조텍스트4.5:1, 주동작 버튼4.5:1을 조건 시험했다. 파형 보정도 dark/light 배경에 대해4.5:1 이상을 확인했다. 모든 UI 픽셀·상태·스크린리더에 대한 접근성 인증은 아니다. Safari/macOS 네이티브 감성까지 동일하다고 주장하지 않는다.

외부 참고는 아래 Apple 공식 지침이다. 이번 UI 구성은 이 프로젝트에 맞춘 설계 판단이다.

```text
https://developer.apple.com/design/human-interface-guidelines/dark-mode
https://developer.apple.com/design/human-interface-guidelines/color
https://developer.apple.com/design/human-interface-guidelines/materials
```

실제 실행 화면은 통합 묶음의 `evidence/audit-browser-final/dark-1440.png`, `dark-390-results.png`, `dark-ac-learning.png`에서 확인한다. 생성형 이미지 목업이 아니다.

## 6. 검증 결과

| 종류 | 결과 | 해석 |
|---|---|---|
| 입력 ZIP | 132파일 / manifest131개 일치 | 아카이브 내부 무결성 |
| 기존 앱 Node | 70/70 통과 | 이전 기준선 보존 |
| 원 UX 후보 Node | 106/106 통과 | 기존 시험만으로 남은 결함을 배제할 수 없음 |
| 추가 수치/편집 재현을 원 후보에 적용 | 16개 중14실패·2정상대조 통과 | 수정 전 결함/미지원 계약을 확인한 예상 실패 |
| 최종 사본 Node | 131/131 통과 | 기존106 + 이번25, 기존 허용오차를 완화하지 않음 |
| 원 후보 추가 브라우저 대조 | 3개 중2실패·1통과 | draft/undo 문제, dblclick은 정상대조 |
| 최종 기존 브라우저 시나리오 | 22/22 통과 | 오프라인 전송 하네스 |
| 최종 추가 브라우저 시나리오 | 21/21 통과 | 테마·입력·독립축·CSV·import·화면 |
| 기본 서버 HTTP | 13/13 통과 | 응답/경로/호스트/메서드/헤더만 검증 |
| 경계 검사 | 오류0·경고1 | 경량 문자열/의존 그래프 검사 |
| 실행기 smoke | 시작200·정상종료·서버종료 확인 | Linux --no-browser만, Windows CMD 아님 |

실제 환경은 Linux / Node22.16.0 / Chromium144.0.7559.96 / Python Playwright다. 기존 handover가 기록한 Windows Node24.19.0 결과와 혼합하지 않는다. 브라우저 localhost 접근에서 `ERR_BLOCKED_BY_ADMINISTRATOR`를 관측해, 동봉된 CSS inline/ES module import 전송 하네스를 사용했다. sandbox 정책을 우회하거나 실 PC에 접속한 것이 아니다.

**중요:** Node 서버를 실제 HTTP로 읽는 시험과 브라우저 UI의 오프라인 시험은 서로 다른 증거다. 합쳐서 ‘실제 HTTP UI PASS’라고 표시할 수 없다. 원 U 잔여의 일부 조작을 새 하네스에서 관찰했을 뿐이며, 원 최종 통합 판단은 그대로 남는다.

이번 실행 중 한 번 여러 명령을 함께 호출한 도구 타임아웃으로 브라우저 프로세스가 종료됐다. 해당 부분 실행은 최종 증거로 쓰지 않았고, 단독 재실행의 전체21개 결과를 `audit-browser-final`에 기록했다. 중간 개발 로그를 최종 성공으로 섞지 않는다.

## 7. 여전히 남은 과제

### 통합 전 우선

1. Windows의 무계측 제품 서버에서 실제 HTTP UI 시험을 실행한다. 입력 오류 실행/저장/CSV, AC 정확 설정, import rollback, Shift/Alt 휠, 0/음수, 마지막 AC 및 비균일 표본 cursor, narrow peak/gap을 원 protocol과 대조한다. 테스트 스크립트에 없는 U 항목은 수동 근거가 필요하다.
2. 새로운 0 AC CSV 표현과 `E/μ` 지원, 계산량 한도를 설계 계약 변경으로 승인한다. `-Infinity`를 받는 후속 분석 도구를 확인한다.
3. 역바이어스 다이오드 AC와 topology/end 표본 변경을 UI 변경과 별도로 검토한다. 기존 C 초기조건 N1~N5와 OP AMP 예제를 다시 대조한다.
4. 새 다크 화면을 실제 사용자 환경에서 수용한다. 320/390/1024/1440 viewport는 시험했으나 실제 touch, OS DPI, 125/150% browser zoom, Safari/Firefox/실제 macOS, 테마 영구 저장은 이번 증거에 포함되지 않는다.

### 이후 기능/구조

- 입력 단위 차원 검사, 복제 참조명 정책, differential voltage probe, 전달함수 이득, 전력·에너지, 매개변수 실험.
- `app.js` 분리 및 Web Worker/취소/진행 상황. 먼저 측정과 데이터 소유권 계약을 만들고 구현한다.
- 선택·이동·probe 외 drawing 전반의 스크린리더/키보드 접근성은 별도 개발 대상이다.
- 저장한 회로 변경사항의 자동 저장/전체 unsaved-change 알림은 구현하지 않았다. 이번 확인은 **미확정 입력** 전환 정책이다. 중요한 작업은 JSON으로 따로 저장한다.
- 완전 이상형 및 실제형 OP AMP는 계속 미구현이다. 사후 clip만으로 실제 모델처럼 만들지 않는다.

## 8. OP AMP 계획의 처리

`OPAMP-PLAN-NOT-IMPLEMENTED.md`에 원 START-HERE 7절을 그대로 보존했다. 이상형은 무한 이득의 제약식과 해 존재 조건, 실제형은 유한 DC 이득·rail 포화·AC 단일극·transient GBW/slew의 일관성을 순차 검증해야 한다. 전원핀/속성 선택, 기본값, offset/bias/전류 제한/noise 포함 범위는 아직 미정이다.

기존 OPAMP 저장 파일을 몰래 이상형으로 변환하지 않는다. 두 모델의 실제 개발은 `설계 계약 → 독립 기대값 → 작은 구현 → 회귀/CSV/저장 → 관리 승인` 단계로 한다.

## 9. 세션 운영과 통합 방법

새 문서는 `docs/dark-sessions/`에 있다. 운영관리는 우선순위·파일 소유권·통합, 설계·해석은 독립 기대값과 계약 변경, 실행은 승인 범위 구현 및 실 HTTP 증거를 담당한다. 작성자 혼자 기대값을 수정하고 완료 판정하지 않는다.

이 사본은 여러 주제가 함께 들어 있으므로 바로 baseline에 덮어쓰지 않는다. 별도 branch/worktree에서 검토하고, (A)입력·편집 안전성 (B)수치 정확성 (C)테마·표시 (D)실행/서버 (E)문서/검증으로 변경을 분리한다. 동봉 `changes.patch`는 **입력 ZIP의 source-ux-candidate 기준**이다. 현재 사용자 트리가 다른 경우 무리하게 적용하지 말고 충돌을 검토한다. 저장소 커밋은 이번에 생성하지 않았다.

## 10. 증거를 찾는 방법

이 보고서의 AUDIT-N/W 시험은 `tests/audit-numeric.test.mjs`, `tests/audit-workflow.test.mjs`에 있다. 브라우저 AUDIT-B는 `scripts/browser/audit_browser.py`이다. Node 전체 로그는 `evidence/final-node-tests.log`, 브라우저 결과는 `evidence/browser-final/browser-regression.json` 및 `evidence/audit-browser-final/audit-results.json`, HTTP는 `evidence/http-after-checks.json`이다.

통합 묶음의 `EXPORT-VERIFICATION.json`에 최종 ZIP/TXT 복원 해시·파일 수를 별도 기록한다. 이 수치는 문서 작성 후 실제 내보내기에서 생성하며 추정하지 않는다. source ZIP만 받은 경우 검증 로그 전체는 별도 통합 묶음에 있다.

## 부록 A. 최종 런타임 JS 전체 파일 검토 목록

아래 목록은 정적 검토 범위다. 개별 파일의 모든 분기 실행이나 formal proof를 뜻하지 않는다. 공통 회귀131개와 표시43개 시나리오의 범위를 함께 읽는다.

| 파일 | 줄 수 | 책임 |
|---|---:|---|
| `src/analysis-diagnostics.js` | 59 | 진단 문구·실행 상태 표시 |
| `src/analysis-policy.js` | 65 | 휴리스틱 관찰 목적/범위 |
| `src/app.js` | 1737 | 상태·편집·입력·실행 coordinator |
| `src/circuit-edit.js` | 118 | 삭제·복제·분할·probe 이력 관련 모델 |
| `src/circuit-engine.js` | 1164 | 구조 검사·MNA·DC/transient/AC·초기조건 |
| `src/circuit-geometry.js` | 131 | 핀 좌표·그리드·배선 경로 |
| `src/circuit-status.js` | 110 | 해석별 연결 상태 사전 진단 |
| `src/color-model.js` | 26 | 순수 sRGB 대비 계산 |
| `src/csv-format.js` | 75 | 원시 결과 CSV/안전 헤더 |
| `src/examples.js` | 197 | 8개 독립 예제와 복제 |
| `src/input-drafts.js` | 16 | 필드별 미확정 입력 보존 |
| `src/measurement-format.js` | 13 | AC 절대 레벨·위상 |
| `src/phasor-format.js` | 75 | 페이저·RMS·이론 임피던스 |
| `src/phasor-view.js` | 152 | 페이저·임피던스 화면 |
| `src/plot-format.js` | 62 | 이전 표시 계약/공통 전류 단위 |
| `src/pointer-session.js` | 13 | 단일 포인터 소유권 |
| `src/project-format.js` | 82 | 프로젝트 JSON 검증·호환 |
| `src/safe-dom.js` | 13 | 문자열·색 안전성 |
| `src/scope-model.js` | 127 | 1–2–5 눈금·cursor·peak/gap |
| `src/scope-view.js` | 303 | SVG 오실로스코프 표시 |
| `src/theme.js` | 18 | 화면 환경설정 |
| `src/trace-color.js` | 24 | 읽기 가능한 표시색 |
| `src/ui-model.js` | 47 | source별 편집 필드·slider·probe |
| `src/union-find.js` | 27 | 공유 disjoint-set |

추가 검토: index.html/styles.css 전체, 기본 server/launcher, export-source, check-boundaries, 기존 fixture·test, 브라우저 harness 및 세션/프로젝트 기록. 기존 attempt-02 계측 도구의 수집 결과는 원 인계 근거로 보존하며 그 Windows 실험을 이번에 재실행했다고 주장하지 않는다.

## 부록 B. 주요 코드 위치

| 기준 함수/모듈 | 최종 위치 |
|---|---|
| `export function buildTopology` | `src/circuit-engine.js:254` |
| `function diodeSmallSignalConductance` | `src/circuit-engine.js:602` |
| `export function simulateTransient` | `src/circuit-engine.js:846` |
| `function assertAnalysisBudget` | `src/circuit-engine.js:503` |
| `export function splitWireAtJunction` | `src/circuit-edit.js:21` |
| `export function retargetWireProbes` | `src/circuit-edit.js:56` |
| `export function fittedAxis` | `src/scope-model.js:33` |
| `function commitPendingInputs` | `src/app.js:205` |
| `function recordProbeEdit` | `src/app.js:163` |
| `function componentMarkup` | `src/app.js:351` |
| `function renderOverlay` | `src/app.js:418` |
| `const safeHeaders` | `src/csv-format.js:61` |
