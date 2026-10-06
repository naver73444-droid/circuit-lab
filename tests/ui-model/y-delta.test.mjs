import test from "node:test";
import assert from "node:assert/strict";
import { buildTopology, parseValue, simulateDC, validateCircuitStructure } from "../../src/circuit-engine.js";
import { convertDeltaToY, convertYToDelta, parseResistance, resistanceCircuitText, resistanceText, Y_DELTA_FORMULAS } from "../../src/y-delta-model.js";
import { convertYDeltaInCircuit, detectYDelta, layoutDeltaEdges, layoutStarArms, selectedResistorIds, yDeltaCommandState } from "../../src/y-delta-circuit.js";
import { createIdAllocator } from "../../src/id-allocator.js";
import { cloneExample } from "../../src/examples.js";
import { GRID_SIZE } from "../../src/circuit-geometry.js";
import { parseCourseMath } from "../../src/course-math-view.js";
import { formatCanvasValueLabel } from "../../src/canvas-renderer.js";
import { DIRECTIONS, SLIDER_STEPS, attempt, createYDeltaToolState, evaluateTool, resistanceToSlider, sliderToResistance, toggleDirection, withText, withValue } from "../../src/y-delta-tool-model.js";
import { shortcutFor } from "../../src/editor-shortcuts.js";

const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// ---- Part A: mathematics ----------------------------------------------------------------------------------------------------

test("Y→Δ 닫힌 꼴: 같은 저항 R이면 모든 Δ 변은 3R", () => {
  for (const r of [1, 47, 1e3, 4.7e6]) {
    const delta = convertYToDelta({ RA: r, RB: r, RC: r });
    for (const key of ["RAB", "RBC", "RCA"]) assert.ok(relative(delta[key], 3 * r) < 1e-14, `${key} ${delta[key]} vs ${3 * r}`);
  }
  const star = convertDeltaToY({ RAB: 3e3, RBC: 3e3, RCA: 3e3 });
  for (const key of ["RA", "RB", "RC"]) assert.ok(relative(star[key], 1e3) < 1e-14);
});

test("교과서 예: Y 1k/2k/3k → Δ 11/3 kΩ·11 kΩ·5.5 kΩ", () => {
  const delta = convertYToDelta({ RA: "1k", RB: "2k", RC: "3k" });
  assert.ok(relative(delta.RAB, 11e3 / 3) < 1e-13, "RAB = RA+RB+RA·RB/RC");
  assert.ok(relative(delta.RBC, 11e3) < 1e-13, "RBC = RB+RC+RB·RC/RA");
  assert.ok(relative(delta.RCA, 5.5e3) < 1e-13, "RCA = RC+RA+RC·RA/RB");
  assert.equal(delta.text.RBC, "11 kΩ");
  assert.equal(delta.text.RCA, "5.5 kΩ");
  // 직접 식과 대조
  const direct = { RAB: 1e3 + 2e3 + (1e3 * 2e3) / 3e3, RBC: 2e3 + 3e3 + (2e3 * 3e3) / 1e3, RCA: 3e3 + 1e3 + (3e3 * 1e3) / 2e3 };
  for (const key of Object.keys(direct)) assert.ok(relative(delta[key], direct[key]) < 1e-13);
});

test("Δ→Y 왕복(Y→Δ→Y, Δ→Y→Δ)은 1e-12 안에서 원래 값으로 돌아온다", () => {
  const triples = [[1e3, 2e3, 3e3], [10, 1e7, 470], [1, 1, 1], [4.7e6, 10, 1e3], [1e-3, 1e9, 5], [2.2e12, 3.3e-6, 1]];
  for (const [a, b, c] of triples) {
    const back = convertDeltaToY(convertYToDelta({ RA: a, RB: b, RC: c }));
    assert.ok(relative(back.RA, a) < 1e-12 && relative(back.RB, b) < 1e-12 && relative(back.RC, c) < 1e-12, `Y ${a},${b},${c} → ${back.RA},${back.RB},${back.RC}`);
    const again = convertYToDelta(convertDeltaToY({ RAB: a, RBC: b, RCA: c }));
    assert.ok(relative(again.RAB, a) < 1e-12 && relative(again.RBC, b) < 1e-12 && relative(again.RCA, c) < 1e-12);
  }
});

test("극단 크기 차이에도 작은 항이 사라지지 않고 넘치지 않는다", () => {
  const delta = convertYToDelta({ RA: 1, RB: 1e9, RC: 1e-3 });
  assert.ok(Number.isFinite(delta.RAB) && delta.RAB > 0);
  assert.ok(relative(delta.RAB, 1 + 1e9 + (1 * 1e9) / 1e-3) < 1e-12);
  assert.throws(() => convertYToDelta({ RA: 1e300, RB: 1e300, RC: 1e-300 }), (error) => error instanceof RangeError && /[가-힣]/.test(error.message), "표현 범위를 벗어난 결과는 한국어로 거부");
});

test("SI 문자열 입력: 1k, 4.7meg, 10Ω, 공백·숫자 혼용", () => {
  assert.equal(parseResistance("1k"), 1e3);
  assert.equal(parseResistance("4.7meg"), 4.7e6);
  assert.equal(parseResistance("10Ω"), 10);
  assert.equal(parseResistance(" 2.2 kΩ "), 2.2e3);
  assert.equal(parseResistance(330), 330);
  const delta = convertYToDelta({ RA: "1k", RB: 2000, RC: "3kΩ" });
  assert.ok(relative(delta.RBC, 11e3) < 1e-13);
  const star = convertDeltaToY({ RAB: "10k", RBC: "10k", RCA: "10k" });
  assert.ok(relative(star.RA, 10e3 / 3) < 1e-13);
});

test("잘못된 저항은 한국어 RangeError", () => {
  const bad = [0, -5, NaN, Infinity, "", "   ", "abc", "1x", null, undefined, {}, [], true, "0", "-1k", "1k2"];
  for (const value of bad) {
    assert.throws(() => convertYToDelta({ RA: value, RB: 1, RC: 1 }), (error) => error instanceof RangeError && /[가-힣]/.test(error.message), `RA=${String(value)}`);
    assert.throws(() => convertDeltaToY({ RAB: 1, RBC: value, RCA: 1 }), (error) => error instanceof RangeError && /[가-힣]/.test(error.message), `RBC=${String(value)}`);
  }
  assert.throws(() => convertYToDelta(null), RangeError);
  assert.throws(() => convertYToDelta({ RA: 1, RB: 1 }), /R_C/);
});

