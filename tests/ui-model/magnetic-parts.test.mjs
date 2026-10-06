import test from "node:test";
import assert from "node:assert/strict";
import { componentDefaults, pinCount, secondaryCurrentKey, simulateACAtFrequency, simulateDC } from "../../src/circuit-engine.js";
import { cloneExample, examples } from "../../src/examples.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import { currentArrowGeometry, currentDirectionDescriptor, currentProbeLabel, magneticWindingAt, probeCurrentKey } from "../../src/current-direction.js";
import { analyzeWireNets, pinCurrentsInto, wireCurrents } from "../../src/wire-current-model.js";
import { componentReadout } from "../../src/node-readout-model.js";
import { buildResultsCSV } from "../../src/csv-format.js";
import { parseCSV } from "../helpers/csv.mjs";
import { classifyCircuitConnections } from "../../src/circuit-status.js";
import { cloneComponentSet, componentIdPrefix } from "../../src/circuit-edit.js";
import { magneticSymbolMarkup, magneticValueLabel } from "../../src/canvas-renderer.js";
import { localPin, pinPosition } from "../../src/circuit-geometry.js";
import { detectYDelta, yDeltaCommandState } from "../../src/y-delta-circuit.js";
import { mergeSweepResults, sweepableProps } from "../../src/sweep-model.js";

const mag = (z) => Math.hypot(z.re, z.im);
const deg = (z) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const near = (actual, expected, relativeTolerance, label) => assert.ok(Math.abs(actual - expected) <= relativeTolerance * Math.abs(expected), `${label}: ${actual} vs ${expected}`);
const phasorAt = (example) => simulateACAtFrequency(example.circuit, example.settings.phasorFrequency);

test("두 예제가 목록에 있고 설정된 페이저 주파수로 교재 값이 나온다", () => {
  assert.ok(examples.some((item) => item.id === "coupled-coils" && item.name === "결합 코일 (예제 13.1)"));
  assert.ok(examples.some((item) => item.id === "ideal-transformer" && item.name === "이상 변압기 (예제 13.8)"));

  const coils = cloneExample("coupled-coils");
  const a = phasorAt(coils).points[0].componentCurrents;
  near(mag(a.K1), 13.01, 1e-3, "|I1|");
  assert.ok(Math.abs(deg(a.K1) - -49.39) < 0.1);
  near(mag(a.R1), 2.91, 1e-3, "|I2|");
  assert.ok(Math.abs(deg(a.R1) - 14.04) < 0.1);
  assert.ok(/peak\/cos/.test(coils.description) && /교재/.test(coils.description));

  const transformer = cloneExample("ideal-transformer");
  const result = phasorAt(transformer);
  const b = result.points[0].componentCurrents;
  near(mag(b.T1), 11.09, 1e-3, "|I1|");
  assert.ok(Math.abs(deg(b.T1) - 33.69) < 0.1);
  const vo = result.points[0].nodeVoltages[result.topology.nodeIdByPin["R2:0"]];
  near(mag(vo), 110.9, 1e-3, "|Vo|");
  const phase = ((deg(vo) % 360) + 360) % 360;
  assert.ok(Math.abs(phase - 213.69) < 0.1, `phase ${phase}`);
  assert.ok(/rms/.test(transformer.description) && /peak\/cos/.test(transformer.description));
});

test("예제 회로의 모든 핀이 GND 기준 경로로 분류되고 DC 해석도 오류가 없다", () => {
  for (const id of ["coupled-coils", "ideal-transformer"]) {
    const example = cloneExample(id);
    const status = classifyCircuitConnections(example.circuit, "ac", { frequency: 0.159 });
    assert.deepEqual(Object.values(status.byComponent).map((item) => item.status).filter((value) => value !== "referenced"), [], id);
    assert.ok(simulateDC({ ...example.circuit, junctions: [] }).points.length === 1);
  }
});

test("2차를 GND에 연결하지 않으면 상태 배지가 기준 경로 없음으로 알려준다(1차·2차는 절연)", () => {
  const example = cloneExample("ideal-transformer");
  const circuit = structuredClone(example.circuit);
  circuit.wires = circuit.wires.filter((wire) => wire.id !== "W6"); // 2a와 GND 연결 제거
  const status = classifyCircuitConnections(circuit, "ac", { frequency: 0.159 });
  assert.notEqual(status.byComponent.T1.status, "referenced");
});

