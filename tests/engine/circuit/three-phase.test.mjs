import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  componentDefaults, deserializeCircuit, phaseCurrentKey, pinCount, serializeCircuit, simulateACAtFrequency, simulateDC, simulateTransient, threePhaseParameters,
} from "../../../src/circuit-engine.js";

// ---- helpers ---------------------------------------------------------------------------------------------------------------

const mag = (z) => Math.hypot(z.re, z.im);
const phaseDeg = (z) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const cx = (re, im = 0) => ({ re, im });
const polar = (m, deg) => cx(m * Math.cos((deg * Math.PI) / 180), m * Math.sin((deg * Math.PI) / 180));
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/** assert |actual| within 0.1 % and phase within 0.1 degree of the expected phasor */
function assertPhasor(actual, expected, label) {
  assert.ok(relative(mag(actual), mag(expected)) <= 1e-3, `${label}: |z| ${mag(actual)} vs ${mag(expected)}`);
  assert.ok(angleDiff(phaseDeg(actual), phaseDeg(expected)) <= 0.1, `${label}: ∠ ${phaseDeg(actual)} vs ${phaseDeg(expected)}`);
}

/** specs: [id, type, props, nets[]]; net "0" is the ground. Pins of THREE_PHASE are [a, b, c, n]. */
function build(specs) {
  const items = [...specs.map(([id, type, props, nets], index) => ({ id, type, x: 100 + index * 80, y: 100, rotation: 0, props: { ...componentDefaults(type, index + 1), ref: id, ...props }, nets })),
    { id: "G1", type: "GND", x: 0, y: 0, rotation: 0, props: { ref: "G1" }, nets: ["0"] }];
  const groups = new Map();
  for (const item of items) item.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: item.id, pin }); });
  const wires = [];
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  const hasThree = items.some((item) => item.type === "THREE_PHASE");
  return { version: hasThree ? 5 : 1, geometryVersion: 2, components: items.map(({ nets, ...item }) => item), wires, junctions: [] };
}

const nodeVoltage = (result, id, pin, index = 0) => result.points[index].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];
const wyeLoad = (value = "10") => [
  ["RA", "R", { value }, ["a", "0"]], ["RB", "R", { value }, ["b", "0"]], ["RC", "R", { value }, ["c", "0"]],
];
const source = (props = {}) => ["VP", "THREE_PHASE", props, ["a", "b", "c", "0"]];

// ---- part definition ---------------------------------------------------------------------------------------------------------

describe("3상 전원 부품 정의", () => {
  test("핀 4개, 기본값, 매개변수 해석", () => {
    assert.equal(pinCount("THREE_PHASE"), 4);
    const defaults = componentDefaults("THREE_PHASE", 1);
    assert.equal(defaults.sequence, "abc");
    const parameters = threePhaseParameters({ id: "VP", props: { amplitude: "100", phase: "10", sequence: "abc", frequency: "50" } });
    assert.deepEqual(parameters.shifts, [10, -110, 130]);
    assert.equal(parameters.frequency, 50);
    const reverse = threePhaseParameters({ id: "VP", props: { amplitude: "100", phase: "10", sequence: "acb" } });
    assert.deepEqual(reverse.shifts, [10, 130, -110]);
  });

  test("잘못된 값은 오류로 거부된다", () => {
    for (const props of [{ sequence: "bca" }, { amplitude: "-1" }, { frequency: "0" }, { amplitude: "abc" }]) {
      assert.throws(() => simulateDC(build([source(props), ...wyeLoad()])), (error) => error.name === "CircuitError" || error.code !== undefined, JSON.stringify(props));
    }
  });
});

// ---- AC ----------------------------------------------------------------------------------------------------------------------