test("표시 문자열과 회로 저장 문자열", () => {
  assert.equal(resistanceText(3000), "3 kΩ");
  assert.equal(resistanceText(4.7e6), "4.7 MΩ");
  assert.equal(resistanceText(330), "330 Ω");
  for (const value of [3000, 1333.3333333333333, 4.7e6, 10, 1e-3, 2.2e9, 1e12, 123456.789012345]) {
    const text = resistanceCircuitText(value);
    assert.ok(relative(parseValue(text), value) < 1e-11, `${value} → ${text} → ${parseValue(text)}`);
  }
  assert.equal(resistanceCircuitText(1e3), "1k");
  assert.equal(resistanceCircuitText(4.7e6), "4.7meg");
  assert.throws(() => resistanceCircuitText(0), RangeError);
});

test("한 줄 식은 course-math 문법으로 해석된다", () => {
  for (const line of [...Y_DELTA_FORMULAS.toDelta, ...Y_DELTA_FORMULAS.toY]) assert.ok(parseCourseMath(line), line);
});

// ---- circuits for detection / rewrite -----------------------------------------------------------------------------------------

const part = (id, type, x, y, props = {}, rotation = 0) => ({ id, type, x, y, rotation, props: { ref: id, ...props } });
const resistor = (id, value, x = 0, y = 0, rotation = 0) => part(id, "R", x, y, { value }, rotation);
const pinEnd = (componentId, pin) => ({ componentId, pin });
const wire = (id, a, b, waypoints) => ({ id, a, b, ...(waypoints ? { waypoints } : {}) });
const circuitOf = (components, wires, junctions = []) => ({ version: 1, geometryVersion: 2, components, wires, junctions });

/**
 * 12 V source → A. Y arms R1(A), R2(B), R3(C) meet at the centre; B and C each feed a 1k load to ground.
 * `style` selects how the corner nodes are wired.
 */
function yCircuit(style = "direct", values = ["1k", "2k", "3k"]) {
  const components = [
    part("V1", "V", 100, 260, { mode: "DC", dc: "12" }, 90),
    resistor("R1", values[0], 300, 260), resistor("R2", values[1], 420, 160, 90), resistor("R3", values[2], 420, 360, 90),
    resistor("R4", "1k", 560, 160, 90), resistor("R5", "1k", 560, 360, 90), part("G1", "GND", 620, 540),
  ];
  const junctions = [{ id: "J1", x: 420, y: 260 }];
  const wires = [
    wire("W2", pinEnd("R1", 1), { junctionId: "J1" }), wire("W3", pinEnd("R2", 1), { junctionId: "J1" }), wire("W4", pinEnd("R3", 0), { junctionId: "J1" }),
    wire("W7", pinEnd("R4", 1), pinEnd("G1", 0)), wire("W8", pinEnd("R5", 0), pinEnd("G1", 0)), wire("W9", pinEnd("V1", 1), pinEnd("G1", 0)),
  ];
  if (style === "direct") {
    wires.push(wire("W1", pinEnd("V1", 0), pinEnd("R1", 0)), wire("W5", pinEnd("R2", 0), pinEnd("R4", 0)), wire("W6", pinEnd("R3", 1), pinEnd("R5", 1)));
  } else if (style === "hubs") {
    // every corner is a junction with the arm AND the rest of the network wired to it (several wires on the removed pin's net)
    junctions.push({ id: "JA", x: 200, y: 260 }, { id: "JB", x: 420, y: 100 }, { id: "JC", x: 420, y: 420 });
    wires.push(
      wire("W1", pinEnd("V1", 0), { junctionId: "JA" }), wire("W1b", { junctionId: "JA" }, pinEnd("R1", 0)),
      wire("W5", pinEnd("R2", 0), { junctionId: "JB" }), wire("W5b", { junctionId: "JB" }, pinEnd("R4", 0)),
      wire("W6", pinEnd("R3", 1), { junctionId: "JC" }), wire("W6b", { junctionId: "JC" }, pinEnd("R5", 1)),
    );
  } else if (style === "pin-hub") {
    // the arm's own pin carries two wires (it is the corner), plus a dangling extra capacitor on corner B
    wires.push(wire("W1", pinEnd("V1", 0), pinEnd("R1", 0)), wire("W5", pinEnd("R2", 0), pinEnd("R4", 0)), wire("W5c", pinEnd("R2", 0), pinEnd("C1", 0)), wire("W6", pinEnd("R3", 1), pinEnd("R5", 1)));
    components.push(part("C1", "C", 480, 100, { value: "1u", ic: "0" }), part("G2", "GND", 540, 40));
    wires.push(wire("W10", pinEnd("C1", 1), pinEnd("G2", 0)));
  }
  return circuitOf(components, wires, junctions);
}

