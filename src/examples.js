import { componentDefaults } from "./circuit-engine.js";
import { CURRENT_GEOMETRY_VERSION, snapPoint } from "./circuit-geometry.js";

function component(id, type, x, y, props = {}, rotation = 0) {
  const index = Number(id.match(/\d+/)?.[0] ?? 1);
  return { id, type, ...snapPoint({ x, y }), rotation, props: { ...componentDefaults(type, index), ...props } };
}

function wire(id, aId, aPin, bId, bPin) {
  return { id, a: { componentId: aId, pin: aPin }, b: { componentId: bId, pin: bPin } };
}

function circuit(components, wires, junctions) {
  return { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components, wires, ...(junctions ? { junctions } : {}) };
}

export const examples = [
  {
    id: "divider",
    name: "분압기 (DC)",
    description: "10 V 전원과 1 kΩ 저항 두 개. 중간 노드는 5 V, 전류는 5 mA입니다.",
    settings: { analysis: "dc" },
    circuit: circuit(
      [
        component("V1", "V", 150, 230, { mode: "DC", dc: "10", ref: "V1" }, 90),
        component("R1", "R", 360, 150, { value: "1k", ref: "R1" }, 90),
        component("R2", "R", 360, 300, { value: "1k", ref: "R2" }, 90),
        component("G1", "GND", 250, 400, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 1, "R2", 0),
        wire("W3", "R2", 1, "G1", 0),
        wire("W4", "V1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "rc-charge",
    name: "RC 충전 (시간응답)",
    description: "1 kΩ·1 µF, 0→5 V 계단. τ=1 ms에서 출력은 약 3.1606 V입니다.",
    settings: { analysis: "transient", start: "0", end: "5m", step: "10u" },
    circuit: circuit(
      [
        component("V1", "V", 140, 240, { mode: "PULSE", pulseV1: "0", pulseV2: "5", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "1", pulsePeriod: "2", dc: "0", ref: "V1" }, 90),
        component("R1", "R", 330, 140, { value: "1k", ref: "R1" }),
        component("C1", "C", 500, 260, { value: "1u", ic: "0", ref: "C1" }, 90),
        component("G1", "GND", 320, 400, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 1, "C1", 0),
        wire("W3", "C1", 1, "G1", 0),
        wire("W4", "V1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "rc-lowpass",
    name: "RC 저역통과 (AC)",
    description: "1 V AC 입력의 1 kΩ·1 µF 저역통과. 차단주파수 약 159.155 Hz에서 출력 −3.01 dBV(이득 −3.01 dB), −45°입니다.",
    settings: { analysis: "ac", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30" },
    circuit: circuit(
      [
        component("V1", "V", 140, 240, { mode: "SIN", dc: "0", acMagnitude: "1", acPhase: "0", ref: "V1" }, 90),
        component("R1", "R", 330, 140, { value: "1k", ref: "R1" }),
        component("C1", "C", 500, 260, { value: "1u", ic: "0", ref: "C1" }, 90),
        component("G1", "GND", 320, 400, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 1, "C1", 0),
        wire("W3", "C1", 1, "G1", 0),
        wire("W4", "V1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "rl",
    name: "RL 응답",
    description: "100 Ω·10 mH 직렬 회로. 1 V 계단에서 τ=0.1 ms, 최종 전류 10 mA입니다.",
    settings: { analysis: "transient", start: "0", end: "500u", step: "1u" },
    circuit: circuit(
      [
        component("V1", "V", 140, 240, { mode: "PULSE", pulseV1: "0", pulseV2: "1", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "1", pulsePeriod: "2", ref: "V1" }, 90),
        component("R1", "R", 320, 140, { value: "100", ref: "R1" }),
        component("L1", "L", 500, 260, { value: "10m", ic: "0", ref: "L1" }, 90),
        component("G1", "GND", 320, 400, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 1, "L1", 0),
        wire("W3", "L1", 1, "G1", 0),
        wire("W4", "V1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "rlc",
    name: "직렬 RLC 응답",
    description: "100 Ω·10 mH·1 µF 직렬 회로의 감쇠 진동 계단 응답입니다.",
    settings: { analysis: "transient", start: "0", end: "1m", step: "1u" },
    circuit: circuit(
      [
        component("V1", "V", 120, 250, { mode: "PULSE", pulseV1: "0", pulseV2: "1", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "1", pulsePeriod: "2", ref: "V1" }, 90),
        component("R1", "R", 280, 130, { value: "100", ref: "R1" }),
        component("L1", "L", 450, 130, { value: "10m", ic: "0", ref: "L1" }),
        component("C1", "C", 570, 270, { value: "1u", ic: "0", ref: "C1" }, 90),
        component("G1", "GND", 330, 410, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 1, "L1", 0),
        wire("W3", "L1", 1, "C1", 0),
        wire("W4", "C1", 1, "G1", 0),
        wire("W5", "V1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "parallel-sine",
    name: "병렬 RLC · SIN/AC 비교",
    description: "2 Vpk·1 kHz SIN의 초기조건 시간응답과 AC 정상상태를 비교합니다. 이상 L의 DC와 transient offset 차이를 확인하세요.",
    settings: { analysis: "transient", start: "0", end: "2m", step: "2.5u", startFrequency: "100", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: "1k" },
    circuit: circuit(
      [
        component("V1", "V", 120, 280, { mode: "SIN", dc: "0", amplitude: "2", frequency: "1k", offset: "0", phase: "0", acMagnitude: "2", acPhase: "-90", ref: "V1" }, 90),
        component("R1", "R", 280, 150, { value: "1k", ref: "R1" }, 90),
        component("L1", "L", 430, 150, { value: "10m", ic: "0", ref: "L1" }, 90),
        component("C1", "C", 580, 150, { value: "1u", ic: "0", ref: "C1" }, 90),
        component("G1", "GND", 350, 420, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 0, "L1", 0),
        wire("W3", "L1", 0, "C1", 0),
        wire("W4", "V1", 1, "G1", 0),
        wire("W5", "R1", 1, "G1", 0),
        wire("W6", "L1", 1, "G1", 0),
        wire("W7", "C1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "diode",
    name: "다이오드 반파 정류",
    description: "5 Vpeak·60 Hz 입력, Shockley 다이오드와 1 kΩ 부하의 반파 정류입니다.",
    settings: { analysis: "transient", start: "0", end: "33.34m", step: "50u" },
    circuit: circuit(
      [
        component("V1", "V", 120, 250, { mode: "SIN", offset: "0", amplitude: "5", frequency: "60", phase: "0", dc: "0", ref: "V1" }, 90),
        component("D1", "D", 310, 130, { ref: "D1", is: "1e-12", n: "1" }),
        component("R1", "R", 500, 260, { value: "1k", ref: "R1" }, 90),
        component("G1", "GND", 310, 410, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "D1", 0),
        wire("W2", "D1", 1, "R1", 0),
        wire("W3", "R1", 1, "G1", 0),
        wire("W4", "V1", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "opamp",
    name: "비반전 연산증폭기",
    description: "0.1 V 입력과 9 kΩ/1 kΩ 피드백의 이득 10 구성입니다. 전원·포화는 생략한 간략 모델입니다.",
    settings: { analysis: "dc" },
    circuit: circuit(
      [
        component("V1", "V", 100, 280, { mode: "DC", dc: "0.1", ref: "V1" }, 90),
        component("U1", "OPAMP", 360, 210, { gain: "100k", ref: "U1" }),
        component("R1", "R", 520, 300, { value: "9k", ref: "R1" }, 90),
        component("R2", "R", 360, 380, { value: "1k", ref: "R2" }),
        component("G1", "GND", 210, 450, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "U1", 0),
        wire("W2", "V1", 1, "G1", 0),
        wire("W3", "U1", 2, "R1", 0),
        wire("W4", "R1", 1, "U1", 1),
        wire("W5", "U1", 1, "R2", 0),
        wire("W6", "R2", 1, "G1", 0),
      ],
    ),
  },
  {
    id: "y-network",
    name: "Y 저항망 (Y–Δ 변환)",
    description: "12 V 전원 뒤에 R1·R2·R3가 한 점에서 만나는 Y가 있고 B·C 가지에 1 kΩ 부하가 있습니다. 저항 3개를 모두 선택하고 'Y→Δ 변환'을 누르면 삼각형으로 바뀌어도 A·B·C 전압은 그대로입니다.",
    settings: { analysis: "dc" },
    circuit: {
      version: 1,
      geometryVersion: CURRENT_GEOMETRY_VERSION,
      components: [
        component("V1", "V", 140, 260, { mode: "DC", dc: "12", ref: "V1" }, 90),
        component("R1", "R", 320, 260, { value: "1k", ref: "R1" }),
        component("R2", "R", 420, 160, { value: "2k", ref: "R2" }, 90),
        component("R3", "R", 420, 360, { value: "3k", ref: "R3" }, 90),
        component("R4", "R", 560, 160, { value: "1k", ref: "R4" }, 90),
        component("R5", "R", 560, 360, { value: "1k", ref: "R5" }, 90),
        component("G1", "GND", 620, 540, { ref: "GND" }),
      ],
      junctions: [{ id: "J1", x: 420, y: 260 }],
      wires: [
        wire("W1", "V1", 0, "R1", 0),
        { id: "W2", a: { componentId: "R1", pin: 1 }, b: { junctionId: "J1" } },
        { id: "W3", a: { componentId: "R2", pin: 1 }, b: { junctionId: "J1" } },
        { id: "W4", a: { componentId: "R3", pin: 0 }, b: { junctionId: "J1" } },
        wire("W5", "R2", 0, "R4", 0),
        wire("W6", "R3", 1, "R5", 1),
        { id: "W7", a: { componentId: "R4", pin: 1 }, b: { componentId: "G1", pin: 0 }, waypoints: [{ x: 620, y: 200 }] },
        { id: "W8", a: { componentId: "R5", pin: 0 }, b: { componentId: "G1", pin: 0 }, waypoints: [{ x: 620, y: 320 }] },
        { id: "W9", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 }, waypoints: [{ x: 140, y: 500 }] },
      ],
    },
  },
  {
    id: "coupled-coils",
    name: "결합 코일 (예제 13.1)",
    description: "교재 예제 13.1: 12∠0° 소스, C=−j4 Ω, 결합 코일 L1=j5 Ω·L2=j6 Ω·M=j3 Ω(점 같은 쪽), 부하 12 Ω. ω=1 rad/s에 해당하는 f=1/2π Hz로 AC 해석하면 I(K1.1)=13.01∠−49.39° A, 2차 전류 I(K1.2)=2.91∠14.04° A(교재 I2)입니다. 2차 전류는 교재 그림처럼 점에서 나가는 방향(2b→2a)을 기준으로 뒤집어 두었습니다(속성 칸 `전류 기준 방향`; 엔진 기준 2a→2b로 되돌리면 같은 전류가 −I2로 보임). 부하 R1 전류도 2.91∠14.04° A입니다. 편집기의 AC 값은 peak/cos 기준이라 교재의 rms 12 V를 peak 12√2 V(16.97 V)로 넣었고, 이 예제는 표시 기준을 RMS로 켜서 열립니다: 결과 크기가 교재의 rms 값과 같습니다. 표시 기준을 peak로 바꾸면 모든 크기가 √2배입니다(평균전력은 기준과 무관한 같은 값).",
    acBasis: "rms",
    settings: { analysis: "ac", startFrequency: "0.01", endFrequency: "10", pointsPerDecade: "20", phasorFrequency: "0.1591549431" },
    circuit: circuit(
      [
        component("V1", "V", 120, 240, { mode: "SIN", dc: "0", acMagnitude: "16.970562748477143", acPhase: "0", ref: "V1" }, 90),
        component("C1", "C", 240, 200, { value: "250m", ic: "0", ref: "C1" }),
        // The textbook's I2 leaves the secondary dot: the shown winding-2 reference is flipped (2b→2a) so I(K1.2) reads 2.91∠14.04° A.
        { ...component("K1", "COUPLED_L", 400, 240, { L1: "5", L2: "6", coupling: "M", M: "3", dots: "same", ref: "K1" }), flipCurrent2: true },
        component("R1", "R", 540, 240, { value: "12", ref: "R1" }, 90),
        component("G1", "GND", 360, 380, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "C1", 0),
        wire("W2", "C1", 1, "K1", 0),
        wire("W3", "K1", 1, "G1", 0),
        wire("W4", "V1", 1, "G1", 0),
        wire("W5", "K1", 2, "R1", 0),
        wire("W6", "R1", 1, "K1", 3),
        { id: "W7", a: { componentId: "K1", pin: 3 }, b: { componentId: "G1", pin: 0 }, waypoints: [{ x: 440, y: 340 }] },
      ],
    ),
  },
  {
    id: "ideal-transformer",
    name: "이상 변압기 (예제 13.8)",
    description: "교재 예제 13.8: 120∠0° V 소스, 4 Ω과 −j6 Ω 직렬, 이상 변압기 1:2, 부하 20 Ω. ω=1 rad/s에 해당하는 f=1/2π Hz로 AC 해석하면 I(T1.1)=11.09∠33.69° A, Vo=V(R2.1)=110.9∠−146.31° V(= 교재의 110.9∠213.69° V)입니다. 교재의 점 배치를 따라 2차의 점 핀(2a)을 접지하고 부하를 2b에 걸었습니다. 이 배치에서는 2차 기준 방향 2a→2b가 교재 I2(부하로 흘러 나가는 방향)와 같아, 2차에 I 프로브를 달면 I(T1.2)=5.545∠−146.31° A(= 교재의 −5.545∠33.69° A)로 보입니다(기준을 뒤집지 않음). 120 V는 교재에서 rms인데 편집기의 AC 값은 peak/cos 기준이라 peak 120√2 V(169.7 V)로 넣었고, 이 예제는 표시 기준을 RMS로 켜서 열립니다: 크기가 교재와 같고 부하 20 Ω의 평균전력도 교재의 615.4 W입니다(P = Re(V_rms·I_rms*) = ½·Re(V_pk·I_pk*)). 표시 기준을 peak로 바꾸면 크기가 √2배(I1 15.69 A)이고 전력 숫자는 그대로입니다.",
    acBasis: "rms",
    settings: { analysis: "ac", startFrequency: "0.01", endFrequency: "10", pointsPerDecade: "20", phasorFrequency: "0.1591549431" },
    circuit: circuit(
      [
        component("V1", "V", 120, 240, { mode: "SIN", dc: "0", acMagnitude: "169.7056274847714", acPhase: "0", ref: "V1" }, 90),
        component("R1", "R", 240, 200, { value: "4", ref: "R1" }),
        component("C1", "C", 360, 200, { value: "0.16666666666667", ic: "0", ref: "C1" }),
        component("T1", "XFMR_IDEAL", 520, 240, { n: "2", dots: "same", ref: "T1" }),
        component("R2", "R", 660, 300, { value: "20", ref: "R2" }),
        component("G1", "GND", 480, 380, { ref: "GND" }),
        component("G2", "GND", 620, 260, { ref: "GND" }),
        component("G3", "GND", 700, 380, { ref: "GND" }),
      ],
      [
        wire("W1", "V1", 0, "R1", 0),
        wire("W2", "R1", 1, "C1", 0),
        wire("W3", "C1", 1, "T1", 0),
        wire("W4", "T1", 1, "G1", 0),
        wire("W5", "V1", 1, "G1", 0),
        wire("W6", "T1", 2, "G2", 0),
        { id: "W7", a: { componentId: "T1", pin: 3 }, b: { componentId: "R2", pin: 0 }, waypoints: [{ x: 560, y: 300 }] },
        wire("W8", "R2", 1, "G3", 0),
      ],
    ),
  },
  {
    id: "three-phase-yy",
    name: "3상 Y–Y (예제 12.2)",
    description: "교재 예제 12.2: 평형 3상 Y–Y, 상전압 110 V(rms) abc 순서, 선로 5−j2 Ω + 부하 10+j8 Ω. ω=1 rad/s에 해당하는 f=1/2π Hz로 AC 해석하면 선전류 Ia=I(RLa)=6.81∠−21.8° A, Ib=6.81∠−141.8° A, Ic=6.81∠98.2° A(rms)입니다. 소스 크기는 peak(110·√2)로 저장되고 이 예제는 rms 표시로 열려 교재 숫자가 그대로 보입니다. −j2 Ω은 0.5 F, j8 Ω은 8 H로 둔 값이며, 부하 중성점은 GND에 이어도 평형이라 중성선 전류는 0입니다.",
    acBasis: "rms",
    settings: { analysis: "ac", startFrequency: "0.01", endFrequency: "10", pointsPerDecade: "20", phasorFrequency: "0.1591549431" },
    circuit: circuit(
      [
        component("VP1", "THREE_PHASE", 140, 300, { amplitude: String(110 * Math.SQRT2), phase: "0", sequence: "abc", frequency: "0.1591549431", ref: "VP1" }),
        ...[["a", 100], ["b", 300], ["c", 500]].flatMap(([phase, y]) => [
          component(`RL${phase}`, "R", 300, y, { value: "5", ref: `RL${phase}` }),
          component(`CL${phase}`, "C", 420, y, { value: "0.5", ic: "0", ref: `CL${phase}` }),
          component(`RZ${phase}`, "R", 540, y, { value: "10", ref: `RZ${phase}` }),
          component(`LZ${phase}`, "L", 660, y, { value: "8", ic: "0", ref: `LZ${phase}` }),
        ]),
        component("G1", "GND", 100, 400, { ref: "GND" }),
        component("G2", "GND", 740, 580, { ref: "GND" }),
      ],
      [
        wire("W1", "VP1", 0, "RLa", 0), wire("W2", "VP1", 1, "RLb", 0), wire("W3", "VP1", 2, "RLc", 0), wire("W4", "VP1", 3, "G1", 0),
        ...["a", "b", "c"].flatMap((phase) => [
          wire(`WA${phase}`, `RL${phase}`, 1, `CL${phase}`, 0), wire(`WB${phase}`, `CL${phase}`, 1, `RZ${phase}`, 0), wire(`WC${phase}`, `RZ${phase}`, 1, `LZ${phase}`, 0),
        ]),
        { id: "WN1", a: { componentId: "LZa", pin: 1 }, b: { junctionId: "JN1" } },
        { id: "WN2", a: { componentId: "LZb", pin: 1 }, b: { junctionId: "JN2" } },
        { id: "WN3", a: { componentId: "LZc", pin: 1 }, b: { junctionId: "JN3" } },
        { id: "WN4", a: { junctionId: "JN1" }, b: { junctionId: "JN2" } },
        { id: "WN5", a: { junctionId: "JN2" }, b: { junctionId: "JN3" } },
        { id: "WN6", a: { junctionId: "JN3" }, b: { componentId: "G2", pin: 0 } },
      ],
      [{ id: "JN1", x: 740, y: 100 }, { id: "JN2", x: 740, y: 300 }, { id: "JN3", x: 740, y: 500 }],
    ),
  },
  {
    id: "three-phase-y-delta",
    name: "3상 Y–Δ (예제 12.3)",
    description: "교재 예제 12.3: 평형 3상 Y 전원 Van=100∠10° V(rms) abc 순서, Δ 부하 8+j4 Ω/상. ω=1 rad/s에 해당하는 f=1/2π Hz로 AC 해석하면 상전류 I_AB=I(RAB)=19.36∠13.43° A, 선전류 Ia=I(Sa)=33.53∠−16.57° A(rms)이고 Ib는 −120°, Ic는 +120° 이동합니다. 선전류는 0 V 전류 센서 Sa·Sb·Sc로 잽니다. 소스 크기는 peak(100·√2)로 저장되고 이 예제는 rms 표시로 열립니다. j4 Ω은 4 H로 둔 값입니다.",
    acBasis: "rms",
    settings: { analysis: "ac", startFrequency: "0.01", endFrequency: "10", pointsPerDecade: "20", phasorFrequency: "0.1591549431" },
    circuit: circuit(
      [
        component("VP1", "THREE_PHASE", 140, 300, { amplitude: String(100 * Math.SQRT2), phase: "10", sequence: "abc", frequency: "0.1591549431", ref: "VP1" }),
        component("Sa", "CURRENT_SENSOR", 300, 100, { ref: "Sa" }),
        component("Sb", "CURRENT_SENSOR", 300, 300, { ref: "Sb" }),
        component("Sc", "CURRENT_SENSOR", 300, 500, { ref: "Sc" }),
        // Δ ring A→B→C→A: each side is a resistor (pin 1 on the leading corner) in series with an inductor.
        component("RAB", "R", 640, 140, { value: "8", ref: "RAB" }, 90),
        component("LAB", "L", 640, 240, { value: "4", ic: "0", ref: "LAB" }, 90),
        component("RBC", "R", 640, 340, { value: "8", ref: "RBC" }, 90),
        component("LBC", "L", 640, 440, { value: "4", ic: "0", ref: "LBC" }, 90),
        component("RCA", "R", 760, 440, { value: "8", ref: "RCA" }, 270),
        component("LCA", "L", 760, 340, { value: "4", ic: "0", ref: "LCA" }, 270),
        component("G1", "GND", 100, 400, { ref: "GND" }),
      ],
      [
        wire("W1", "VP1", 0, "Sa", 0), wire("W2", "VP1", 1, "Sb", 0), wire("W3", "VP1", 2, "Sc", 0), wire("W4", "VP1", 3, "G1", 0),
        { id: "WA", a: { componentId: "Sa", pin: 1 }, b: { junctionId: "JA" } },
        { id: "WB", a: { componentId: "Sb", pin: 1 }, b: { junctionId: "JB" } },
        { id: "WC", a: { componentId: "Sc", pin: 1 }, b: { junctionId: "JC" } },
        { id: "WAB1", a: { junctionId: "JA" }, b: { componentId: "RAB", pin: 0 } },
        wire("WAB2", "RAB", 1, "LAB", 0),
        { id: "WAB3", a: { componentId: "LAB", pin: 1 }, b: { junctionId: "JB" } },
        { id: "WBC1", a: { junctionId: "JB" }, b: { componentId: "RBC", pin: 0 } },
        wire("WBC2", "RBC", 1, "LBC", 0),
        { id: "WBC3", a: { componentId: "LBC", pin: 1 }, b: { junctionId: "JC" } },
        { id: "WCA1", a: { componentId: "RCA", pin: 0 }, b: { junctionId: "JC" } },
        wire("WCA2", "RCA", 1, "LCA", 0),
        { id: "WCA3", a: { componentId: "LCA", pin: 1 }, b: { junctionId: "JA" }, waypoints: [{ x: 760, y: 60 }, { x: 560, y: 60 }] },
      ],
      [{ id: "JA", x: 560, y: 100 }, { id: "JB", x: 560, y: 300 }, { id: "JC", x: 560, y: 500 }],
    ),
  },
];

export function cloneExample(id) {
  const example = examples.find((item) => item.id === id);
  if (!example) throw new Error(`예제를 찾을 수 없습니다: ${id}`);
  return {
    ...example,
    settings: structuredClone(example.settings),
    circuit: structuredClone(example.circuit),
  };
}
