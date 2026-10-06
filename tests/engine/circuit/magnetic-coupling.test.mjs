import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  componentDefaults, coupledInductorParameters, deserializeCircuit, idealTransformerParameters, secondaryCurrentKey, serializeCircuit,
  simulateAC, simulateACAtFrequency, simulateDC, simulateTransient,
} from "../../../src/circuit-engine.js";

// ---- helpers ---------------------------------------------------------------------------------------------------------------

const mag = (z) => Math.hypot(z.re, z.im);
const phaseDeg = (z) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const cx = (re, im = 0) => ({ re, im });
const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cadd = (a, b) => cx(a.re + b.re, a.im + b.im);
const csub = (a, b) => cx(a.re - b.re, a.im - b.im);
const polar = (m, deg) => cx(m * Math.cos((deg * Math.PI) / 180), m * Math.sin((deg * Math.PI) / 180));
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/** assert |actual| within 0.1 % and phase within 0.1 degree of the expected phasor */
function assertPhasor(actual, expected, label) {
  assert.ok(relative(mag(actual), mag(expected)) <= 1e-3, `${label}: |z| ${mag(actual)} vs ${mag(expected)}`);
  assert.ok(angleDiff(phaseDeg(actual), phaseDeg(expected)) <= 0.1, `${label}: ∠ ${phaseDeg(actual)} vs ${phaseDeg(expected)}`);
}

/** specs: [id, type, props, nets[]]; net "0" is the ground. Pins of COUPLED_L / XFMR_IDEAL are [1a, 1b, 2a, 2b]. */
function build(specs) {
  const items = [...specs.map(([id, type, props, nets], index) => ({ id, type, x: 100 + index * 80, y: 100, rotation: 0, props: { ...componentDefaults(type, index + 1), ref: id, ...props }, nets })), { id: "G1", type: "GND", x: 0, y: 0, rotation: 0, props: { ref: "GND" }, nets: ["0"] }];
  const groups = new Map();
  for (const item of items) item.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: item.id, pin }); });
  const wires = [];
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 1, geometryVersion: 2, components: items.map(({ nets, ...item }) => item), wires, junctions: [] };
}

const acSource = (id, magnitude, phase, nets) => [id, "V", { mode: "SIN", dc: "0", acMagnitude: String(magnitude), acPhase: String(phase) }, nets];
const OMEGA_1_HZ = 1 / (2 * Math.PI);

const nodeVoltage = (result, id, pin, index = 0) => result.points[index].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

// ---- AC: textbook examples -------------------------------------------------------------------------------------------------