/** Δ ring R1(A–B) R2(B–C) R3(C–A); source at A, loads at B and C. */
function deltaCircuit(style = "direct", values = ["1k", "2k", "3k"]) {
  const components = [
    part("V1", "V", 100, 260, { mode: "DC", dc: "12" }, 90),
    resistor("R1", values[0], 300, 180), resistor("R2", values[1], 420, 320, 90), resistor("R3", values[2], 300, 340),
    resistor("R4", "1k", 560, 160, 90), resistor("R5", "1k", 560, 420, 90), part("G1", "GND", 620, 540),
  ];
  const wires = [wire("W7", pinEnd("R4", 1), pinEnd("G1", 0)), wire("W8", pinEnd("R5", 0), pinEnd("G1", 0)), wire("W9", pinEnd("V1", 1), pinEnd("G1", 0))];
  const junctions = [];
  if (style === "direct") {
    // R1.0 = A, R1.1 = B, R2.0 = B, R2.1 = C, R3.0 = C, R3.1 = A (ring joined pin to pin; the loads hang off ring pins)
    wires.push(
      wire("W1", pinEnd("R1", 0), pinEnd("R3", 1)), wire("W2", pinEnd("R1", 1), pinEnd("R2", 0)), wire("W3", pinEnd("R2", 1), pinEnd("R3", 0)),
      wire("W4", pinEnd("V1", 0), pinEnd("R1", 0)), wire("W5", pinEnd("R2", 0), pinEnd("R4", 0)), wire("W6", pinEnd("R2", 1), pinEnd("R5", 1)),
    );
  } else {
    junctions.push({ id: "JA", x: 240, y: 260 }, { id: "JB", x: 420, y: 180 }, { id: "JC", x: 420, y: 340 });
    wires.push(
      wire("W1", pinEnd("R1", 0), { junctionId: "JA" }), wire("W1b", pinEnd("R3", 1), { junctionId: "JA" }),
      wire("W2", pinEnd("R1", 1), { junctionId: "JB" }), wire("W2b", pinEnd("R2", 0), { junctionId: "JB" }),
      wire("W3", pinEnd("R2", 1), { junctionId: "JC" }), wire("W3b", pinEnd("R3", 0), { junctionId: "JC" }),
      wire("W4", pinEnd("V1", 0), { junctionId: "JA" }), wire("W5", { junctionId: "JB" }, pinEnd("R4", 0)), wire("W6", { junctionId: "JC" }, pinEnd("R5", 1)),
    );
  }
  return circuitOf(components, wires, junctions);
}

const voltageAt = (circuit, result, id, pin) => result.points[0].nodeVoltages[buildTopology(circuit).nodeFor(id, pin)];

/** Voltages at the corner pins and the source current must survive the conversion. */
function assertEquivalent(before, after, { cornerPins = [["V1", 0], ["R4", 0], ["R5", 1]], tolerance = 1e-9 } = {}) {
  const resultBefore = simulateDC(before);
  const resultAfter = simulateDC(after);
  for (const [id, pin] of cornerPins) {
    const a = voltageAt(before, resultBefore, id, pin), b = voltageAt(after, resultAfter, id, pin);
    assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a)), `V(${id}.${pin + 1}) ${a} → ${b}`);
  }
  const currentBefore = resultBefore.points[0].componentCurrents.V1, currentAfter = resultAfter.points[0].componentCurrents.V1;
  assert.ok(relative(currentAfter, currentBefore) <= tolerance, `전원 전류 ${currentBefore} → ${currentAfter}`);
}

// ---- detection ---------------------------------------------------------------------------------------------------------------

test("검출: Y는 중심·바깥 노드와 암 핀, Δ는 코너 A,B,C를 돌려준다", () => {
  const y = detectYDelta(yCircuit(), ["R1", "R2", "R3"]);
  assert.equal(y.kind, "Y");
  assert.deepEqual(y.resistors, ["R1", "R2", "R3"]);
  assert.equal(new Set([y.center, ...y.outer]).size, 4, "중심과 바깥 3개는 모두 다른 노드");
  assert.deepEqual(y.arms.map((arm) => [arm.id, arm.centerPin, arm.outerPin]), [["R1", 1, 0], ["R2", 1, 0], ["R3", 0, 1]]);
  const delta = detectYDelta(deltaCircuit(), ["R3", "R1", "R2"]);
  assert.equal(delta.kind, "Δ");
  assert.deepEqual(delta.resistors, ["R1", "R2", "R3"], "회로의 부품 순서로 정렬");
  assert.equal(new Set(delta.nodes).size, 3);
  assert.deepEqual(delta.edges.map((edge) => edge.id), ["R1", "R2", "R3"]);
});

test("검출: 다른 부품이 코너에 붙어 있어도(전원·부하·접지) 무시한다", () => {
  assert.equal(detectYDelta(yCircuit("pin-hub"), ["R1", "R2", "R3"]).kind, "Y");
  assert.equal(detectYDelta(deltaCircuit("junctions"), ["R1", "R2", "R3"]).kind, "Δ");
});

test("검출: Y도 Δ도 아닌 연결은 이유와 함께 null", () => {
  const base = yCircuit();
  const reason = (circuit, ids) => { const result = detectYDelta(circuit, ids); assert.equal(result.kind, null); assert.ok(/[가-힣]/.test(result.reason), result.reason); return result.reason; };
  reason(base, ["R1", "R2"]);
  reason(base, ["R1", "R2", "R2"]);
  reason(base, ["R1", "R2", "V1"]);
  reason(base, ["R1", "R2", "NOPE"]);
  assert.match(reason(base, ["R1", "R2", "R4"]), /Y 또는|직렬|혼합/, "직렬·혼합");
  // 중심에 다른 부품이 붙은 별(별-메시 변환은 지원하지 않음)
  const crowded = structuredClone(base);
  crowded.components.push(resistor("R9", "5k", 380, 300));
  crowded.wires.push(wire("W20", pinEnd("R9", 0), { junctionId: "J1" }), wire("W21", pinEnd("R9", 1), pinEnd("G1", 0)));
  assert.match(reason(crowded, ["R1", "R2", "R3"]), /중심 노드에 다른 부품\(R9\)/);
  // 병렬 3개
  const parallel = circuitOf([part("V1", "V", 0, 0, { dc: "1" }), resistor("R1", "1k"), resistor("R2", "1k"), resistor("R3", "1k"), part("G1", "GND", 0, 0)], [
    wire("W1", pinEnd("V1", 0), pinEnd("R1", 0)), wire("W2", pinEnd("V1", 0), pinEnd("R2", 0)), wire("W3", pinEnd("V1", 0), pinEnd("R3", 0)),
    wire("W4", pinEnd("R1", 1), pinEnd("G1", 0)), wire("W5", pinEnd("R2", 1), pinEnd("G1", 0)), wire("W6", pinEnd("R3", 1), pinEnd("G1", 0)), wire("W7", pinEnd("V1", 1), pinEnd("G1", 0)),
  ]);
  assert.match(reason(parallel, ["R1", "R2", "R3"]), /병렬/);
  // 단락된 저항(양 끝이 같은 노드)
  const shorted = structuredClone(base);
  shorted.wires.push(wire("W30", pinEnd("R4", 0), pinEnd("R4", 1)));
  assert.match(reason(shorted, ["R4", "R2", "R3"]), /같은 노드/);
  // 저항값이 잘못됨
  const broken = structuredClone(base);
  broken.components.find((component) => component.id === "R1").props.value = "abc";
  assert.match(reason(broken, ["R1", "R2", "R3"]), /저항값/);
});

