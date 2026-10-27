import test from "node:test";
import assert from "node:assert/strict";
import { componentDefaults, phaseCurrentKey, pinCount, simulateACAtFrequency, simulateDC, simulateTransient } from "../../src/circuit-engine.js";
import { cloneExample, examples } from "../../src/examples.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import {
  clampWinding, currentArrowGeometry, currentDirectionDescriptor, currentProbeLabel, currentWindingAt, probeCurrentKey, sanitizeCurrentReferences, windingCount,
} from "../../src/current-direction.js";
import { analyzeWireNets, pinCurrentsInto, wireCurrents } from "../../src/wire-current-model.js";
import { componentReadout } from "../../src/node-readout-model.js";
import { scaleComplex } from "../../src/ac-basis.js";
import { classifyCircuitConnections } from "../../src/circuit-status.js";
import { cloneComponentSet, componentIdPrefix } from "../../src/circuit-edit.js";
import { threePhaseSymbolMarkup } from "../../src/canvas-renderer.js";
import { localPin, pinPosition } from "../../src/circuit-geometry.js";
import { sourceInlineDescriptor } from "../../src/ui-model.js";
import { suggestAnalysis } from "../../src/analysis-policy.js";

const mag = (z) => Math.hypot(z.re, z.im);
const deg = (z) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const near = (actual, expected, relativeTolerance, label) => assert.ok(Math.abs(actual - expected) <= relativeTolerance * Math.abs(expected), `${label}: ${actual} vs ${expected}`);
const phasorAt = (example) => simulateACAtFrequency(example.circuit, example.settings.phasorFrequency);
/** rms magnitude (relative 0.1 %) and phase (0.1°) of a solver current */
function assertRms(current, magnitude, degrees, label) {
  near(mag(scaleComplex(current, "rms")), magnitude, 1e-3, `${label} |I| rms`);
  assert.ok(Math.abs(((deg(current) - degrees + 540) % 360) - 180) < 0.1, `${label} ∠ ${deg(current)} vs ${degrees}`);
}

test("두 3상 예제가 목록에 있고 교재 값이 rms 표시로 나온다", () => {
  assert.ok(examples.some((item) => item.id === "three-phase-yy" && item.name === "3상 Y–Y (예제 12.2)"));
  assert.ok(examples.some((item) => item.id === "three-phase-y-delta" && item.name === "3상 Y–Δ (예제 12.3)"));

  const yy = cloneExample("three-phase-yy");
  assert.equal(yy.acBasis, "rms");
  near(Number(yy.circuit.components.find((item) => item.id === "VP1").props.amplitude), 110 * Math.SQRT2, 1e-12, "110 V rms as peak");
  const a = phasorAt(yy).points[0].componentCurrents;
  assertRms(a.RLa, 6.81, -21.8, "Ia");
  assertRms(a.RLb, 6.81, -141.8, "Ib");
  assertRms(a.RLc, 6.81, 98.2, "Ic");
  // balanced: the three phase currents sum to zero and nothing flows back through the neutral
  const sum = ["RLa", "RLb", "RLc"].reduce((total, id) => ({ re: total.re + a[id].re, im: total.im + a[id].im }), { re: 0, im: 0 });
  assert.ok(mag(sum) < 1e-9 * mag(a.RLa));
  assert.ok(/rms/.test(yy.description) && /12\.2/.test(yy.description) && /6\.81/.test(yy.description));

  const yd = cloneExample("three-phase-y-delta");
  assert.equal(yd.acBasis, "rms");
  near(Number(yd.circuit.components.find((item) => item.id === "VP1").props.amplitude), 100 * Math.SQRT2, 1e-12, "100 V rms as peak");
  assert.equal(yd.circuit.components.find((item) => item.id === "VP1").props.phase, "10");
  const b = phasorAt(yd).points[0].componentCurrents;
  assertRms(b.RAB, 19.36, 13.43, "I_AB");
  assertRms(b.Sa, 33.53, -16.57, "Ia");
  assertRms(b.Sb, 33.53, -136.57, "Ib");
  assertRms(b.Sc, 33.53, 103.43, "Ic");
  assert.ok(/rms/.test(yd.description) && /12\.3/.test(yd.description) && /19\.36/.test(yd.description) && /33\.53/.test(yd.description));
});

test("3상 예제의 모든 핀이 GND 기준 경로로 분류되고 DC·시간응답도 오류 없이 풀린다", () => {
  for (const id of ["three-phase-yy", "three-phase-y-delta"]) {
    const example = cloneExample(id);
    const status = classifyCircuitConnections(example.circuit, "ac", { frequency: 0.159 });
    assert.deepEqual(Object.values(status.byComponent).map((item) => item.status).filter((value) => value !== "referenced"), [], id);
    assert.ok(simulateDC(example.circuit).points.length === 1);
    const plan = suggestAnalysis(example.circuit, { analysis: "ac" }, "transient");
    assert.equal(plan.settings.analysis, "transient");
    assert.ok(Number(plan.settings.end) > 10, `${id}: 3상 주파수로 시간 범위가 잡힌다 (${plan.settings.end})`);
    const result = simulateTransient(example.circuit, { start: "0", end: "6.3", step: "0.05" });
    assert.ok(result.points.length > 100 && result.points.every((point) => Object.values(point.nodeVoltages).every(Number.isFinite)), id);
  }
});

