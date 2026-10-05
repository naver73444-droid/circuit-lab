# Circuit Lab 공통 계약

이 문서는 현재 제품 계약과 후속 확장 설계를 구분한다. 후속 항목은 schema·solver·UI 구현 승인이 아니다.

## 현재 지원 계약

### 전기량·핀·단위

- 기존 2핀 소자는 `v=V(pin0)−V(pin1)`, `i=pin0→pin1`을 양수로 쓴다. GND는 0 V 기준이다.
- `OPAMP`는 기본 개방루프 이득 100,000의 legacy 유한이득 모델이다. `OPAMP_IDEAL`은 입력전류 0, `V+−V−=0`, 출력저항 0인 제약이며 출력 branch 전류 양수는 output→내부 기준 GND다.
- AC 페이저는 peak/cos 기준이고 RMS는 peak/√2다. 저장·CSV의 기본 전기 단위는 SI다. 기존 핀 순서를 바꾸지 않는다.
- 현재 parser는 `M`/`meg`를 mega, `m`을 milli, `u`/`µ`를 micro로 해석하고 입력 문자열을 props에 보존한다. 일반 parser가 소문자 단위 문자열을 통과시키는 것은 차원 검증이 아니다.

### 영구 참조·파일

- component/wire/junction의 `id`가 영구 참조다. `ref`는 표시명이다. 해석 중 node/branch index는 저장 참조로 쓰지 않는다.
- JSON version 1 project wrapper와 raw circuit import를 구분한다. geometryVersion 1과 2를 지원하며 알려지지 않은 type/version을 조용히 무시하지 않는다.
- probe는 영구 component/pin 또는 junction을 anchor로 삼고 `wireId`는 편집 보조 참조다. split 시 유효 segment로 retarget하고 대상 삭제 시 dangling 참조를 제거한다.

### 입력·실행 상태

| 상태 | 의미 | 결과·내보내기 |
|---|---|---|
| draft | committed 값과 다른 미확정 문자열 | 이전 결과는 stale, 실행/저장/CSV 차단 |
| invalid | parse 또는 범위 검증 실패 | 필드·원인을 표시하고 draft 보존 |
| not-run | 현재 회로를 아직 계산하지 않음 | 유효 결과 없음 |
| running | 현재 generation 계산 중 | generation 변경 시 결과 채택 금지 |
| success | 현재 generation 계산 성공 | 저장된 probe 결과 표시·CSV 허용 |
| stale | 회로·설정·draft가 성공 결과 뒤 변경됨 | 이전 raw 보존 가능, 최신 성공 표시·CSV 금지 |
| error | 현재 generation 계산 실패 | 유효 결과 없음, 진단 표시 |
| cancel | draft 명시 취소 또는 진행 작업 취소 | committed 값·기존 이력 의미 복원 |

parse/validate가 끝나기 전에 project state를 교체하지 않는다. invalid 입력을 이전 committed 값으로 몰래 계산해 성공으로 표시하지 않는다.

## 후속 설계 전용

- VCVS/VCCS pin은 `[p,n,cp,cn]`, gain은 각각 V/V와 gm(S)다. CCCS/CCVS pin은 `[p,n]`, gain은 A/A와 rm(Ω)이며 `control={elementId,direction:±1}`를 제안한다. 전류 제어 센서는 명시적 0 V 직렬 branch여야 한다.
- 내부 복제는 같은 복제 묶음의 control 참조를 새 ID로 remap하고 외부 control 참조는 원 대상을 유지한다. 누락 참조는 명시 오류다.
- 새 타입은 향후 schema capability/version 정책 뒤에만 저장한다. 구버전이 조용히 무시하거나 다른 타입으로 바꾸지 않는다.
- port는 p/n 영구 endpoint, 제외 부하 ID, analysis/revision/frequency/Q 식별을 가진다. 결과 부호는 `Vport=Vp−Vn`, `I_into`는 회로 안으로 들어가는 전류다.
- gm의 차원은 S, 시간은 s로 문맥별 검증한다. 현재 parser를 차원 시스템으로 간주하지 않는다.

VCVS/VCCS/CCCS/CCVS, 센서, port는 현재 palette·type registry·solver에 등록하지 않는다.
