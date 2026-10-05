# CIRCUIT-015 — 전류 센서와 전류 제어 종속원

- `CURRENT_SENSOR`는 p(pin 1)→n(pin 2)을 양의 전류로 하는 직렬 0 V 센서다.
- `CCCS`는 `I(p→n)=beta·direction·I(control)`이며 beta는 무차원이다.
- `CCVS`는 `V(p)-V(n)=rm·direction·I(control)`이며 rm은 Ω 단위다.
- control은 `{kind:"branchCurrent", elementId, direction}` 영구 component ID를 저장하며 센서 또는 독립 V만 참조한다. 표시 이름과 배열 순서는 의미를 바꾸지 않는다.
- 새 타입이 포함된 회로와 프로젝트는 version 3이다. dangling/wrong control과 잘못된 계수 차원은 실행·정상 저장 전에 거부한다.
- 일반 복제는 외부 control ID를 유지한다. 종속원에서 Shift+복제하면 대상과 양끝이 내부인 배선을 같은 undo 단위로 복제하고 내부 ID를 새 ID로 바꾼다.
- 중복 이상 전압 가지의 비유일 전류, 지원 밖 중복 C 초기미분은 임의 0 A로 대체하지 않고 명시적으로 실패한다. 실제형·포트·rank/IC 확장은 이 범위에 없다.