test("검출은 접지가 없는 반쯤 그린 회로도 같은 net 규칙으로 판정한다", () => {
  const circuit = yCircuit();
  circuit.components = circuit.components.filter((component) => component.type !== "GND");
  circuit.wires = circuit.wires.filter((item) => !["W7", "W8", "W9"].includes(item.id));
  assert.throws(() => buildTopology(circuit), "솔버는 접지 없는 회로를 거부한다");
  assert.equal(detectYDelta(circuit, ["R1", "R2", "R3"]).kind, "Y");
});

test("선택 해석: 부품 정확히 3개가 모두 저항일 때만 명령이 보인다", () => {
  const circuit = yCircuit();
  const c = (id) => ({ kind: "component", id });
  assert.equal(selectedResistorIds(circuit, [c("R1"), c("R2")]), null);
  assert.equal(selectedResistorIds(circuit, [c("R1"), c("R2"), c("V1")]), null);
  assert.deepEqual(selectedResistorIds(circuit, [c("R1"), c("R2"), c("R3"), { kind: "wire", id: "W2" }, { kind: "junction", id: "J1" }]), ["R1", "R2", "R3"], "함께 선택된 배선·접속점은 무시");
  assert.deepEqual(yDeltaCommandState(circuit, [c("R1"), c("R2")]), { visible: false, enabled: false, kind: null, label: "", reason: "" });
  assert.deepEqual(yDeltaCommandState(circuit, [c("R1"), c("R2"), c("R3")]), { visible: true, enabled: true, kind: "Y", label: "Y→Δ 변환", reason: "" });
  assert.equal(yDeltaCommandState(deltaCircuit(), [c("R1"), c("R2"), c("R3")]).label, "Δ→Y 변환");
  const state = yDeltaCommandState(circuit, [c("R1"), c("R2"), c("R4")]);
  assert.equal(state.visible, true);
  assert.equal(state.enabled, false);
  assert.ok(state.reason.length > 3);
});

// ---- rewrite: structure and electrical equivalence ---------------------------------------------------------------------------

for (const style of ["direct", "hubs", "pin-hub"]) {
  test(`Y→Δ 재작성(${style}): 구조 유효 · 노드 전압과 전원 전류 동등 · 입력 불변`, () => {
    const before = yCircuit(style);
    const frozen = structuredClone(before);
    const { circuit, report } = convertYDeltaInCircuit(before, ["R1", "R2", "R3"]);
    assert.deepEqual(before, frozen, "입력 회로는 바뀌지 않는다");
    validateCircuitStructure(circuit);
    assert.equal(report.kind, "Y→Δ");
    assert.equal(report.removed.length, 3);
    assert.equal(report.added.length, 3);
    assert.equal(circuit.components.length, before.components.length, "저항 3개가 저항 3개로");
    assert.ok(report.removed.every((id) => !circuit.components.some((component) => component.id === id)));
    assert.ok(circuit.junctions.every((junction) => junction.id !== "J1"), "중심 접속점은 사라진다");
    assert.equal(detectYDelta(circuit, report.added).kind, "Δ");
    assert.deepEqual(circuit.components.filter((component) => !report.added.includes(component.id) && !report.removed.includes(component.id)).map((component) => component.id), before.components.filter((component) => !report.removed.includes(component.id)).map((component) => component.id), "다른 부품은 그대로");
    assert.match(report.message, /^Y→Δ 변환: RAB=3\.667 kΩ, RBC=11 kΩ, RCA=5\.5 kΩ$/);
    const corner = style === "pin-hub" ? [["V1", 0], ["R4", 0], ["R5", 1], ["C1", 0]] : undefined;
    assertEquivalent(before, circuit, corner ? { cornerPins: corner } : {});
    // 값이 기대한 식과 맞는다
    const values = report.added.map((id) => parseValue(circuit.components.find((component) => component.id === id).props.value));
    assert.ok(relative(values[0], 11e3 / 3) < 1e-11 && relative(values[1], 11e3) < 1e-11 && relative(values[2], 5.5e3) < 1e-11);
  });
}

for (const style of ["direct", "junctions"]) {
  test(`Δ→Y 재작성(${style}): 구조 유효 · 노드 전압과 전원 전류 동등`, () => {
    const before = deltaCircuit(style);
    const { circuit, report } = convertYDeltaInCircuit(before, ["R1", "R2", "R3"]);
    validateCircuitStructure(circuit);
    assert.equal(report.kind, "Δ→Y");
    assert.equal(circuit.components.length, before.components.length);
    assert.equal(circuit.junctions.length, before.junctions.length + 1, "중심 접속점 1개 추가(코너는 기존 끝점 재사용)" + (style === "direct" ? "" : " "));
    assert.equal(detectYDelta(circuit, report.added).kind, "Y");
    assertEquivalent(before, circuit);
    assert.match(report.message, /^Δ→Y 변환: RA=.*, RB=.*, RC=.*$/);
  });
}

test("Y→Δ→Y 왕복: 값과 전기적 동작이 처음으로 돌아온다", () => {
  const before = yCircuit("hubs", ["4.7k", "330", "22k"]);
  const first = convertYDeltaInCircuit(before, ["R1", "R2", "R3"]);
  const second = convertYDeltaInCircuit(first.circuit, first.report.added);
  validateCircuitStructure(second.circuit);
  const values = second.report.added.map((id) => parseValue(second.circuit.components.find((component) => component.id === id).props.value));
  assert.ok(relative(values[0], 4.7e3) < 1e-10 && relative(values[1], 330) < 1e-10 && relative(values[2], 22e3) < 1e-10, String(values));
  assertEquivalent(before, second.circuit);
});