describe("자기결합 AC: 교재 예제", () => {
  test("예제 13.1: 12∠0° V, C=−j4, L1=j5, L2=j6, M=j3, 부하 12 Ω → I1=13.01∠−49.39°, I2=2.91∠14.04°", () => {
    const circuit = build([
      acSource("V1", 12, 0, ["a", "0"]),
      ["C1", "C", { value: "0.25" }, ["a", "p1"]],
      ["K1", "COUPLED_L", { L1: "5", L2: "6", coupling: "M", M: "3", dots: "same" }, ["p1", "0", "s1", "0"]],
      ["R1", "R", { value: "12" }, ["s1", "0"]],
    ]);
    // The load joins 2a and 2b (= ground), so the current into dot 2a is -(load current) and the textbook mesh current I2 is the load current.
    const currents = simulateACAtFrequency(circuit, OMEGA_1_HZ).points[0].componentCurrents;
    assertPhasor(currents.K1, polar(13.01, -49.39), "I1");
    assertPhasor(currents.R1, polar(2.91, 14.04), "I2 (R1 전류)");
    assertPhasor(currents[secondaryCurrentKey("K1")], polar(2.91, 14.04 + 180), "I(K1.2) = −I2");
    // closed form of the lecture solution: I2 = 12/(4−j), I1 = (2−j4)·I2
    const i2 = cdiv(cx(12), cx(4, -1));
    assertPhasor(currents.R1, i2, "I2 exact");
    assertPhasor(currents.K1, cmul(cx(2, -4), i2), "I1 exact");
  });

  test("예제 13.8: 120∠0° V, 4−j6 Ω, 이상 변압기 1:2, 20 Ω → I1=11.09∠33.69°, Vo=110.9∠213.69°", () => {
    const circuit = build([
      acSource("V1", 120, 0, ["a", "0"]),
      ["R1", "R", { value: "4" }, ["a", "b"]],
      ["C1", "C", { value: String(1 / 6) }, ["b", "p1"]],
      ["T1", "XFMR_IDEAL", { n: "2", dots: "same" }, ["p1", "0", "0", "o"]],
      ["R2", "R", { value: "20" }, ["o", "0"]],
    ]);
    const result = simulateACAtFrequency(circuit, OMEGA_1_HZ);
    const currents = result.points[0].componentCurrents;
    assertPhasor(currents.T1, polar(11.09, 33.69), "I1");
    assertPhasor(nodeVoltage(result, "R2", 0), polar(110.9, 213.69), "Vo");
    // input impedance 9−j6 (= 4 − j6 + 20/n²), the exact lecture value
    assertPhasor(currents.T1, cdiv(cx(120), cx(9, -6)), "I1 exact");
    // S = Vs·I1* = 1330.8∠−33.69° (rms-style: here with the 120 treated as the phasor itself)
    const s = cmul(cx(120), cx(currents.T1.re, -currents.T1.im));
    assertPhasor(s, polar(1330.8, -33.69), "S");
  });

  test("예제 13.3: ω=4, 60∠30°, 10 Ω, L1=5, L2=4, M=2.5, C=1/16 → k=0.56, I1=3.905∠−19.4°, I2=3.254∠160.6°, w(1 s)=20.73 J", () => {
    const circuit = build([
      acSource("V1", 60, 30, ["a", "0"]),
      ["R1", "R", { value: "10" }, ["a", "p1"]],
      ["K1", "COUPLED_L", { L1: "5", L2: "4", coupling: "M", M: "2.5", dots: "same" }, ["p1", "0", "s1", "s2"]],
      ["C1", "C", { value: "0.0625" }, ["s1", "s2"]],
      ["R9", "R", { value: "1meg" }, ["s2", "0"]], // reference for the secondary loop
    ]);
    assert.ok(Math.abs(coupledInductorParameters(circuit.components.find((item) => item.id === "K1")).k - 0.559) < 1e-3);
    const currents = simulateACAtFrequency(circuit, 4 / (2 * Math.PI)).points[0].componentCurrents;
    assertPhasor(currents.K1, polar(3.905, -19.4), "I1");
    assertPhasor(currents[secondaryCurrentKey("K1")], polar(3.254, 160.6), "I2");
    const i1 = 3.905 * Math.cos(4 - (19.4 * Math.PI) / 180), i2 = 3.254 * Math.cos(4 + (160.6 * Math.PI) / 180);
    const energy = 0.5 * 5 * i1 * i1 + 0.5 * 4 * i2 * i2 + 2.5 * i1 * i2;
    assert.ok(Math.abs(energy - 20.73) < 0.05, `w = ${energy}`);
  });

  test("점 위치가 반대(opposite)이면 M 항의 부호만 바뀐다: 독립적인 2메시 풀이와 일치", () => {
    for (const [dots, sign] of [["same", 1], ["opposite", -1]]) {
      const circuit = build([
        acSource("V1", 10, 0, ["a", "0"]),
        ["R1", "R", { value: "3" }, ["a", "p1"]],
        ["K1", "COUPLED_L", { L1: "2", L2: "3", coupling: "k", k: "0.7", dots }, ["p1", "0", "s1", "0"]],
        ["R2", "R", { value: "5" }, ["s1", "0"]],
      ]);
      const omega = 2 * Math.PI * 0.4;
      const m = 0.7 * Math.sqrt(6);
      // i1, i2 into the dots: v1 = jωL1 i1 + s jωM i2, v2 = s jωM i1 + jωL2 i2 = −R2 i2 (load across the secondary), 10 = R1 i1 + v1
      const a11 = cx(3, omega * 2), a12 = cx(0, sign * omega * m), a21 = cx(0, sign * omega * m), a22 = cx(5, omega * 3);
      const det = csub(cmul(a11, a22), cmul(a12, a21));
      const i1 = cdiv(cmul(cx(10), a22), det);
      const i2 = cdiv(cmul(cx(-10), a21), det);
      const currents = simulateACAtFrequency(circuit, 0.4).points[0].componentCurrents;
      assertPhasor(currents.K1, i1, `${dots} I1`);
      assertPhasor(currents[secondaryCurrentKey("K1")], i2, `${dots} I2`);
    }
  });

  test("k=0은 두 인덕터와 같고(M=0), k=1(완전 결합)도 부하가 있으면 풀린다", () => {
    const separate = build([acSource("V1", 5, 0, ["a", "0"]), ["L1", "L", { value: "2" }, ["a", "0"]], ["L2", "L", { value: "3" }, ["b", "0"]], ["R1", "R", { value: "7" }, ["b", "0"]], ["R9", "R", { value: "7" }, ["b", "a"]]]);
    const coupled = build([acSource("V1", 5, 0, ["a", "0"]), ["K1", "COUPLED_L", { L1: "2", L2: "3", coupling: "k", k: "0" }, ["a", "0", "b", "0"]], ["R1", "R", { value: "7" }, ["b", "0"]], ["R9", "R", { value: "7" }, ["b", "a"]]]);
    const rs = simulateACAtFrequency(separate, 0.7).points[0].componentCurrents;
    const rc = simulateACAtFrequency(coupled, 0.7).points[0].componentCurrents;
    assertPhasor(rc.K1, rs.L1, "k=0 I1");
    assertPhasor(rc[secondaryCurrentKey("K1")], rs.L2, "k=0 I2");
    // k = 1: det of the winding block is jωL1·R (not singular with a resistive load)
    const perfect = build([acSource("V1", 4, 0, ["a", "0"]), ["K1", "COUPLED_L", { L1: "2", L2: "8", coupling: "k", k: "1" }, ["a", "0", "b", "0"]], ["R1", "R", { value: "6" }, ["b", "0"]]]);
    const omega = 2 * Math.PI * 0.5;
    const p = simulateACAtFrequency(perfect, 0.5).points[0].componentCurrents;
    const i2 = cdiv(cx(0, -omega * 4 * 4), cx(0, omega * 2 * 6)); // −jωM·V / (jωL1·R)
    assertPhasor(p[secondaryCurrentKey("K1")], i2, "k=1 I2");
  });

  test("AC 스윕에서도 두 부품이 주파수에 따라 올바르게 계산된다(이상 변압기는 주파수 무관)", () => {
    const circuit = build([
      acSource("V1", 1, 0, ["a", "0"]),
      ["T1", "XFMR_IDEAL", { n: "3", dots: "same" }, ["a", "0", "b", "0"]],
      ["R1", "R", { value: "9" }, ["b", "0"]],
    ]);
    const result = simulateAC(circuit, { startFrequency: "1", endFrequency: "1k", pointsPerDecade: 5 });
    for (let index = 0; index < result.points.length; index += 1) {
      assertPhasor(nodeVoltage(result, "R1", 0, index), cx(3), `n·V1 @${result.xValues[index]}`);
      assertPhasor(result.points[index].componentCurrents.T1, cx(3 * 3 / 9), `I1 @${result.xValues[index]}`);
    }
  });
});

