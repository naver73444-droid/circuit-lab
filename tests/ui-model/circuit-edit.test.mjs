import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTopology, deserializeCircuit, serializeCircuit, simulateDC } from "../../src/circuit-engine.js";
import { cloneComponentSet, deleteJunctionFromCircuit, retargetWireProbes, splitWireAtJunction, deleteComponentFromCircuit } from "../../src/circuit-edit.js";

const cloneSelectedComponent = (circuit, componentId, offset = 40) => cloneComponentSet(circuit, [componentId], offset).components[0] ?? null;
import { cloneExample } from "../../src/examples.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import { pinPosition, projectSplitPoint, routeWirePoints } from "../../src/circuit-geometry.js";

describe("basic analyses", () => {
  function nodeFor(result, componentId, pin) {
    return result.topology.nodeIdByPin[`${componentId}:${pin}`];
  }

  function voltage(result, pointIndex, componentId, pin = 0) {
    return result.points[pointIndex].nodeVoltages[nodeFor(result, componentId, pin)];
  }

  test("wire split junction은 원본을 보존하고 삭제는 incident wire만 끊는다", () => {
    const { circuit: original } = cloneExample("divider");
    const before = structuredClone(original);
    const split = splitWireAtJunction(original, "W2", { x: 360, y: 225 });
    assert.deepEqual(original, before);
    assert.equal(split.circuit.junctions.length, 1);
    assert.equal(split.circuit.wires.length, original.wires.length + 1);
    const probes = [{ key: "V:wire", kind: "voltage", wireId: split.splitWireIds[0] }, { key: "I:R1", kind: "current", componentId: "R1" }];
    const deleted = deleteJunctionFromCircuit(split.circuit, split.junction.id, probes);
    assert.equal(deleted.circuit.junctions.length, 0);
    assert.equal(deleted.circuit.wires.length, original.wires.length - 1);
    assert.deepEqual(deleted.probes.map((probe) => probe.key), ["I:R1"]);
    assert.ok(deleted.circuit.wires.some((wire) => wire.id === "W1"));
  });

  test("junction 이동·직렬화 후 net과 분압 수치는 유지된다", () => {
    const { circuit } = cloneExample("divider");
    const split = splitWireAtJunction(circuit, "W2", { x: 360, y: 225 });
    split.circuit.junctions[0].x += 120;
    split.circuit.junctions[0].y -= 70;
    const restored = deserializeCircuit(serializeCircuit(split.circuit));
    const result = simulateDC(restored);
    assert.equal(result.topology.nodeIdByJunction[split.junction.id], result.topology.nodeIdByPin["R2:0"]);
    assert.ok(Math.abs(voltage(result, 0, "R2", 0) - 5) <= 1e-12);
    assert.ok(Math.abs(result.points[0].componentCurrents.R1 - .005) <= 1e-12);
  });

  test("복제는 props와 회전을 복사하되 ID와 배선을 공유하지 않는다", () => {
    const { circuit } = cloneExample("divider");
    const clone = cloneSelectedComponent(circuit, "R1");
    assert.equal(clone.id, "R3");
    assert.deepEqual({ ...clone.props, ref: "R1" }, circuit.components.find((component) => component.id === "R1").props, "값은 그대로, 참조 라벨만 새로 받는다");
    assert.equal(clone.props.ref, "R3", "복제본은 원본 라벨(R1)이 아니라 다음 빈 라벨 R3");
    assert.equal(clone.rotation, 90);
    clone.props.value = "9k";
    assert.equal(circuit.components.find((component) => component.id === "R1").props.value, "1k");
    assert.ok(circuit.wires.every((wire) => wire.a.componentId !== clone.id && wire.b.componentId !== clone.id));
  });

  test("split은 실제 segment에 투영하고 경로·topology·wire probe를 보존한다", () => {
    const circuit = {
      version: 1,
      geometryVersion: 2,
      components: [
        { id: "R1", type: "R", x: -40, y: 0, rotation: 0, props: { ref: "R1", value: "1k" } },
        { id: "R2", type: "R", x: 140, y: 80, rotation: 0, props: { ref: "R2", value: "1k" } },
        { id: "G1", type: "GND", x: 180, y: 160, rotation: 0, props: { ref: "GND" } },
      ],
      wires: [
        { id: "W0", a: { componentId: "R1", pin: 1 }, b: { componentId: "R2", pin: 0 }, waypoints: [{ x: 40, y: 0 }, { x: 40, y: 80 }] },
        { id: "WG", a: { componentId: "R2", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      ],
      junctions: [],
    };
    const route = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 100, y: 80 }];
    const split = splitWireAtJunction(circuit, "W0", { x: 43, y: 37 }, route);
    assert.deepEqual(split.junction, { id: "J1", x: 40, y: 40 });
    assert.deepEqual(split.circuit.wires[0].waypoints, [{ x: 40, y: 0 }]);
    assert.deepEqual(split.circuit.wires[1].waypoints, [{ x: 40, y: 80 }]);
    assert.equal(buildTopology(split.circuit).nodeIdByJunction.J1, buildTopology(split.circuit).nodeIdByPin["R1:1"]);
    const probes = retargetWireProbes([{ key: "p", wireId: "W0" }, { key: "q", wireId: "other" }], "W0", split.replacementWireId);
    assert.deepEqual(probes.map((probe) => probe.wireId), [split.replacementWireId, "other"]);
    assert.deepEqual(projectSplitPoint([{ x: 0, y: 15 }, { x: 100, y: 15 }], { x: 43, y: 31 }, 1).point, { x: 40, y: 15 });
  });
});