test("극단 저항값 조합에서도 동등성이 유지된다", () => {
  for (const values of [["10", "10meg", "470"], ["1", "1", "1"], ["4.7meg", "10", "1k"]]) {
    const before = yCircuit("direct", values);
    const { circuit } = convertYDeltaInCircuit(before, ["R1", "R2", "R3"]);
    assertEquivalent(before, circuit, { tolerance: 1e-9 });
    const back = deltaCircuit("direct", values);
    assertEquivalent(back, convertYDeltaInCircuit(back, ["R1", "R2", "R3"]).circuit, { tolerance: 1e-9 });
  }
});

test("코너가 접지인 Y(두 번째 접지 기호 포함)도 동등하게 바뀐다", () => {
  // A = GND: arms R1 (to ground symbol), R2 to a 5 V source, R3 to a current load node
  const components = [part("V1", "V", 100, 260, { mode: "DC", dc: "5" }, 90), part("G1", "GND", 100, 400), part("G2", "GND", 300, 400), resistor("R1", "1k", 300, 300, 90), resistor("R2", "2k", 400, 200), resistor("R3", "3k", 400, 240), resistor("R4", "1k", 600, 300, 90), part("G3", "GND", 600, 440)];
  const wires = [
    wire("W1", pinEnd("V1", 1), pinEnd("G1", 0)), wire("W2", pinEnd("R1", 1), pinEnd("G2", 0)),
    wire("W3", pinEnd("V1", 0), pinEnd("R2", 0)), wire("W4", pinEnd("R3", 0), pinEnd("R4", 0)), wire("W5", pinEnd("R4", 1), pinEnd("G3", 0)),
    wire("W6", pinEnd("R1", 0), { junctionId: "J1" }), wire("W7", pinEnd("R2", 1), { junctionId: "J1" }), wire("W8", pinEnd("R3", 1), { junctionId: "J1" }),
  ];
  const before = circuitOf(components, wires, [{ id: "J1", x: 360, y: 220 }]);
  assert.equal(detectYDelta(before, ["R1", "R2", "R3"]).kind, "Y");
  const { circuit } = convertYDeltaInCircuit(before, ["R1", "R2", "R3"]);
  validateCircuitStructure(circuit);
  const after = simulateDC(circuit), reference = simulateDC(before);
  for (const [id, pin] of [["V1", 0], ["R4", 0]]) assert.ok(Math.abs(voltageAt(before, reference, id, pin) - voltageAt(circuit, after, id, pin)) < 1e-9);
  assert.ok(relative(after.points[0].componentCurrents.V1, reference.points[0].componentCurrents.V1) < 1e-9);
});

test("중심에 다른 부품이 있으면 재작성은 한국어 RangeError로 거부한다", () => {
  const crowded = yCircuit();
  crowded.components.push(resistor("R9", "5k", 380, 300));
  crowded.wires.push(wire("W20", pinEnd("R9", 0), { junctionId: "J1" }), wire("W21", pinEnd("R9", 1), pinEnd("G1", 0)));
  assert.throws(() => convertYDeltaInCircuit(crowded, ["R1", "R2", "R3"]), (error) => error instanceof RangeError && /중심 노드/.test(error.message));
});

test("새 id는 할당기를 따라 재사용되지 않고, 새 참조 이름은 기존 번호 위에서 이어진다", () => {
  const before = yCircuit();
  const allocator = createIdAllocator();
  allocator.observe(before.components, before.wires, before.junctions);
  const first = convertYDeltaInCircuit(before, ["R1", "R2", "R3"], { allocator });
  const used = new Set([...before.components, ...before.wires, ...before.junctions].map((item) => item.id));
  const fresh = [...first.circuit.components, ...first.circuit.wires, ...first.circuit.junctions].filter((item) => !used.has(item.id));
  assert.ok(fresh.length >= 6 && new Set(fresh.map((item) => item.id)).size === fresh.length);
  assert.deepEqual(first.report.added.map((id) => first.circuit.components.find((component) => component.id === id).props.ref), ["R6", "R7", "R8"], "R5가 최대였으므로 R6부터");
  const second = convertYDeltaInCircuit(first.circuit, first.report.added, { allocator });
  const secondFresh = [...second.circuit.components, ...second.circuit.wires, ...second.circuit.junctions].filter((item) => !used.has(item.id) && !fresh.some((other) => other.id === item.id));
  assert.ok(secondFresh.length >= 6, "되돌려도 처음 id를 다시 쓰지 않는다");
  assert.ok(second.report.added.every((id) => !before.components.some((component) => component.id === id)));
});

test("프로브: 코너 전압 프로브는 새 끝점으로 옮겨 가고, 중심·저항 전류 프로브는 사라진다", () => {
  const before = yCircuit();
  const probes = [
    { key: "V:R1:0", kind: "voltage", componentId: "R1", pin: 0, wireId: "W1", label: "V(R1.1)", color: "c1" },
    { key: "V:R1:1", kind: "voltage", componentId: "R1", pin: 1, wireId: null, label: "V(R1.2)", color: "c2" },
    { key: "I:R2", kind: "current", componentId: "R2", label: "I(R2)", color: "c3" },
    { key: "V:J:J1", kind: "voltage", junctionId: "J1", wireId: null, label: "V(J1)", color: "c4" },
    { key: "V:R4:0", kind: "voltage", componentId: "R4", pin: 0, wireId: "W5", label: "V(R4.1)", color: "c5" },
    { key: "I:R4", kind: "current", componentId: "R4", label: "I(R4)", color: "c6" },
  ];
  const { probes: moved } = convertYDeltaInCircuit(before, ["R1", "R2", "R3"], { probes });
  const keys = moved.map((probe) => probe.key);
  assert.ok(!keys.includes("V:R1:0") || moved.find((probe) => probe.key === "V:R1:0") === undefined);
  assert.ok(!keys.includes("V:R1:1") && !keys.includes("I:R2") && !keys.includes("V:J:J1"), keys.join(","));
  assert.ok(keys.includes("V:V1:0"), "R1.1의 전압 프로브는 같은 노드의 V1.1로 옮겨 간다");
  const retargeted = moved.find((probe) => probe.key === "V:V1:0");
  assert.equal(retargeted.componentId, "V1");
  assert.equal(retargeted.pin, 0);
  assert.equal(retargeted.color, "c1", "색은 유지");
  assert.equal(retargeted.wireId, null);
  assert.ok(keys.includes("V:R4:0") && keys.includes("I:R4"), "남는 노드의 프로브는 그대로");
});