test("부품 정의: 핀 4개, 오른쪽 a·b·c / 왼쪽 n, 회전하면 같이 돈다, ID 접두사 VP", () => {
  assert.equal(pinCount("THREE_PHASE"), 4);
  assert.deepEqual([0, 1, 2, 3].map((pin) => localPin("THREE_PHASE", pin)), [{ x: 40, y: -40 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: -40, y: 0 }]);
  const part = { id: "VP1", type: "THREE_PHASE", x: 200, y: 200, rotation: 90 };
  const a = pinPosition(part, 0), n = pinPosition(part, 3);
  assert.ok(Math.abs(a.x - 240) < 1e-9 && Math.abs(a.y - 240) < 1e-9, `a ${JSON.stringify(a)}`);
  assert.ok(Math.abs(n.x - 200) < 1e-9 && Math.abs(n.y - 160) < 1e-9, `n ${JSON.stringify(n)}`);
  assert.equal(componentIdPrefix("THREE_PHASE"), "VP");
  assert.equal(componentDefaults("THREE_PHASE", 2).ref, "VP2");
  const original = cloneExample("three-phase-yy").circuit;
  const copy = cloneComponentSet(original, ["VP1"]);
  const copied = copy.components[0];
  assert.equal(copied.type, "THREE_PHASE");
  assert.equal(copied.props.sequence, "abc");
  assert.notEqual(copied.id, "VP1", "복제는 새 ID를 받는다");
});

test("기호 마크업은 a·b·c·n 이름과 3φ를 그리고, 캔버스 값 라벨은 상전압 peak를 따른다", () => {
  const markup = threePhaseSymbolMarkup();
  for (const text of [">a<", ">b<", ">c<", ">n<", "3φ"]) assert.ok(markup.includes(text), text);
  const descriptor = sourceInlineDescriptor({ type: "THREE_PHASE", props: { amplitude: "155.5" } }, "ac");
  assert.deepEqual([descriptor.prop, descriptor.unit, descriptor.value], ["amplitude", "Vpk", "155.5"]);
});

test("전류 프로브·기준 뒤집기: 상 a·b·c = 권선 1·2·3", () => {
  const part = { id: "VP1", type: "THREE_PHASE", x: 200, y: 100, rotation: 0, props: { ref: "VP1" } };
  assert.equal(windingCount(part), 3);
  assert.equal(clampWinding(part, 3), 3);
  assert.equal(clampWinding(part, 4), 1);
  assert.equal(clampWinding({ type: "R" }, 2), 1);
  assert.equal(probeCurrentKey({ componentId: "VP1" }), "VP1");
  assert.equal(probeCurrentKey({ componentId: "VP1", winding: 2 }), "VP1#2");
  assert.equal(probeCurrentKey({ componentId: "VP1", winding: 3 }), phaseCurrentKey("VP1", 3));
  assert.deepEqual([1, 2, 3].map((winding) => currentProbeLabel(part, 2, winding)), ["I(VP1.a)", "I(VP1.b)", "I(VP1.c)"]);
  assert.equal(currentProbeLabel({ ...part, flipCurrent3: true }, 2, 3), "I(VP1.c, 기준 n→c)");
  // 누른 위치로 상을 고른다
  assert.deepEqual([[240, 60], [240, 100], [240, 140]].map(([x, y]) => currentWindingAt(part, { x, y })), [1, 2, 3]);
  assert.equal(currentWindingAt({ ...part, rotation: 180 }, { x: 160, y: 140 }), 1, "180° 회전하면 위아래가 바뀐다");
  const descriptors = [1, 2, 3].map((winding) => currentDirectionDescriptor(part, 2, winding));
  assert.deepEqual(descriptors.map((item) => [item.fromPin, item.toPin, item.label]), [[0, 3, "a→n"], [1, 3, "b→n"], [2, 3, "c→n"]]);
  for (const descriptor of descriptors) {
    const arrow = currentArrowGeometry(descriptor);
    assert.ok(arrow.start.x > arrow.end.x && arrow.start.x > 20, "화살표는 핀 선(오른쪽)에서 몸체 쪽으로 향한다");
  }
  // 저장 필드: flipCurrent3 은 3상 전원에서만 살아남는다
  const parts = [{ id: "A", type: "THREE_PHASE", flipCurrent2: true, flipCurrent3: true }, { id: "B", type: "R", flipCurrent3: true, flipCurrent: true }, { id: "C", type: "COUPLED_L", flipCurrent3: true, flipCurrent2: true }];
  sanitizeCurrentReferences(parts);
  assert.deepEqual(parts, [{ id: "A", type: "THREE_PHASE", flipCurrent2: true, flipCurrent3: true }, { id: "B", type: "R", flipCurrent: true }, { id: "C", type: "COUPLED_L", flipCurrent2: true }]);
});