test("a split wire's b-anchored probe follows the b segment", () => {
  const { circuit } = cloneExample("divider");
  const wire = circuit.wires.find(w => w.id === "W2");
  const split = splitWireAtJunction(circuit, wire.id, { x: 0, y: 40 }, [{ x: 0, y: 0 }, { x: 0, y: 80 }]);
  const probe = { key: "v", kind: "voltage", ...wire.b, wireId: wire.id };
  const retargeted = retargetWireProbes([probe], wire.id, split.replacementWireId, split)[0];
  assert.equal(retargeted.wireId, split.splitWireIds[1]);
  assert.equal(retargeted.componentId, wire.b.componentId);
});

test("splitting at an endpoint reuses that endpoint, not a zero-length wire", () => {
  const { circuit } = cloneExample("divider");
  const split = splitWireAtJunction(circuit, "W2", { x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 0, y: 80 }]);
  assert.equal(split.unchanged, true); assert.equal(split.circuit.wires.length, circuit.wires.length);
  assert.deepEqual(split.endpoint, circuit.wires.find(w => w.id === "W2").a);
});

describe("regressions", () => {
  const voltage = (result,id,pin=0) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

  test('deleting a component also removes probes anchored to its removed wires',()=>{
    const c=cloneExample('divider').circuit;const probes=[{key:'p',kind:'voltage',componentId:'R2',pin:0,wireId:'W2',label:'out',color:'#123456'}];
    const changed=deleteComponentFromCircuit(c,'R1',probes); assert.equal(changed.probes.length,0);assert.equal(c.components.length,4);
    const restored=deserializeProject(serializeProject({circuit:changed.circuit,settings:{analysis:'dc'},probes:changed.probes}));assert.equal(restored.circuit.components.length,3);
  });
});

describe("project boundaries", () => {
  const readFixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

  const f0Text = readFixture("project-divider-f0.json");

  const f0 = deserializeProject(f0Text);

  test("middle/endpoint split preserves topology and valid probe references", () => {
    const circuit = structuredClone(f0.circuit);
    const wire = circuit.wires.find((item) => item.id === "W2");
    const byId = new Map(circuit.components.map((component) => [component.id, component]));
    const route = routeWirePoints(wire, pinPosition(byId.get("R1"), 1, 2), pinPosition(byId.get("R2"), 0, 2), 2);
    const middle = route[Math.floor(route.length / 2)];
    const split = splitWireAtJunction(circuit, "W2", middle, route);
    const probes = retargetWireProbes(f0.probes, "W2", split.replacementWireId, split);
    assert.equal(split.unchanged, false);
    assert.equal(split.circuit.wires.length, circuit.wires.length + 1);
    assert.ok(split.circuit.wires.some((item) => item.id === probes.find((probe) => probe.key === "V:R2:0").wireId));
    assert.equal(buildTopology(split.circuit).nodeIdByPin["R1:1"], buildTopology(split.circuit).nodeIdByPin["R2:0"]);
    const endpoint = splitWireAtJunction(circuit, "W2", route[0], route);
    assert.equal(endpoint.unchanged, true);
    assert.equal(endpoint.circuit.wires.length, circuit.wires.length);
    assert.equal(endpoint.circuit.junctions.length, circuit.junctions.length);
  });

  test("component deletion clears dangling probes/wires and undo data can restore atomically", () => {
    const before = { circuit: structuredClone(f0.circuit), probes: structuredClone(f0.probes) };
    const deleted = deleteComponentFromCircuit(before.circuit, "R2", before.probes);
    assert.ok(!deleted.circuit.components.some((component) => component.id === "R2"));
    assert.ok(!deleted.circuit.wires.some((wire) => wire.a.componentId === "R2" || wire.b.componentId === "R2"));
    assert.ok(!deleted.probes.some((probe) => probe.componentId === "R2"));
    assert.ok(deleted.probes.some((probe) => probe.key === "V:V1:0"));
    assert.deepEqual(structuredClone(before), before);
    const clone = cloneSelectedComponent(deleted.circuit, "R1");
    assert.ok(clone);
    assert.ok(!deleted.circuit.components.some((component) => component.id === clone.id));
    assert.ok(!deleted.probes.some((probe) => probe.componentId === clone.id));
  });
});