describe("3상 전원 AC 스탬프", () => {
  test("abc 상순서: 상전압 크기·위상, 선간전압 √3·30°, 상전류 합 0", () => {
    const circuit = build([source({ amplitude: "100", phase: "10", sequence: "abc" }), ...wyeLoad()]);
    const result = simulateACAtFrequency(circuit, 60);
    assertPhasor(nodeVoltage(result, "VP", 0), polar(100, 10), "Van");
    assertPhasor(nodeVoltage(result, "VP", 1), polar(100, -110), "Vbn");
    assertPhasor(nodeVoltage(result, "VP", 2), polar(100, 130), "Vcn");
    assert.ok(mag(nodeVoltage(result, "VP", 3)) < 1e-12, "Vn = 0");
    const a = nodeVoltage(result, "VP", 0), b = nodeVoltage(result, "VP", 1);
    assertPhasor(cx(a.re - b.re, a.im - b.im), polar(100 * Math.sqrt(3), 40), "Vab");
    const currents = result.points[0].componentCurrents;
    const sum = ["VP", "VP#2", "VP#3"].reduce((total, key) => cx(total.re + currents[key].re, total.im + currents[key].im), cx(0));
    assert.ok(mag(sum) < 1e-9, `|Ia+Ib+Ic| = ${mag(sum)}`);
    // the branch current enters pin a and leaves through the source toward n: the source feeds the load, so I(VP) = −Van/R
    assertPhasor(currents.VP, polar(10, 10 + 180), "I(VP.a) = −Van/R");
    assertPhasor(currents[phaseCurrentKey("VP", 3)], polar(10, 130 + 180), "I(VP.c)");
  });

  test("acb 상순서: b가 a보다 120° 앞선다", () => {
    const result = simulateACAtFrequency(build([source({ amplitude: "100", phase: "0", sequence: "acb" }), ...wyeLoad()]), 60);
    assertPhasor(nodeVoltage(result, "VP", 1), polar(100, 120), "Vbn");
    assertPhasor(nodeVoltage(result, "VP", 2), polar(100, -120), "Vcn");
  });

  test("교재 예제 12.2: Y-Y, 선로 5−j2 Ω + 부하 10+j8 Ω → Ia=6.81∠−21.8° A rms", () => {
    const frequency = 60, omega = 2 * Math.PI * frequency;
    const circuit = build([
      source({ amplitude: String(110 * Math.SQRT2), phase: "0", frequency: String(frequency) }),
      ...["a", "b", "c"].flatMap((phase) => [
        [`RL${phase}`, "R", { value: "5" }, [phase, `${phase}1`]],
        [`CL${phase}`, "C", { value: String(1 / (omega * 2)) }, [`${phase}1`, `${phase}2`]],
        [`RZ${phase}`, "R", { value: "10" }, [`${phase}2`, `${phase}3`]],
        [`LZ${phase}`, "L", { value: String(8 / omega) }, [`${phase}3`, "n"]],
      ]),
      ["RN", "R", { value: "1e-9" }, ["n", "0"]],
    ]);
    const result = simulateACAtFrequency(circuit, frequency);
    const currents = result.points[0].componentCurrents;
    const rms = (z) => cx(z.re / Math.SQRT2, z.im / Math.SQRT2);
    assertPhasor(rms(currents.RLa), polar(6.81, -21.8), "Ia");
    assertPhasor(rms(currents.RLb), polar(6.81, -141.8), "Ib");
    assertPhasor(rms(currents.RLc), polar(6.81, 98.2), "Ic");
  });

  test("교재 예제 12.3: Y 전원 Van=100∠10° + Δ 부하 8+j4 Ω → IAB=19.36∠13.43°, Ia=33.53∠−16.57° A rms", () => {
    const frequency = 60, omega = 2 * Math.PI * frequency;
    const delta = (id, from, to) => [[`R${id}`, "R", { value: "8" }, [from, `m${id}`]], [`L${id}`, "L", { value: String(4 / omega) }, [`m${id}`, to]]];
    const circuit = build([
      source({ amplitude: String(100 * Math.SQRT2), phase: "10", frequency: String(frequency) }),
      ["Sa", "CURRENT_SENSOR", {}, ["a", "A"]], ["Sb", "CURRENT_SENSOR", {}, ["b", "B"]], ["Sc", "CURRENT_SENSOR", {}, ["c", "C"]],
      ...delta("AB", "A", "B"), ...delta("BC", "B", "C"), ...delta("CA", "C", "A"),
    ]);
    circuit.version = 5;
    const result = simulateACAtFrequency(circuit, frequency);
    const currents = result.points[0].componentCurrents;
    const rms = (z) => cx(z.re / Math.SQRT2, z.im / Math.SQRT2);
    assertPhasor(rms(currents.RAB), polar(19.36, 13.43), "IAB");
    assertPhasor(rms(currents.Sa), polar(33.53, -16.57), "Ia");
    assertPhasor(rms(currents.Sb), polar(33.53, -136.57), "Ib");
  });
});

