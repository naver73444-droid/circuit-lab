import test from "node:test";
import assert from "node:assert/strict";
import { buildTopology, parseValue, simulateACAtFrequency, validateCircuitStructure } from "../../src/circuit-engine.js";
import { convertDeltaToYOf, convertYToDeltaOf, elementText } from "../../src/y-delta-model.js";
import { convertYDeltaInCircuit, detectYDelta, selectedResistorIds, yDeltaCommandState } from "../../src/y-delta-circuit.js";

const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// ---- mathematics: L like R, C by the dual formulas -----------------------------------------------------------------------------

test("커패시터 Y→Δ: C_AB = C_A·C_B/(C_A+C_B+C_C) (순환), 같은 C이면 Δ 변은 C/3", () => {
  const [ab, bc, ca] = convertYToDeltaOf("C", [1e-6, 2e-6, 3e-6]);
  assert.ok(relative(ab, (1e-6 * 2e-6) / 6e-6) < 1e-13, "C_AB");
  assert.ok(relative(bc, (2e-6 * 3e-6) / 6e-6) < 1e-13, "C_BC");
  assert.ok(relative(ca, (3e-6 * 1e-6) / 6e-6) < 1e-13, "C_CA");
  for (const value of convertYToDeltaOf("C", [9e-9, 9e-9, 9e-9])) assert.ok(relative(value, 3e-9) < 1e-13);
});

test("커패시터 Δ→Y: C_A = (C_AB·C_BC + C_BC·C_CA + C_CA·C_AB)/C_BC, 같은 C이면 암은 3C", () => {
  const [ab, bc, ca] = [1e-6, 2e-6, 3e-6];
  const pairs = ab * bc + bc * ca + ca * ab;
  const [a, b, c] = convertDeltaToYOf("C", [ab, bc, ca]);
  assert.ok(relative(a, pairs / bc) < 1e-13, "C_A");
  assert.ok(relative(b, pairs / ca) < 1e-13, "C_B");
  assert.ok(relative(c, pairs / ab) < 1e-13, "C_C");
  for (const value of convertDeltaToYOf("C", [1e-6, 1e-6, 1e-6])) assert.ok(relative(value, 3e-6) < 1e-13);
});

test("인덕터는 저항과 같은 식, 왕복은 처음 값으로 돌아온다", () => {
  const [ab, bc, ca] = convertYToDeltaOf("L", [1e-3, 2e-3, 3e-3]);
  assert.ok(relative(ab, 1e-3 + 2e-3 + (1e-3 * 2e-3) / 3e-3) < 1e-13);
  assert.ok(relative(bc, 2e-3 + 3e-3 + (2e-3 * 3e-3) / 1e-3) < 1e-13);
  for (const type of ["R", "L", "C"]) {
    for (const triple of [[1e-3, 2e-3, 3e-3], [1e-9, 4.7e-6, 330e-12], [10, 1e7, 470]]) {
      const back = convertDeltaToYOf(type, convertYToDeltaOf(type, triple));
      triple.forEach((value, index) => assert.ok(relative(back[index], value) < 1e-12, `${type} ${triple} → ${back}`));
      const again = convertYToDeltaOf(type, convertDeltaToYOf(type, triple));
      triple.forEach((value, index) => assert.ok(relative(again[index], value) < 1e-12, `${type} Δ ${triple} → ${again}`));
    }
  }
  assert.equal(elementText("C", 3.3e-6), "3.3 µF");
  assert.equal(elementText("L", 2.2e-3), "2.2 mH");
});

// ---- circuits ---------------------------------------------------------------------------------------------------------------

const part = (id, type, x, y, props = {}, rotation = 0) => ({ id, type, x, y, rotation, props: { ref: id, ...props } });
const pinEnd = (componentId, pin) => ({ componentId, pin });
const wire = (id, a, b) => ({ id, a, b });
const circuitOf = (components, wires, junctions = []) => ({ version: 1, geometryVersion: 2, components, wires, junctions });
const element = (type, id, value, x, y, rotation = 0, extra = {}) => part(id, type, x, y, { value, ...(type === "R" ? {} : { ic: "0" }), ...extra }, rotation);

