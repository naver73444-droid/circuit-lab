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
