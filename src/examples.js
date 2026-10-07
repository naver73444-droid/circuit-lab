import { componentDefaults } from "./circuit-engine.js";
import { CURRENT_GEOMETRY_VERSION, snapPoint } from "./circuit-geometry.js";

function component(id, type, x, y, props = {}, rotation = 0) {
  const index = Number(id.match(/\d+/)?.[0] ?? 1);
  return { id, type, ...snapPoint({ x, y }), rotation, props: { ...componentDefaults(type, index), ...props } };
}

function wire(id, aId, aPin, bId, bPin) {
  return { id, a: { componentId: aId, pin: aPin }, b: { componentId: bId, pin: bPin } };
}

function circuit(components, wires) {
  return { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components, wires };
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
    description: "교재 예제 13.1: 12∠0° 소스, C=−j4 Ω, 결합 코일 L1=j5 Ω·L2=j6 Ω·M=j3 Ω(점 같은 쪽), 부하 12 Ω. ω=1 rad/s에 해당하는 f=1/2π Hz로 AC 해석하면 I(K1.1)=13.01∠−49.39° A, 부하 R1 전류(교재 I2)=2.91∠14.04° A입니다. I(K1.2)는 점 핀으로 들어가는 방향이라 교재 I2와 부호가 반대입니다. 편집기의 AC 값은 peak/cos 기준이라 교재의 rms 12 V를 peak 12√2 V(16.97 V)로 넣었고, 이 예제는 표시 기준을 RMS로 켜서 열립니다: 결과 크기가 교재의 rms 값과 같습니다. 표시 기준을 peak로 바꾸면 모든 크기가 √2배입니다(평균전력은 기준과 무관한 같은 값).",
    acBasis: "rms",
    settings: { analysis: "ac", startFrequency: "0.01", endFrequency: "10", pointsPerDecade: "20", phasorFrequency: "0.1591549431" },
    circuit: circuit(
      [
        component("V1", "V", 120, 240, { mode: "SIN", dc: "0", acMagnitude: "16.970562748477143", acPhase: "0", ref: "V1" }, 90),
        component("C1", "C", 240, 200, { value: "250m", ic: "0", ref: "C1" }),
        component("K1", "COUPLED_L", 400, 240, { L1: "5", L2: "6", coupling: "M", M: "3", dots: "same", ref: "K1" }),
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
    description: "교재 예제 13.8: 120∠0° V 소스, 4 Ω과 −j6 Ω 직렬, 이상 변압기 1:2, 부하 20 Ω. ω=1 rad/s에 해당하는 f=1/2π Hz로 AC 해석하면 I(T1.1)=11.09∠33.69° A, Vo=V(R2.1)=110.9∠−146.31° V(= 교재의 110.9∠213.69° V)입니다. 교재의 점 배치를 따라 2차의 점 핀(2a)을 접지하고 부하를 2b에 걸었습니다. 120 V는 교재에서 rms인데 편집기의 AC 값은 peak/cos 기준이라 peak 120√2 V(169.7 V)로 넣었고, 이 예제는 표시 기준을 RMS로 켜서 열립니다: 크기가 교재와 같고 부하 20 Ω의 평균전력도 교재의 615.4 W입니다(P = Re(V_rms·I_rms*) = ½·Re(V_pk·I_pk*)). 표시 기준을 peak로 바꾸면 크기가 √2배(I1 15.69 A)이고 전력 숫자는 그대로입니다.",
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