// ---- DC ----------------------------------------------------------------------------------------------------------------------

describe("자기결합 DC", () => {
  test("결합 인덕터: DC에서 두 권선 모두 단락(기존 L과 같은 동작)이고 전류는 소스/저항으로 정해진다", () => {
    const coupled = build([
      ["V1", "V", { mode: "DC", dc: "10" }, ["a", "0"]],
      ["R1", "R", { value: "5" }, ["a", "p1"]],
      ["K1", "COUPLED_L", { L1: "1", L2: "2", coupling: "k", k: "0.5" }, ["p1", "0", "s1", "0"]],
      ["R2", "R", { value: "4" }, ["s1", "0"]],
    ]);
    const separate = build([
      ["V1", "V", { mode: "DC", dc: "10" }, ["a", "0"]],
      ["R1", "R", { value: "5" }, ["a", "p1"]],
      ["L1", "L", { value: "1" }, ["p1", "0"]],
      ["L2", "L", { value: "2" }, ["s1", "0"]],
      ["R2", "R", { value: "4" }, ["s1", "0"]],
    ]);
    const k = simulateDC(coupled).points[0];
    const l = simulateDC(separate).points[0];
    assert.ok(Math.abs(k.componentCurrents.K1 - 2) < 1e-12);
    assert.ok(Math.abs(k.componentCurrents[secondaryCurrentKey("K1")]) < 1e-12);
    assert.ok(Math.abs(k.componentCurrents.K1 - l.componentCurrents.L1) < 1e-12);
  });

  test("이상 변압기: DC에서도 v2 = n·v1, i1 = −n·i2가 성립한다", () => {
    const circuit = build([
      ["V1", "V", { mode: "DC", dc: "6" }, ["a", "0"]],
      ["T1", "XFMR_IDEAL", { n: "4", dots: "same" }, ["a", "0", "b", "0"]],
      ["R1", "R", { value: "8" }, ["b", "0"]],
    ]);
    const result = simulateDC(circuit);
    const point = result.points[0];
    assert.ok(Math.abs(nodeVoltage(result, "R1", 0) - 24) < 1e-9);
    const i1 = point.componentCurrents.T1, i2 = point.componentCurrents[secondaryCurrentKey("T1")];
    assert.ok(Math.abs(i1 + 4 * i2) < 1e-9, `i1 = ${i1}, i2 = ${i2}`);
    assert.ok(Math.abs(i1 - 12) < 1e-9); // 24 V / 8 Ω = 3 A out of 2a ... = i2 = −3 A, i1 = 12 A
    // power conservation v1·i1 + v2·i2 = 0
    assert.ok(Math.abs(6 * i1 + 24 * i2) < 1e-9);
  });

  test("이상 변압기 점이 반대쪽이면 v2 = −n·v1, i1 = +n·i2", () => {
    const circuit = build([
      ["V1", "V", { mode: "DC", dc: "6" }, ["a", "0"]],
      ["T1", "XFMR_IDEAL", { n: "4", dots: "opposite" }, ["a", "0", "b", "0"]],
      ["R1", "R", { value: "8" }, ["b", "0"]],
    ]);
    const result = simulateDC(circuit);
    const point = result.points[0];
    assert.ok(Math.abs(nodeVoltage(result, "R1", 0) + 24) < 1e-9);
    assert.ok(Math.abs(point.componentCurrents.T1 - 4 * point.componentCurrents[secondaryCurrentKey("T1")]) < 1e-9);
  });
});