test("배치: 새 부품은 격자 위, 서로 겹치지 않고, 핀이 격자에 닿는다", () => {
  for (const circuit of [yCircuit("direct"), yCircuit("hubs"), deltaCircuit("direct"), deltaCircuit("junctions")]) {
    const result = convertYDeltaInCircuit(circuit, ["R1", "R2", "R3"]);
    const added = result.report.added.map((id) => result.circuit.components.find((component) => component.id === id));
    for (const component of added) {
      assert.equal(component.x % GRID_SIZE, 0);
      assert.equal(component.y % GRID_SIZE, 0);
      assert.ok([0, 90, 180, 270].includes(component.rotation));
    }
    for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) assert.ok(Math.hypot(added[i].x - added[j].x, added[i].y - added[j].y) >= 60, "새 저항끼리 겹치지 않는다");
    for (const junction of result.circuit.junctions) assert.equal(junction.x % GRID_SIZE + junction.y % GRID_SIZE, 0, "접속점도 격자 위");
  }
});

test("배치 보조 함수: 일직선·겹치는 코너에서도 서로 떨어진 격자 점을 준다", () => {
  const centers = layoutDeltaEdges([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }], { x: 200, y: 100 });
  assert.equal(new Set(centers.map((point) => `${point.x},${point.y}`)).size, 3);
  const star = layoutStarArms([{ x: 200, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 100 }], { x: 200, y: 100 });
  assert.equal(new Set(star.arms.map((point) => `${point.x},${point.y}`)).size, 3, "코너가 허브와 겹치면 정삼각 배치");
  for (const point of [...centers, ...star.arms, star.hub]) assert.ok(point.x % GRID_SIZE === 0 && point.y % GRID_SIZE === 0);
});

test("예제 'Y 저항망'은 유효하고 Y로 인식되며 변환 전후 전압이 같다", () => {
  const { circuit } = cloneExample("y-network");
  validateCircuitStructure(circuit);
  const detected = detectYDelta(circuit, ["R1", "R2", "R3"]);
  assert.equal(detected.kind, "Y");
  const result = convertYDeltaInCircuit(circuit, ["R1", "R2", "R3"]);
  validateCircuitStructure(result.circuit);
  assertEquivalent(circuit, result.circuit, { cornerPins: [["V1", 0], ["R4", 0], ["R5", 1]] });
});

// ---- Part B: the course tool's state --------------------------------------------------------------------------------------------


test("슬라이더는 10 Ω … 10 MΩ 로그 눈금이고 값은 세 자리 유효숫자", () => {
  assert.equal(sliderToResistance(0), 10);
  assert.equal(sliderToResistance(SLIDER_STEPS), 1e7);
  assert.equal(sliderToResistance(SLIDER_STEPS / 2), Number((10 * 10 ** 3).toPrecision(3)), "한가운데는 10 Ω과 10 MΩ의 기하평균 10 kΩ");
  assert.equal(sliderToResistance(-50), 10, "범위를 벗어난 위치는 끝으로");
  for (let position = 0; position <= SLIDER_STEPS; position += 37) {
    const value = sliderToResistance(position);
    assert.equal(value, Number(value.toPrecision(3)));
    assert.ok(Math.abs(resistanceToSlider(value) - position) <= 2, `${position} → ${value} → ${resistanceToSlider(value)}`);
  }
  assert.equal(resistanceToSlider(1), 0, "10 Ω 미만은 왼쪽 끝");
  assert.equal(resistanceToSlider(1e9), SLIDER_STEPS, "10 MΩ 초과는 오른쪽 끝");
  assert.equal(resistanceToSlider(0), 0);
});

test("도구 상태: 기본 Y 1k/2k/3k → Δ, RA=RB=RC=1k이면 RAB=3 kΩ", () => {
  let state = createYDeltaToolState();
  assert.equal(state.direction, "toDelta");
  const first = evaluateTool(state);
  assert.equal(first.texts.RBC, "11 kΩ");
  for (const key of ["RA", "RB", "RC"]) {
    const result = withText(state, key, "1k");
    assert.equal(result.ok, true);
    state = result.state;
  }
  const equal = evaluateTool(state);
  assert.equal(equal.texts.RAB, "3 kΩ");
  assert.equal(equal.texts.RBC, "3 kΩ");
  assert.equal(equal.texts.RCA, "3 kΩ");
  assert.match(equal.read, /3배/);
  assert.match(equal.read, /RAB=3 kΩ/);
  assert.equal(equal.math.general, "R_AB = R_A + R_B + R_A·R_B/R_C");
  assert.ok(parseCourseMath(equal.math.general) && parseCourseMath(equal.math.numeric), equal.math.numeric);
});

test("도구 상태: 잘못된 입력은 한국어 이유와 함께 거부하고 마지막 유효 상태는 그대로", () => {
  const state = createYDeltaToolState();
  for (const text of ["", "abc", "0", "-3k", "1e999", "k1"]) {
    const result = withText(state, "RA", text);
    assert.equal(result.ok, false, text);
    assert.match(result.reason, /[가-힣]/, text);
  }
  assert.throws(() => withValue(state, "RAB", 1000), RangeError, "다른 방향의 입력은 받지 않는다");
  assert.deepEqual(state.values, { RA: 1e3, RB: 2e3, RC: 3e3 }, "상태는 불변");
});

test("방향 전환은 같은 회로를 거꾸로 보여 준다(결과가 새 입력, 6자리)", () => {
  const start = createYDeltaToolState();
  const forward = evaluateTool(start);
  const flipped = toggleDirection(start);
  assert.equal(flipped.direction, "toY");
  assert.ok(relative(flipped.values.RAB, forward.outputs.RAB) < 1e-6 && relative(flipped.values.RBC, forward.outputs.RBC) < 1e-6);
  const back = evaluateTool(flipped).outputs;
  assert.ok(relative(back.RA, 1e3) < 1e-5 && relative(back.RB, 2e3) < 1e-5 && relative(back.RC, 3e3) < 1e-5);
  assert.deepEqual(DIRECTIONS.toY.outputs, ["RA", "RB", "RC"]);
  assert.match(evaluateTool(flipped).read, /맞은편 팔 RA가 가장 작은 팔/, "가장 큰 변 RBC의 맞은편 팔");
});

