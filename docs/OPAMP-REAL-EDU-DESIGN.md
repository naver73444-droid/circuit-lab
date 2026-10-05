# OPAMP_REAL_EDU 교육용 실제형 설계 — 구현 전 제안

상태: **설계만 완료, 타입·UI·solver 미구현**. 특정 제조사 모델이 아니며 별도 승인 전 제품 기능으로 표시하지 않는다. 기존 `OPAMP`와 `OPAMP_IDEAL`은 재해석하지 않는다.

## 제안 파라미터와 경계

- 기본값: `A0=100000`, `GBW=1 MHz`, `slew=0.5 V/µs`, `vLow=-15 V`, `vHigh=+15 V`.
- 첫 단계 rail은 속성으로 두고 외부 전원핀과 소비전류 모델은 제외한다.
- 출력저항 0, 입력전류 0으로 시작한다.
- offset, bias current, noise, current limit, CMRR/PSRR, 제조사 특성은 제외한다.
- 검증은 `vLow < vHigh`, `A0>0`, `GBW>0`, `slew>0`를 요구한다.

## 일관된 상태 모델

`d=Vplus−Vminus`, 내부 출력 상태 `x`, `wp=2π·GBW/A0`로 둔다. 출력은 별도 MNA branch 제약 `Vout=x`로 풀어 부하 KCL을 함께 만족한다. 계산 뒤 결과만 clip하는 방식은 금지한다.

- DC: `x=clip(A0·d, vLow, vHigh)`.
- transient: `xdot=clip(wp·(A0·d−x), −slew, +slew)`. rail에서 바깥 방향 미분은 0인 상태제약을 둔다.
- AC: DC 동작점의 동일 모델을 선형화한다. rail/slew 비활성에서는 `A(s)=A0/(1+s/wp)`, 포화 내부에서는 국소 이득 0이다. rail 경계의 미분불연속은 미정/제한으로 안내한다. slew를 소신호 AC 크기에 직접 적용하지 않는다.

## 후속 카드 분리

1. DC 포화·negative feedback·출력 branch KCL과 rail 순서.
2. 동작점 기반 AC·단일극·포화 내부 국소 이득.
3. implicit transient의 bandwidth/slew·rail 상태·초기상태/rail 전이 수렴.

초기상태 선택, rail 경계 complementarity/active-set, implicit integration의 정확한 잔차·허용오차, 에너지 해석 한계는 후속 계약에서 먼저 고정해야 한다. 이 문서의 값과 방정식은 구현·보정·안정성 검증 완료를 뜻하지 않는다.