/** AC source (1 V peak) → corner A; Y arms X1(A), X2(B), X3(C) meet at J1; B and C each feed a 1k resistor to ground. */
function yNetwork(type, values = ["1u", "2u", "3u"], extra = {}) {
  return circuitOf([
    part("V1", "V", 100, 260, { mode: "SIN", dc: "0", acMagnitude: "1", acPhase: "0", amplitude: "1", frequency: "1k", offset: "0", phase: "0" }, 90),
    element(type, "X1", values[0], 300, 260, 0, extra), element(type, "X2", values[1], 420, 160, 90), element(type, "X3", values[2], 420, 360, 90),
    element("R", "R4", "1k", 560, 160, 90), element("R", "R5", "1k", 560, 360, 90), part("G1", "GND", 620, 540),
  ], [
    wire("W1", pinEnd("V1", 0), pinEnd("X1", 0)), wire("W2", pinEnd("X1", 1), { junctionId: "J1" }), wire("W3", pinEnd("X2", 1), { junctionId: "J1" }), wire("W4", pinEnd("X3", 0), { junctionId: "J1" }),
    wire("W5", pinEnd("X2", 0), pinEnd("R4", 0)), wire("W6", pinEnd("X3", 1), pinEnd("R5", 1)),
    wire("W7", pinEnd("R4", 1), pinEnd("G1", 0)), wire("W8", pinEnd("R5", 0), pinEnd("G1", 0)), wire("W9", pinEnd("V1", 1), pinEnd("G1", 0)),
  ], [{ id: "J1", x: 420, y: 260 }]);
}

/** Δ ring X1(A–B) X2(B–C) X3(C–A); the source at A, loads at B and C. */
function deltaNetwork(type, values = ["1u", "2u", "3u"]) {
  return circuitOf([
    part("V1", "V", 100, 260, { mode: "SIN", dc: "0", acMagnitude: "1", acPhase: "0", amplitude: "1", frequency: "1k", offset: "0", phase: "0" }, 90),
    element(type, "X1", values[0], 300, 180), element(type, "X2", values[1], 420, 320, 90), element(type, "X3", values[2], 300, 340),
    element("R", "R4", "1k", 560, 160, 90), element("R", "R5", "1k", 560, 420, 90), part("G1", "GND", 620, 540),
  ], [
    wire("W1", pinEnd("X1", 0), pinEnd("X3", 1)), wire("W2", pinEnd("X1", 1), pinEnd("X2", 0)), wire("W3", pinEnd("X2", 1), pinEnd("X3", 0)),
    wire("W4", pinEnd("V1", 0), pinEnd("X1", 0)), wire("W5", pinEnd("X2", 0), pinEnd("R4", 0)), wire("W6", pinEnd("X2", 1), pinEnd("R5", 1)),
    wire("W7", pinEnd("R4", 1), pinEnd("G1", 0)), wire("W8", pinEnd("R5", 0), pinEnd("G1", 0)), wire("W9", pinEnd("V1", 1), pinEnd("G1", 0)),
  ]);
}

const phasorAt = (circuit, result, id, pin) => result.points[0].nodeVoltages[buildTopology(circuit).nodeFor(id, pin)];

/** AC result before/after: the corner voltages and the source current phasor (several frequencies) must agree. */
function assertSameAC(before, after, { corners = [["V1", 0], ["R4", 0], ["R5", 1]], frequencies = [50, 1e3, 33e3], tolerance = 1e-9 } = {}) {
  for (const frequency of frequencies) {
    const a = simulateACAtFrequency(before, frequency), b = simulateACAtFrequency(after, frequency);
    for (const [id, pin] of corners) {
      const va = phasorAt(before, a, id, pin), vb = phasorAt(after, b, id, pin);
      assert.ok(Math.hypot(va.re - vb.re, va.im - vb.im) <= tolerance * Math.max(1, Math.hypot(va.re, va.im)), `${frequency} Hz V(${id}.${pin + 1}) ${JSON.stringify(va)} → ${JSON.stringify(vb)}`);
    }
    const ia = a.points[0].componentCurrents.V1, ib = b.points[0].componentCurrents.V1;
    assert.ok(Math.hypot(ia.re - ib.re, ia.im - ib.im) <= tolerance * Math.max(1e-12, Math.hypot(ia.re, ia.im)), `${frequency} Hz 전원 전류 ${JSON.stringify(ia)} → ${JSON.stringify(ib)}`);
  }
}

const valuesOf = (circuit, ids) => ids.map((id) => parseValue(circuit.components.find((component) => component.id === id).props.value));

// ---- rewrite: AC equivalence ---------------------------------------------------------------------------------------------------