test("읽기 문장의 규칙: Y→Δ에서 가장 큰 팔의 맞은편 변이 가장 작은 변", () => {
  for (const [ra, rb, rc] of [[1e3, 2e3, 3e3], [5e3, 1e2, 4e3], [10, 10e6, 470]]) {
    const out = convertYToDelta({ RA: ra, RB: rb, RC: rc });
    const largest = [ra, rb, rc].indexOf(Math.max(ra, rb, rc));
    const opposite = ["RBC", "RCA", "RAB"][largest];
    assert.equal(Math.min(out.RAB, out.RBC, out.RCA), out[opposite]);
    const read = evaluateTool({ direction: "toDelta", values: { RA: ra, RB: rb, RC: rc } }).read;
    assert.ok(read.includes(`${["RA", "RB", "RC"][largest]}의 맞은편 변 ${opposite}`), read);
  }
});

test("단축키 Y는 yDelta 동작, Ctrl+Y는 그대로 다시 하기, 글자 입력 중에는 무시", () => {
  const event = (key, extra = {}) => ({ key, code: `Key${key.toUpperCase()}`, ...extra });
  assert.equal(shortcutFor(event("y"))?.action, "yDelta");
  assert.equal(shortcutFor(event("Y", { shiftKey: true }))?.action, "yDelta");
  assert.equal(shortcutFor(event("y", { ctrlKey: true }))?.action, "redo");
  assert.equal(shortcutFor(event("y"), { typing: true }), null);
  assert.equal(shortcutFor(event("y", { altKey: true })), null);
  assert.equal(shortcutFor({ key: "ㅛ", code: "KeyY" })?.action, "yDelta", "한글 입력기에서도 물리 키로 동작");
});

// ---- reviewer-verified fixes --------------------------------------------------------------------------------------------------

test("[1] 검증은 통과하지만 변환에서 넘치는 입력(RA=1e308)은 커밋 전에 걸러지고 마지막 유효 상태·방향 전환·읽기가 살아 있다", () => {
  const state = createYDeltaToolState();
  const typed = withText(state, "RA", "1e308");
  assert.equal(typed.ok, true, "값 자체는 유효한 저항");
  assert.throws(() => evaluateTool(typed.state), RangeError, "그러나 평가는 넘친다");
  const tried = attempt(typed.state);
  assert.equal(tried.ok, false);
  assert.match(tried.reason, /[가-힣]/);
  // 컨트롤러는 attempt가 실패하면 state를 바꾸지 않는다: 마지막 유효 상태로 평가·방향 전환이 그대로 된다.
  assert.equal(attempt(state).ok, true);
  const toggled = toggleDirection(state);
  assert.equal(attempt(toggled).ok, true);
  assert.equal(evaluateTool(state).texts.RAB, "3.667 kΩ");
  // 정상 후보는 평가 결과를 같이 돌려준다
  const fine = attempt(withText(state, "RA", "4.7k").state);
  assert.equal(fine.ok, true);
  assert.equal(fine.evaluation.inputs.RA, 4700);
});

const endpointKeyOf = (end) => (end.junctionId !== undefined ? "J:" + end.junctionId : end.componentId + ":" + end.pin);

/** A Δ whose corner A carries a capacitor wired twice (once from each edge pin, opposite orientations) to ground. */
function deltaWithTwinWires() {
  const circuit = deltaCircuit("direct");
  circuit.components.push(part("C1", "C", 240, 100, { value: "1u", ic: "0" }));
  circuit.wires.push(wire("W10", pinEnd("C1", 0), pinEnd("R1", 0)), wire("W11", pinEnd("R3", 1), pinEnd("C1", 0)), wire("W12", pinEnd("C1", 1), pinEnd("G1", 0)));
  return circuit;
}

test("[2] 결과가 접속점 한도(1024)를 넘으면 회로 대신 {ok:false, reason}을 돌려주고 입력은 그대로다", () => {
  const dangling = (count) => Array.from({ length: count }, (_, index) => ({ id: "JX" + (index + 1), x: 1000 + 20 * (index % 50), y: 1000 + 20 * Math.floor(index / 50) }));
  const full = deltaCircuit("direct");
  full.junctions.push(...dangling(1024));
  validateCircuitStructure(full);
  const frozen = structuredClone(full);
  const refused = convertYDeltaInCircuit(full, ["R1", "R2", "R3"]);
  assert.equal(refused.ok, false);
  assert.equal(refused.circuit, undefined);
  assert.match(refused.reason, /접속점.*1025.*한도/);
  assert.deepEqual(full, frozen, "입력 회로는 바뀌지 않는다");
  const fits = deltaCircuit("direct");
  fits.junctions.push(...dangling(1023));
  const accepted = convertYDeltaInCircuit(fits, ["R1", "R2", "R3"]);
  assert.equal(accepted.ok, true, "한도 안이면 변환된다");
  assert.equal(accepted.circuit.junctions.length, 1024);
  validateCircuitStructure(accepted.circuit);
});

test("[3] 코너 배선을 합친 뒤 같은 끝점 쌍의 중복 배선은 방향과 상관없이 하나만 남고 프로브 참조가 정리된다", () => {
  const before = deltaWithTwinWires();
  const probes = [
    { key: "V:C1:0", kind: "voltage", componentId: "C1", pin: 0, wireId: "W11", label: "V(C1.1)", color: "c1" },
    { key: "V:V1:0", kind: "voltage", componentId: "V1", pin: 0, wireId: "W4", label: "V(V1.1)", color: "c2" },
  ];
  const result = convertYDeltaInCircuit(before, ["R1", "R2", "R3"], { probes });
  assert.equal(result.ok, true);
  validateCircuitStructure(result.circuit);
  const keys = result.circuit.wires.map((item) => [endpointKeyOf(item.a), endpointKeyOf(item.b)].sort().join("|"));
  assert.equal(new Set(keys).size, keys.length, "같은 끝점 쌍의 배선이 둘 이상 없다: " + keys.join(" ; "));
  const ids = new Set(result.circuit.wires.map((item) => item.id));
  assert.ok(result.probes.every((probe) => !probe.wireId || ids.has(probe.wireId)), "프로브는 사라진 배선을 가리키지 않는다");
  assert.ok(!ids.has("W11") && ids.has("W10"), "처음 배선은 남고 뒤의 중복은 사라진다");
  assert.equal(result.probes.find((probe) => probe.key === "V:C1:0").wireId, null);
  assertEquivalent(before, result.circuit, { cornerPins: [["V1", 0], ["R4", 0], ["R5", 1], ["C1", 0]] });
});