// ---- DC / transient ------------------------------------------------------------------------------------------------------------

describe("3상 전원 DC·시간응답", () => {
  test("DC는 세 상 모두 0 V", () => {
    const result = simulateDC(build([source({ amplitude: "100" }), ...wyeLoad()]));
    for (const pin of [0, 1, 2, 3]) assert.ok(Math.abs(nodeVoltage(result, "VP", pin)) < 1e-12);
  });

  test("시간응답: 각 상이 amplitude·cos(2πft + 위상 + 시프트)", () => {
    const frequency = 50, amplitude = 100, phase = 25;
    const circuit = build([source({ amplitude: String(amplitude), frequency: String(frequency), phase: String(phase), sequence: "abc" }), ...wyeLoad()]);
    const result = simulateTransient(circuit, { start: "0", end: "0.04", step: "0.0005" });
    result.xValues.forEach((time, index) => {
      const wave = (shift) => amplitude * Math.cos(2 * Math.PI * frequency * time + ((phase + shift) * Math.PI) / 180);
      assert.ok(Math.abs(nodeVoltage(result, "VP", 0, index) - wave(0)) < 1e-9, `a @${time}`);
      assert.ok(Math.abs(nodeVoltage(result, "VP", 1, index) - wave(-120)) < 1e-9, `b @${time}`);
      assert.ok(Math.abs(nodeVoltage(result, "VP", 2, index) - wave(120)) < 1e-9, `c @${time}`);
    });
  });

  test("커패시터·인덕터 부하가 있어도 시간응답이 풀린다", () => {
    const circuit = build([
      source({ amplitude: "100", frequency: "60" }),
      ["RA", "R", { value: "10" }, ["a", "x"]], ["LA", "L", { value: "10m" }, ["x", "0"]],
      ["RB", "R", { value: "10" }, ["b", "y"]], ["CB", "C", { value: "100u" }, ["y", "0"]],
      ["RC", "R", { value: "10" }, ["c", "0"]],
    ]);
    const result = simulateTransient(circuit, { start: "0", end: "0.02", step: "0.0001" });
    assert.ok(result.points.length > 100);
    assert.ok(result.points.every((point) => Object.values(point.nodeVoltages).every(Number.isFinite)));
  });
});

// ---- save / open -------------------------------------------------------------------------------------------------------------

describe("3상 전원 저장·열기", () => {
  test("version 5로 저장하고 같은 회로로 열린다; 3상이 없으면 옛 version 유지", () => {
    const circuit = build([source({ amplitude: "100", sequence: "acb", phase: "-30", frequency: "50" }), ...wyeLoad()]);
    const text = serializeCircuit(circuit);
    assert.equal(JSON.parse(text).version, 5);
    const opened = deserializeCircuit(text);
    assert.deepEqual(opened.components.find((item) => item.id === "VP").props, circuit.components.find((item) => item.id === "VP").props);
    assert.equal(opened.version, 5);
    const plain = build([wyeLoad()[0]]);
    assert.equal(JSON.parse(serializeCircuit(plain)).version, 1);
  });

  test("version 5가 아닌데 3상 전원이 있는 파일은 거부된다", () => {
    const circuit = build([source(), ...wyeLoad()]);
    const text = JSON.stringify({ ...JSON.parse(serializeCircuit(circuit)), version: 4 });
    assert.throws(() => deserializeCircuit(text), /version 5/);
  });
});