for (const [type, values] of [["L", ["1m", "2.2m", "4.7m"]], ["C", ["1u", "2.2u", "4.7u"]], ["C", ["10n", "10n", "10n"]], ["L", ["3m", "3m", "3m"]]]) {
  test(`${type} 3개 Y→Δ (${values.join(", ")}): 구조 유효 · 변환 전후 AC 결과 동일 · 값이 식과 일치`, () => {
    const before = yNetwork(type, values);
    const frozen = structuredClone(before);
    assert.equal(detectYDelta(before, ["X1", "X2", "X3"]).kind, "Y");
    assert.equal(detectYDelta(before, ["X1", "X2", "X3"]).element, type);
    const { circuit, report } = convertYDeltaInCircuit(before, ["X1", "X2", "X3"]);
    assert.deepEqual(before, frozen, "입력 회로는 바뀌지 않는다");
    validateCircuitStructure(circuit);
    assert.equal(report.kind, "Y→Δ");
    assert.ok(report.names.every((name) => name.startsWith(type)), report.names.join());
    const added = circuit.components.filter((component) => report.added.includes(component.id));
    assert.ok(added.length === 3 && added.every((component) => component.type === type), "같은 종류 3개가 새로 생긴다");
    assert.ok(added.every((component) => component.props.ic === "0"), "새 부품의 초기값은 0");
    assert.equal(detectYDelta(circuit, report.added).kind, "Δ");
    const expected = convertYToDeltaOf(type, values.map((value) => parseValue(value)));
    valuesOf(circuit, report.added).forEach((value, index) => assert.ok(relative(value, expected[index]) < 1e-11, `${report.added[index]}: ${value} vs ${expected[index]}`));
    assertSameAC(before, circuit);
    assert.match(report.message, new RegExp(`^Y→Δ 변환: ${type}AB=`));
  });

  test(`${type} 3개 Δ→Y (${values.join(", ")}): 변환 전후 AC 결과 동일, Y→Δ→Y 왕복은 값이 돌아온다`, () => {
    const before = deltaNetwork(type, values);
    const { circuit, report } = convertYDeltaInCircuit(before, ["X1", "X2", "X3"]);
    validateCircuitStructure(circuit);
    assert.equal(report.kind, "Δ→Y");
    assert.equal(detectYDelta(circuit, report.added).kind, "Y");
    assertSameAC(before, circuit);
    const back = convertYDeltaInCircuit(circuit, report.added);
    assertSameAC(before, back.circuit);
    valuesOf(back.circuit, back.report.added).forEach((value, index) => assert.ok(relative(value, parseValue(values[index])) < 1e-9, `왕복 ${value} vs ${values[index]}`));
  });
}

// ---- refusals -------------------------------------------------------------------------------------------------------------------

test("종류가 섞인 3개는 이유와 함께 거부된다 (R·L·C 혼합, L 2 + R 1 등)", () => {
  const mixed = yNetwork("L", ["1m", "2m", "3m"]);
  mixed.components.find((component) => component.id === "X3").type = "C";
  mixed.components.find((component) => component.id === "X3").props = { ref: "X3", value: "1u", ic: "0" };
  const detected = detectYDelta(mixed, ["X1", "X2", "X3"]);
  assert.equal(detected.kind, null);
  assert.match(detected.reason, /섞여/);
  assert.match(detected.reason, /같은 종류/);
  const items = ["X1", "X2", "X3"].map((id) => ({ kind: "component", id }));
  assert.deepEqual(selectedResistorIds(mixed, items), ["X1", "X2", "X3"]);
  const state = yDeltaCommandState(mixed, items);
  assert.equal(state.visible, true);
  assert.equal(state.enabled, false);
  assert.match(state.reason, /섞여/);
  assert.throws(() => convertYDeltaInCircuit(mixed, ["X1", "X2", "X3"]), (error) => error instanceof RangeError && /섞여/.test(error.message));
  // 저항 1개가 끼어도 마찬가지
  const withResistor = yNetwork("C", ["1u", "2u", "3u"]);
  withResistor.components.find((component) => component.id === "X1").type = "R";
  withResistor.components.find((component) => component.id === "X1").props = { ref: "X1", value: "1k" };
  assert.match(detectYDelta(withResistor, ["X1", "X2", "X3"]).reason, /섞여/);
  // 전압원이 끼면 명령 자체가 보이지 않는다
  assert.equal(selectedResistorIds(mixed, [{ kind: "component", id: "X1" }, { kind: "component", id: "X2" }, { kind: "component", id: "V1" }]), null);
});

test("L·C의 초기값(IC)이 0이 아니면 이유와 함께 거부된다, 저항은 영향 없음", () => {
  for (const type of ["L", "C"]) {
    const circuit = yNetwork(type, ["1m", "2m", "3m"]);
    circuit.components.find((component) => component.id === "X2").props.ic = "1";
    const detected = detectYDelta(circuit, ["X1", "X2", "X3"]);
    assert.equal(detected.kind, null);
    assert.match(detected.reason, /초기값\(IC\)/);
    assert.match(detected.reason, /X2/);
  }
  const resistors = yNetwork("R", ["1k", "2k", "3k"]);
  assert.equal(detectYDelta(resistors, ["X1", "X2", "X3"]).kind, "Y");
});

test("저항 3개의 변환은 그대로다 (이름 RAB…, 결과 값)", () => {
  const before = yNetwork("R", ["1k", "2k", "3k"]);
  const { report } = convertYDeltaInCircuit(before, ["X1", "X2", "X3"]);
  assert.deepEqual(report.names, ["RAB", "RBC", "RCA"]);
  assert.match(report.message, /^Y→Δ 변환: RAB=3\.667 kΩ, RBC=11 kΩ, RCA=5\.5 kΩ$/);
});