// ---- transient -----------------------------------------------------------------------------------------------------------

describe("자기결합 시간응답", () => {
  const stored = (parameters, i1, i2) => 0.5 * parameters.L1 * i1 * i1 + 0.5 * parameters.L2 * i2 * i2 + parameters.mutual * i1 * i2;

  test("결합 코일: 저장 에너지 w=½L1i1²+½L2i2²±Mi1i2 ≥ 0 이고 소스 에너지 − 저항 손실 = w (k<1)", () => {
    for (const dots of ["same", "opposite"]) {
      const circuit = build([
        ["V1", "V", { mode: "DC", dc: "5" }, ["a", "0"]],
        ["R1", "R", { value: "2" }, ["a", "p1"]],
        ["K1", "COUPLED_L", { L1: "1", L2: "0.5", coupling: "k", k: "0.9", dots }, ["p1", "0", "s1", "0"]],
        ["R2", "R", { value: "3" }, ["s1", "0"]],
      ]);
      const parameters = coupledInductorParameters(circuit.components.find((item) => item.id === "K1"));
      const result = simulateTransient(circuit, { start: 0, end: 10, step: 0.002 });
      let sourceEnergy = 0, dissipated = 0;
      for (let index = 0; index < result.points.length; index += 1) {
        const point = result.points[index];
        const i1 = point.componentCurrents.K1, i2 = point.componentCurrents[secondaryCurrentKey("K1")];
        assert.ok(stored(parameters, i1, i2) >= -1e-12, `${dots} w < 0 at ${index}`);
        if (index > 0) {
          const dt = result.xValues[index] - result.xValues[index - 1];
          sourceEnergy += 5 * i1 * dt; // 5 V source drives the primary branch current i1 (backward Euler, the rectangle is the step's own value)
          dissipated += (2 * i1 * i1 + 3 * i2 * i2) * dt;
        }
      }
      const last = result.points.at(-1);
      const finalEnergy = stored(parameters, last.componentCurrents.K1, last.componentCurrents[secondaryCurrentKey("K1")]);
      assert.ok(finalEnergy > 0);
      assert.ok(Math.abs(sourceEnergy - dissipated - finalEnergy) / sourceEnergy < 0.01, `${dots}: ${sourceEnergy} - ${dissipated} vs ${finalEnergy}`);
      // DC steady state: both windings are shorts, the primary carries 5/2 A, the secondary none
      assert.ok(Math.abs(last.componentCurrents.K1 - 2.5) < 1e-3);
      assert.ok(Math.abs(last.componentCurrents[secondaryCurrentKey("K1")]) < 1e-3);
    }
  });

  test("k=0이면 두 코일이 독립이고 시간응답이 단일 RL과 같다", () => {
    const coupled = build([["V1", "V", { mode: "DC", dc: "5" }, ["a", "0"]], ["R1", "R", { value: "2" }, ["a", "p1"]], ["K1", "COUPLED_L", { L1: "1", L2: "1", coupling: "k", k: "0" }, ["p1", "0", "s1", "0"]], ["R2", "R", { value: "3" }, ["s1", "0"]]]);
    const single = build([["V1", "V", { mode: "DC", dc: "5" }, ["a", "0"]], ["R1", "R", { value: "2" }, ["a", "p1"]], ["L1", "L", { value: "1" }, ["p1", "0"]]]);
    const a = simulateTransient(coupled, { start: 0, end: 1, step: 0.01 });
    const b = simulateTransient(single, { start: 0, end: 1, step: 0.01 });
    for (let index = 0; index < a.points.length; index += 1) {
      assert.ok(Math.abs(a.points[index].componentCurrents.K1 - b.points[index].componentCurrents.L1) < 1e-12);
      assert.ok(Math.abs(a.points[index].componentCurrents[secondaryCurrentKey("K1")]) < 1e-12);
    }
  });

  test("초기 전류 ic1·ic2가 첫 표본과 이후 전개에 쓰인다", () => {
    const circuit = build([
      ["K1", "COUPLED_L", { L1: "1", L2: "1", coupling: "k", k: "0.5", ic1: "1", ic2: "-0.5" }, ["a", "0", "b", "0"]],
      ["R1", "R", { value: "1" }, ["a", "0"]],
      ["R2", "R", { value: "1" }, ["b", "0"]],
    ]);
    const result = simulateTransient(circuit, { start: 0, end: 0.01, step: 0.001 });
    assert.equal(result.points[0].componentCurrents.K1, 1);
    assert.equal(result.points[0].componentCurrents[secondaryCurrentKey("K1")], -0.5);
    // currents decay (no source): magnitude strictly smaller afterwards
    assert.ok(Math.abs(result.points.at(-1).componentCurrents.K1) < 1);
  });

  test("이상 변압기: 매 시각 v1·i1 + v2·i2 = 0(전력 보존)이고 v2 = n·v1", () => {
    const circuit = build([
      ["V1", "V", { mode: "SIN", offset: "0", amplitude: "10", frequency: "50", phase: "0" }, ["a", "0"]],
      ["R1", "R", { value: "2" }, ["a", "p1"]],
      ["T1", "XFMR_IDEAL", { n: "0.5", dots: "same" }, ["p1", "0", "s1", "0"]],
      ["R2", "R", { value: "6" }, ["s1", "0"]],
      ["C2", "C", { value: "100u", ic: "0" }, ["s1", "0"]],
    ]);
    const result = simulateTransient(circuit, { start: 0, end: 0.04, step: 0.0001 });
    for (let index = 0; index < result.points.length; index += 1) {
      const point = result.points[index];
      const v1 = point.nodeVoltages[result.topology.nodeIdByPin["T1:0"]], v2 = point.nodeVoltages[result.topology.nodeIdByPin["T1:2"]];
      const i1 = point.componentCurrents.T1, i2 = point.componentCurrents[secondaryCurrentKey("T1")];
      assert.ok(Math.abs(v1 * i1 + v2 * i2) < 1e-9 * (1 + Math.abs(v1 * i1)), `p at ${index}`);
      assert.ok(Math.abs(v2 - 0.5 * v1) < 1e-9 * (1 + Math.abs(v1)));
      assert.ok(Math.abs(i1 + 0.5 * i2) < 1e-9 * (1 + Math.abs(i1)));
    }
  });
});