test("프로젝트 저장·복원: version 4, 권선 2 전류 프로브와 모든 속성이 보존된다", () => {
  const example = cloneExample("coupled-coils");
  const probes = [
    { key: "I:K1", kind: "current", componentId: "K1", label: "I(K1.1)", color: "#80bfff" },
    { key: "I:K1:2", kind: "current", componentId: "K1", winding: 2, label: "I(K1.2)", color: "#f5bc79" },
  ];
  const text = serializeProject({ title: example.name, subtitle: example.description, circuit: example.circuit, settings: example.settings, probes });
  const payload = JSON.parse(text);
  assert.equal(payload.version, 4);
  assert.equal(payload.circuit.version, 4);
  const back = deserializeProject(text);
  assert.deepEqual(back.probes, probes);
  const k1 = back.circuit.components.find((item) => item.id === "K1");
  assert.deepEqual({ L1: k1.props.L1, L2: k1.props.L2, M: k1.props.M, coupling: k1.props.coupling, dots: k1.props.dots }, { L1: "5", L2: "6", M: "3", coupling: "M", dots: "same" });
  assert.equal(deserializeProject(serializeProject({ title: "t", subtitle: "", circuit: cloneExample("ideal-transformer").circuit, settings: {}, probes: [] })).circuit.version, 4);
  // winding 2 only exists on the two magnetic parts
  const bad = JSON.parse(text);
  bad.probes[1].componentId = "R1";
  assert.throws(() => deserializeProject(JSON.stringify(bad)), (error) => error.code === "INVALID_FILE");
});

test("예전(version 1~3) 프로젝트 파일은 그대로 읽힌다", () => {
  for (const id of ["divider", "opamp", "rc-lowpass"]) {
    const example = cloneExample(id);
    const text = serializeProject({ title: id, subtitle: "", circuit: example.circuit, settings: example.settings, probes: [] });
    assert.ok([1, 2, 3].includes(JSON.parse(text).version));
    assert.ok(deserializeProject(text).circuit.components.length > 0);
  }
});

test("전류 프로브 라벨 I(K1.1)·I(K1.2), 결과 키, CSV 머리글", () => {
  const example = cloneExample("coupled-coils");
  const k1 = example.circuit.components.find((item) => item.id === "K1");
  const t1 = { ...k1, id: "T1", type: "XFMR_IDEAL", props: { ref: "T1" } };
  assert.equal(currentProbeLabel(k1), "I(K1.1)");
  assert.equal(currentProbeLabel(k1, 2, 2), "I(K1.2)");
  assert.equal(currentProbeLabel(t1, 2, 2), "I(T1.2)");
  assert.equal(probeCurrentKey({ componentId: "K1" }), "K1");
  assert.equal(probeCurrentKey({ componentId: "K1", winding: 2 }), secondaryCurrentKey("K1"));

  const result = phasorAt(example);
  const probes = [{ kind: "current", componentId: "K1", label: "I(K1.1)" }, { kind: "current", componentId: "K1", winding: 2, label: "I(K1.2)" }];
  const series = probes.map((probe) => ({ probe, raw: result.points.map((point) => point.componentCurrents[probeCurrentKey(probe)]) }));
  assert.ok(series.every((item) => item.raw.every((value) => value && Number.isFinite(value.re))));
  const csv = parseCSV(buildResultsCSV({ analysis: "ac", xValues: result.xValues }, series));
  assert.deepEqual(csv[0], ["frequency_Hz", "I(K1.1)_magnitude_dBA", "I(K1.1)_phase_deg", "I(K1.2)_magnitude_dBA", "I(K1.2)_phase_deg"]);
});

test("권선 판별(눌린 쪽)과 전류 화살표 방향·위치", () => {
  const part = { id: "K1", type: "COUPLED_L", x: 200, y: 100, rotation: 0 };
  assert.equal(magneticWindingAt(part, { x: 180, y: 100 }), 1);
  assert.equal(magneticWindingAt(part, { x: 230, y: 90 }), 2);
  assert.equal(magneticWindingAt({ ...part, rotation: 180 }, { x: 180, y: 100 }), 2); // rotated by 180°, the left half is winding 2 on screen
  assert.equal(magneticWindingAt({ ...part, rotation: 90 }, { x: 200, y: 130 }), 2); // 90°: local +x points down
  const first = currentDirectionDescriptor(part, 2, 1), second = currentDirectionDescriptor(part, 2, 2);
  assert.deepEqual([first.fromPin, first.toPin, second.fromPin, second.toPin], [0, 1, 2, 3]);
  const arrow = currentArrowGeometry(first);
  assert.ok(arrow.end.y > arrow.start.y, "1a→1b points down");
  assert.ok(arrow.start.x < -40 && currentArrowGeometry(second).start.x > 40, "arrows sit outside their own pins");
});

test("핀 위치: 1a·1b 왼쪽 위·아래, 2a·2b 오른쪽 위·아래(격자 위), 4핀", () => {
  for (const type of ["COUPLED_L", "XFMR_IDEAL"]) {
    assert.equal(pinCount(type), 4);
    assert.deepEqual([0, 1, 2, 3].map((pin) => localPin(type, pin)), [{ x: -40, y: -20 }, { x: -40, y: 20 }, { x: 40, y: -20 }, { x: 40, y: 20 }]);
    const placed = pinPosition({ type, x: 300, y: 200, rotation: 90 }, 0);
    assert.ok(Math.abs(placed.x % 20) < 1e-9 && Math.abs(placed.y % 20) < 1e-9);
  }
  assert.equal(componentIdPrefix("COUPLED_L"), "K");
  assert.equal(componentIdPrefix("XFMR_IDEAL"), "T");
  assert.equal(componentDefaults("COUPLED_L", 3).ref, "K3");
  assert.equal(componentDefaults("XFMR_IDEAL", 2).ref, "T2");
});

