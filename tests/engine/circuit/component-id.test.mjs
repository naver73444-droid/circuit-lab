// A part id must not contain '#': "<id>#2" is the result key of a second winding current, so an id such as "K1#2" would overwrite it.
import test from "node:test";
import assert from "node:assert/strict";
import { componentDefaults, deserializeCircuit, secondaryCurrentKey, serializeCircuit, simulateACAtFrequency, validateCircuitStructure } from "../../../src/circuit-engine.js";
import { deserializeProject, serializeProject } from "../../../src/project-format.js";

function transformerCircuit(coilId, loadId = "R1") {
  const coil = { id: coilId, type: "COUPLED_L", x: 200, y: 100, rotation: 0, props: { ...componentDefaults("COUPLED_L", 1), L1: "5", L2: "6", coupling: "M", M: "3", dots: "same", ref: "K1" } };
  const items = [
    { id: "V1", type: "V", x: 80, y: 100, rotation: 0, props: { ...componentDefaults("V", 1), mode: "SIN", dc: "0", acMagnitude: "12", acPhase: "0", ref: "V1" } },
    coil,
    { id: loadId, type: "R", x: 320, y: 100, rotation: 0, props: { ...componentDefaults("R", 1), value: "12", ref: loadId } },
    { id: "G1", type: "GND", x: 200, y: 300, rotation: 0, props: {} },
  ];
  const wires = [
    { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: coilId, pin: 0 } },
    { id: "W2", a: { componentId: coilId, pin: 1 }, b: { componentId: "G1", pin: 0 } },
    { id: "W3", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    { id: "W4", a: { componentId: coilId, pin: 2 }, b: { componentId: loadId, pin: 0 } },
    { id: "W5", a: { componentId: loadId, pin: 1 }, b: { componentId: coilId, pin: 3 } },
    { id: "W6", a: { componentId: coilId, pin: 3 }, b: { componentId: "G1", pin: 0 } },
  ];
  return { version: 1, geometryVersion: 2, components: items, wires, junctions: [] };
}

test("부품 ID에 '#'가 있으면 구조 검증이 한국어 오류로 거부한다", () => {
  assert.throws(() => validateCircuitStructure(transformerCircuit("K1#2")), (error) => error.code === "BAD_COMPONENT" && /#/.test(error.message));
  assert.throws(() => validateCircuitStructure(transformerCircuit("K1", "R#1")), (error) => error.code === "BAD_COMPONENT");
  // the actual collision: coil K1 plus a part named "K1#2" would share the result key of K1's second winding
  assert.throws(() => validateCircuitStructure(transformerCircuit("K1", "K1#2")), (error) => error.code === "BAD_COMPONENT");
  assert.doesNotThrow(() => validateCircuitStructure(transformerCircuit("K1")));
});

test("version 4 프로젝트 파일에서 코일 ID를 'K1#2'로 쓴 파일은 가져오기에서 거부된다 (권선 2 전류 결과를 덮어쓰지 못한다)", () => {
  const good = serializeProject({ circuit: transformerCircuit("K1"), title: "t", subtitle: "s", settings: { analysis: "ac" }, probes: [] });
  assert.equal(JSON.parse(good).version, 4);
  assert.doesNotThrow(() => deserializeProject(good));
  const bad = good.replaceAll("\"K1\"", "\"K1#2\"");
  assert.notEqual(bad, good);
  assert.throws(() => deserializeProject(bad), (error) => error.code === "BAD_COMPONENT");
  assert.throws(() => deserializeCircuit(JSON.stringify({ ...JSON.parse(serializeCircuit(transformerCircuit("K1"))), components: JSON.parse(serializeCircuit(transformerCircuit("K1#2"))).components })), (error) => error.code === "BAD_COMPONENT");
});

test("정상 ID의 결과 키: 두 번째 권선 전류는 '<id>#2' 이고 어떤 부품 ID와도 겹치지 않는다", () => {
  const circuit = transformerCircuit("K1");
  const currents = simulateACAtFrequency(circuit, 1 / (2 * Math.PI)).points[0].componentCurrents;
  assert.ok(Object.hasOwn(currents, "K1") && Object.hasOwn(currents, secondaryCurrentKey("K1")));
  assert.ok(!circuit.components.some((component) => component.id === secondaryCurrentKey("K1")));
});