// ---- AC power conservation -----------------------------------------------------------------------------------------------

test("이상 변압기 AC: 복소전력 S1 = S2 (V1·I1* = −V2·I2*, 즉 순 복소전력 0)이고 Zin = ZL/n²", () => {
  const circuit = build([
    acSource("V1", 8, 20, ["a", "0"]),
    ["R1", "R", { value: "1" }, ["a", "p1"]],
    ["T1", "XFMR_IDEAL", { n: "3", dots: "same" }, ["p1", "0", "s1", "0"]],
    ["R2", "R", { value: "5" }, ["s1", "x"]],
    ["L2", "L", { value: "0.02" }, ["x", "0"]],
  ]);
  const result = simulateACAtFrequency(circuit, 100);
  const point = result.points[0];
  const v1 = nodeVoltage(result, "T1", 0), v2 = nodeVoltage(result, "T1", 2);
  const i1 = point.componentCurrents.T1, i2 = point.componentCurrents[secondaryCurrentKey("T1")];
  const s1 = cmul(v1, cx(i1.re, -i1.im)), s2 = cmul(v2, cx(i2.re, -i2.im));
  assert.ok(Math.hypot(s1.re + s2.re, s1.im + s2.im) < 1e-9 * (1 + mag(s1)), "S1 + S2 = 0 (both currents into the dots)");
  const omega = 200 * Math.PI;
  const zl = cx(5, omega * 0.02);
  const zin = cdiv(v1, i1);
  assertPhasor(zin, cx(zl.re / 9, zl.im / 9), "Zin = ZL/n²");
});