test("[4] Δ→Y의 새 팔·중심은 남는 부품과 겹치지 않는다(첫 배치 자리에 부품을 두어 재현)", () => {
  const clean = deltaCircuit("direct");
  const first = convertYDeltaInCircuit(clean, ["R1", "R2", "R3"]);
  const placed = first.report.added.map((id) => first.circuit.components.find((component) => component.id === id));
  const hub = first.circuit.junctions.find((junction) => !clean.junctions.some((old) => old.id === junction.id));
  const blockers = [...placed.map((component, index) => part("X" + (index + 1), "C", component.x, component.y, { value: "1u", ic: "0" })), part("X4", "C", hub.x, hub.y, { value: "1u", ic: "0" })];
  const crowded = deltaCircuit("direct");
  crowded.components.push(...blockers);
  const result = convertYDeltaInCircuit(crowded, ["R1", "R2", "R3"]);
  assert.equal(result.ok, true);
  validateCircuitStructure(result.circuit);
  const moved = result.report.added.map((id) => result.circuit.components.find((component) => component.id === id));
  for (const component of moved) for (const other of blockers) assert.ok(Math.hypot(component.x - other.x, component.y - other.y) >= 70, `${component.id} sits on ${other.id}`);
  const newHub = result.circuit.junctions.find((junction) => !crowded.junctions.some((old) => old.id === junction.id));
  for (const other of blockers) assert.ok(Math.hypot(newHub.x - other.x, newHub.y - other.y) >= 30, "새 중심 접속점이 부품 위에 있지 않다");
  for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) assert.ok(Math.hypot(moved[i].x - moved[j].x, moved[i].y - moved[j].y) >= 60);
  for (const component of moved) assert.ok(component.x % GRID_SIZE === 0 && component.y % GRID_SIZE === 0);
  assert.equal(detectYDelta(result.circuit, result.report.added).kind, "Y");
  // 장애물이 없으면 처음 배치와 같고, 첫 배치 자리가 막히면 다른 자리를 고른다
  const anchors = [{ x: 200, y: 100 }, { x: 400, y: 100 }, { x: 300, y: 300 }];
  const preferred = layoutStarArms(anchors, { x: 300, y: 160 });
  assert.deepEqual(layoutStarArms(anchors, { x: 300, y: 160 }, [], []), preferred);
  const avoided = layoutStarArms(anchors, { x: 300, y: 160 }, [...preferred.arms, preferred.hub]);
  assert.notDeepEqual(avoided, preferred);
  for (const point of preferred.arms) for (const arm of avoided.arms) assert.ok(Math.hypot(arm.x - point.x, arm.y - point.y) >= 70);
});

test("[5] 단축키 Y를 누르고 있으면(repeat) 무시 신호가 붙고, 처음 눌렀을 때는 붙지 않는다", () => {
  assert.deepEqual(shortcutFor({ key: "y", code: "KeyY", repeat: false }), { action: "yDelta" });
  assert.deepEqual(shortcutFor({ key: "y", code: "KeyY", repeat: true }), { action: "yDelta", ignore: true });
  assert.equal(shortcutFor({ key: "y", code: "KeyY", ctrlKey: true, repeat: true }).action, "redo", "Ctrl+Y는 그대로");
});

test("[6] 새 참조 번호는 ref가 없는 기존 부품의 id(R6)도 피해서 이어진다", () => {
  const before = yCircuit();
  before.components.push({ id: "R6", type: "R", x: 640, y: 260, rotation: 90, props: { value: "1k" } });
  before.wires.push(wire("W30", pinEnd("R6", 0), pinEnd("R4", 0)), wire("W31", pinEnd("R6", 1), pinEnd("G1", 0)));
  const result = convertYDeltaInCircuit(before, ["R1", "R2", "R3"]);
  const refs = result.circuit.components.map((component) => component.props?.ref ?? component.id);
  assert.deepEqual(result.report.added.map((id) => result.circuit.components.find((component) => component.id === id).props.ref), ["R7", "R8", "R9"]);
  assert.equal(new Set(refs).size, refs.length, "표시 이름이 겹치지 않는다: " + refs.join(","));
});

test("[7] 캔버스 값 라벨: 8자를 넘는 값은 유효숫자 5자리 이하 + SI 접두어, 짧은 값과 숫자가 아닌 값은 그대로", () => {
  assert.equal(formatCanvasValueLabel("3.66666666667k"), "3.6667k");
  assert.equal(formatCanvasValueLabel("1.33333333333meg"), "1.3333meg");
  assert.equal(formatCanvasValueLabel("3666.66666667"), "3.6667k");
  assert.equal(formatCanvasValueLabel("0.000123456789"), "123.46u");
  assert.equal(formatCanvasValueLabel("-3.66666666667k"), "-3.6667k");
  assert.equal(formatCanvasValueLabel("22000.0001"), "22k");
  for (const same of ["1k", "10m", "4.7u", "1", "100k", "2.2kΩ", "12345678", "abcdefghijkl", "", "PULSE high 1 V"]) assert.equal(formatCanvasValueLabel(same), same, same);
  assert.equal(formatCanvasValueLabel(undefined), "");
  assert.equal(formatCanvasValueLabel(5), "5");
  // 저장 정밀도는 그대로: 변환 결과 문자열은 여전히 12자리이고 표시용만 줄어든다
  const stored = resistanceCircuitText(11e3 / 3);
  assert.ok(stored.length > 8);
  assert.ok(relative(parseValue(stored), 11e3 / 3) < 1e-11);
  assert.ok(formatCanvasValueLabel(stored).length <= 8);
  assert.ok(relative(parseValue(formatCanvasValueLabel(stored)), 11e3 / 3) < 1e-4);
});