test("프로젝트 저장·복원: version 5, 3상 전류 프로브 a·b·c와 flipCurrent3가 보존된다, 잘못된 참조는 거부", () => {
  const example = cloneExample("three-phase-yy");
  example.circuit.components.find((item) => item.id === "VP1").flipCurrent3 = true;
  const probes = [
    { key: "I:VP1", kind: "current", componentId: "VP1", label: "I(VP1.a)", color: "#80bfff" },
    { key: "I:VP1:2", kind: "current", componentId: "VP1", winding: 2, label: "I(VP1.b)", color: "#f5bc79" },
    { key: "I:VP1:3", kind: "current", componentId: "VP1", winding: 3, label: "I(VP1.c, 기준 n→c)", color: "#8ee08e" },
  ];
  const text = serializeProject({ title: example.name, subtitle: example.description, circuit: example.circuit, settings: example.settings, probes });
  const payload = JSON.parse(text);
  assert.equal(payload.version, 5);
  assert.equal(payload.circuit.version, 5);
  const back = deserializeProject(text);
  assert.deepEqual(back.probes, probes);
  const part = back.circuit.components.find((item) => item.id === "VP1");
  assert.deepEqual(part.props, example.circuit.components.find((item) => item.id === "VP1").props);
  assert.equal(part.flipCurrent3, true);
  // winding 3 exists only on the three-phase source
  const bad = JSON.parse(text);
  bad.probes[2].componentId = "RLa";
  assert.throws(() => deserializeProject(JSON.stringify(bad)), (error) => error.code === "INVALID_FILE");
  // 3상 부품이 없는 프로젝트는 옛 version 그대로
  const plain = serializeProject({ title: "t", subtitle: "", circuit: cloneExample("divider").circuit, settings: {}, probes: [] });
  assert.equal(JSON.parse(plain).version, 1);
  // 3상 부품이 있는 회로를 version 4로 선언한 파일은 거부
  const wrongVersion = JSON.parse(text);
  wrongVersion.version = 4; wrongVersion.circuit.version = 4;
  assert.throws(() => deserializeProject(JSON.stringify(wrongVersion)), (error) => error.code === "INVALID_FILE");
});

test("전류 흐름: 3상 전원의 핀 전류는 a·b·c로 들어가 n으로 합쳐 나온다, 배선 전류가 KCL로 정해진다", () => {
  assert.deepEqual(pinCurrentsInto({ type: "THREE_PHASE" }, 1, 2, 3), [1, 2, 3, -6]);
  const example = cloneExample("three-phase-yy");
  const result = simulateTransient(example.circuit, { start: "0", end: "6.3", step: "0.1" });
  const nets = analyzeWireNets(example.circuit);
  const point = result.points[10];
  const flow = wireCurrents({ circuit: example.circuit, componentCurrents: point.componentCurrents, nets });
  const states = Object.values(flow.byWire).map((item) => item.state);
  assert.ok(!states.includes("unbalanced") && !states.includes("unknown"), states.join());
  // the wire from pin a to the line resistor carries exactly the line current (reference a → load)
  const wireA = example.circuit.wires.find((wire) => wire.id === "W1");
  near(Math.abs(flow.byWire.W1.current), Math.abs(point.componentCurrents.RLa), 1e-9, "wire a");
  assert.ok(flow.byWire[wireA.id].state === "flow");
});

test("호버 판독: a·b·c 전류와 상전압, DC·시간응답 합 전력", () => {
  const example = cloneExample("three-phase-yy");
  const ac = componentReadout({ circuit: example.circuit, result: { analysis: "ac", ...phasorAt(example), xValues: [example.settings.phasorFrequency] }, componentId: "VP1", index: 0, acBasis: "rms" });
  assert.equal(ac.ok, true);
  assert.equal(ac.kind, "component");
  assert.ok(ac.current && ac.current2 && ac.current3 && ac.voltage && ac.voltage2 && ac.voltage3);
  near(ac.voltage.value, 110, 1e-3, "|Van| rms");
  near(ac.current.value, 6.81, 1e-3, "|Ia| rms");
  assert.equal(ac.lines.filter((line) => /상 전류/.test(line)).length, 3);

  const transient = simulateTransient(example.circuit, { start: "0", end: "6.3", step: "0.1" });
  const sample = componentReadout({ circuit: example.circuit, result: transient, componentId: "VP1", index: 10 });
  assert.equal(sample.ok, true);
  assert.ok(sample.power && sample.power.value < 0 && sample.power.kind === "supplied", "전원은 전력을 공급한다 (v·i 합이 음수)");
});

test("분석 정책: 3상 사인 전원이 있으면 자동 해석은 시간응답", () => {
  const example = cloneExample("three-phase-y-delta");
  const plan = suggestAnalysis(example.circuit, example.settings, "auto");
  assert.equal(plan.settings.analysis, "transient");
});