// ---- validation ------------------------------------------------------------------------------------------------------------

describe("자기결합 검증", () => {
  const coil = (props) => ({ id: "K1", type: "COUPLED_L", props: { ref: "K1", ...props } });

  test("k는 0 이상 1 이하, L1·L2는 양수, M은 √(L1·L2) 이하", () => {
    assert.equal(coupledInductorParameters(coil({ L1: "4", L2: "9", k: "0.5" })).M, 3);
    assert.equal(coupledInductorParameters(coil({ L1: "4", L2: "9", coupling: "M", M: "3" })).k, 0.5);
    assert.equal(coupledInductorParameters(coil({ L1: "4", L2: "9", k: "1" })).M, 6);
    assert.equal(coupledInductorParameters(coil({ L1: "4", L2: "9", k: "0" })).M, 0);
    for (const props of [{ k: "1.0001" }, { k: "-0.1" }, { k: "abc" }, { L1: "0" }, { L2: "-1" }, { coupling: "M", M: "7" }, { coupling: "M", M: "-1" }, { dots: "up" }]) {
      assert.throws(() => coupledInductorParameters(coil({ L1: "4", L2: "9", k: "0.5", ...props })), (error) => error.name === "CircuitError", JSON.stringify(props));
    }
    assert.equal(coupledInductorParameters(coil({ L1: "4", L2: "9", dots: "opposite", k: "0.5" })).mutual, -3);
  });

  test("이상 변압기 n은 양수, 점 반대면 ratio가 음수", () => {
    const t = (props) => ({ id: "T1", type: "XFMR_IDEAL", props: { ref: "T1", ...props } });
    assert.equal(idealTransformerParameters(t({ n: "2" })).ratio, 2);
    assert.equal(idealTransformerParameters(t({ n: "2", dots: "opposite" })).ratio, -2);
    for (const n of ["0", "-2", "x"]) assert.throws(() => idealTransformerParameters(t({ n })), (error) => error.name === "CircuitError");
  });

  test("해석 시 잘못된 k는 INVALID_VALUE로 거부(임의 보정 없음)", () => {
    const circuit = build([["V1", "V", { mode: "DC", dc: "1" }, ["a", "0"]], ["K1", "COUPLED_L", { L1: "1", L2: "1", k: "1.5" }, ["a", "0", "b", "0"]], ["R1", "R", { value: "1" }, ["b", "0"]]]);
    assert.throws(() => simulateDC(circuit), (error) => error.code === "INVALID_VALUE");
  });

  test("2차를 접지하지 않으면 FLOATING_NODE이고 힌트가 절연 구조를 설명한다", () => {
    const circuit = build([["V1", "V", { mode: "DC", dc: "1" }, ["a", "0"]], ["T1", "XFMR_IDEAL", { n: "2" }, ["a", "0", "b", "c"]], ["R1", "R", { value: "1" }, ["b", "c"]]]);
    assert.throws(() => simulateDC(circuit), (error) => error.code === "FLOATING_NODE" && /절연/.test(error.hint));
  });

  test("DC에서 전압원을 코일에 직접 걸면 이상 제약 모순으로 진단된다", () => {
    const circuit = build([["V1", "V", { mode: "DC", dc: "5" }, ["a", "0"]], ["K1", "COUPLED_L", { L1: "1", L2: "1", k: "0.5" }, ["a", "0", "b", "0"]], ["R1", "R", { value: "1" }, ["b", "0"]]]);
    assert.throws(() => simulateDC(circuit), (error) => error.code === "IDEAL_CONSTRAINT_CONFLICT");
  });
});