test("기호: 점은 1a·2a(위쪽), opposite면 2차 점이 2b(아래쪽), 변압기는 철심 선이 있다", () => {
  const dots = (markup) => [...markup.matchAll(/<circle class="ideal-mark" cx="(-?\d+)" cy="(-?\d+)"/g)].map((match) => [Number(match[1]), Number(match[2])]);
  const same = magneticSymbolMarkup({ type: "COUPLED_L", props: { dots: "same" } });
  assert.deepEqual(dots(same), [[-31, -12], [31, -12]]);
  assert.deepEqual(dots(magneticSymbolMarkup({ type: "COUPLED_L", props: { dots: "opposite" } })), [[-31, -12], [31, 12]]);
  assert.ok(!same.includes("M-3-20V20"));
  assert.ok(magneticSymbolMarkup({ type: "XFMR_IDEAL", props: {} }).includes("M-3-20V20M3-20V20"));
  assert.equal(magneticValueLabel({ type: "XFMR_IDEAL", props: { n: "2" } }), "1 : 2");
  assert.equal(magneticValueLabel({ type: "COUPLED_L", props: { L1: "5", L2: "6", coupling: "M", M: "3" } }), "L1 5H · L2 6H · M 3H");
  assert.equal(magneticValueLabel({ type: "COUPLED_L", props: { L1: "10m", L2: "10m", coupling: "k", k: "0.5" } }), "10mH·10mH·k0.5");
  assert.equal(magneticValueLabel({ type: "COUPLED_L", props: { L1: "5", L2: "6", coupling: "k", k: "0.5" } }), "L1 5H · L2 6H · k 0.5");
});

test("전류 흐름: 권선 1·2의 핀 전류가 각 권선 안에서 보존되고 KCL 배선 전류가 계산된다", () => {
  assert.deepEqual(pinCurrentsInto({ type: "COUPLED_L" }, 2, 3), [2, -2, 3, -3]);
  assert.deepEqual(pinCurrentsInto({ type: "XFMR_IDEAL" }, 2, -1), [2, -2, -1, 1]);
  const example = cloneExample("coupled-coils");
  const result = simulateDC({ ...example.circuit, junctions: [] });
  const flow = wireCurrents({ circuit: example.circuit, componentCurrents: result.points[0].componentCurrents, nets: analyzeWireNets(example.circuit) });
  assert.ok(Object.values(flow.byWire).every((entry) => entry.state === "flow" || entry.state === "loop"));
});

test("호버 판독: 1차·2차 전류와 전압이 모두 나온다", () => {
  const example = cloneExample("coupled-coils");
  const result = phasorAt(example);
  const readout = componentReadout({ circuit: example.circuit, result, componentId: "K1" });
  assert.equal(readout.ok, true);
  assert.ok(readout.current && readout.current2 && readout.voltage && readout.voltage2);
  assert.ok(readout.lines.some((line) => line.startsWith("1차 전류")) && readout.lines.some((line) => line.startsWith("2차 전류")));
  near(readout.current.value, 13.01, 1e-3, "I1 readout");
  assert.equal(readout.pins.length, 4);
  const dc = simulateDC({ ...cloneExample("ideal-transformer").circuit, junctions: [] });
  const t = componentReadout({ circuit: cloneExample("ideal-transformer").circuit, result: dc, componentId: "T1" });
  assert.ok(Math.abs(t.power.value) < 1e-12, "ideal transformer net power is zero");
});

test("Y–Δ 변환은 저항만: 결합 인덕터·이상 변압기를 포함한 선택은 변환 불가", () => {
  const circuit = cloneExample("coupled-coils").circuit;
  assert.ok(!detectYDelta(circuit, ["K1", "R1", "C1"]).kind);
  const items = ["K1", "R1", "C1"].map((id) => ({ kind: "component", id }));
  assert.equal(yDeltaCommandState(circuit, items).enabled, false);
  const transformer = cloneExample("ideal-transformer").circuit;
  assert.ok(!detectYDelta(transformer, ["T1", "R1", "R2"]).kind);
  assert.equal(yDeltaCommandState(transformer, ["T1", "R1", "R2"].map((id) => ({ kind: "component", id }))).enabled, false);
});

test("복제하면 참조 이름이 다음 번호로 이어지고 속성이 복사된다", () => {
  const circuit = cloneExample("coupled-coils").circuit;
  const copy = cloneComponentSet(circuit, ["K1"], 60).components[0];
  assert.equal(copy.type, "COUPLED_L");
  assert.equal(copy.props.L1, "5");
  assert.notEqual(copy.props.ref, "K1");
  assert.match(copy.props.ref, /^K\d+$/);
});

test("스윕은 R·C·L·OP AMP 전용이라 새 부품에는 스윕 속성이 없다(보류 항목)", () => {
  assert.deepEqual(sweepableProps({ type: "COUPLED_L", props: {} }), []);
  assert.deepEqual(sweepableProps({ type: "XFMR_IDEAL", props: {} }), []);
  assert.equal(typeof mergeSweepResults, "function");
});