// ---- serialization ---------------------------------------------------------------------------------------------------------

describe("자기결합 저장 형식", () => {
  const withCoil = () => build([acSource("V1", 1, 0, ["a", "0"]), ["K1", "COUPLED_L", { L1: "1", L2: "2", k: "0.5" }, ["a", "0", "b", "0"]], ["R1", "R", { value: "1" }, ["b", "0"]]]);

  test("새 부품이 있으면 version 4로 저장되고 그대로 읽힌다", () => {
    const text = serializeCircuit(withCoil());
    assert.equal(JSON.parse(text).version, 4);
    const back = deserializeCircuit(text);
    assert.equal(back.version, 4);
    assert.equal(back.components.find((item) => item.id === "K1").props.k, "0.5");
  });

  test("version 3 파일에 자기결합 부품이 있으면 거부하고, 이전 버전 파일은 계속 읽힌다", () => {
    const parsed = JSON.parse(serializeCircuit(withCoil()));
    assert.throws(() => deserializeCircuit(JSON.stringify({ ...parsed, version: 3 })), (error) => error.code === "INVALID_FILE");
    const plain = build([["V1", "V", { mode: "DC", dc: "1" }, ["a", "0"]], ["R1", "R", { value: "1" }, ["a", "0"]]]);
    assert.equal(deserializeCircuit(serializeCircuit(plain)).version, 1);
    assert.equal(deserializeCircuit(JSON.stringify({ ...JSON.parse(serializeCircuit(plain)), version: 1 })).version, 1);
  });
});
